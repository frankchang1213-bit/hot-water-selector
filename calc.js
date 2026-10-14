/**
 * 恒热别墅热水选型工具 — 计算引擎（纯函数，不依赖 DOM，可在 Node 中测试）
 *
 * 计算逻辑依据：《热水计算底层逻辑.xlsx》（恒热内部口径）
 *
 *   供给侧（每台设备）：
 *     混水量 C = 容积 × (机器设定温度 − 冷水温度) / (洗澡温度 − 冷水温度)   [L @洗澡温度]
 *     产热水能力 R = 功率 × 860 / (60 × (洗澡温度 − 冷水温度))             [L/min]
 *     满水再加热时间 t_reheat = 容积 × (设定 − 冷水) / (功率 × 860) × 60   [min]
 *
 *   需求侧（用户勾选的"同时开启"卫生间集合；未勾选时取流量最大一间）：
 *     瞬时流量 q_dem = Σ 洁具流量                                       [L/min]
 *     用水总量 D     = Σ(花洒流量 × 使用时长) + Σ 浴缸容积               [L]
 *     需要时长 t     = 同时集合中最长的使用时间（浴缸按 容积/注水流量）
 *
 *   判定：
 *     一直洗场景：R ≥ q_dem（水箱缓冲无效，产热水能力必须持续顶得住）
 *     普通场景：  可供水量 = C + R × t ≥ D
 *                （等价于可持续时间 T_max = C / (q_dem − R) ≥ t）
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.HWCalc = factory();
})(typeof self !== "undefined" ? self : this, function () {

  // ---------- 基础 ----------

  /** 单个卫生间峰值混合水流量（L/min） */
  function bathroomFlow(FIXTURES, bathroom) {
    return bathroom.fixtures.reduce((sum, f) => {
      const def = FIXTURES[f.key];
      return sum + (f.flow != null ? f.flow : (def ? def.flow : 0));
    }, 0);
  }

  // ---------- 需求侧 ----------

  /**
   * 需求侧计算：每个同时开启的卫生间 流量×时长，全部加起来
   * 返回 detail：逐卫生间明细（计算过程展示用）
   */
  function demand(CONFIG, FIXTURES, bathrooms, people, peakCount) {
    const valid = bathrooms.filter((b) => b.fixtures.length > 0);
    let concurrent = valid.filter((b) => b.concurrent);
    if (concurrent.length === 0 && valid.length > 0) {
      concurrent = [valid.reduce((a, b) =>
        bathroomFlow(FIXTURES, a) >= bathroomFlow(FIXTURES, b) ? a : b)];
    }

    let qDem = 0;      // 瞬时流量 L/min
    let dTotal = 0;    // 用水总量 L
    let tNeed = 0;     // 需要时长 min（取同时集合中最长，浴缸按容积/注水流量折算）
    let n = 0;         // 同时洗浴花洒数
    let hasAlwaysOn = false;
    const detail = [];
    const flowParts = [];   // 瞬时流量逐项（计算过程展示用）
    const events = [];      // 用水事件 [{flow, dur, label}]（错峰断点校验用）

    concurrent.forEach((b) => {
      if (b.alwaysOn) hasAlwaysOn = true;
      let showerFlow = 0;
      const parts = [];
      let subtotal = 0;
      b.fixtures.forEach((f) => {
        const def = FIXTURES[f.key];
        if (!def) return;
        const fl = f.flow != null ? f.flow : def.flow;
        qDem += fl;
        flowParts.push(`${def.name} ${fl}`);
        if (def.shower) {
          n++;
          showerFlow += fl;
          parts.push(`${def.name} ${fl} L/min × ${b.minutes} 分钟 = ${(fl * b.minutes).toFixed(0)} L`);
          events.push({ flow: fl, dur: b.minutes, label: `${b.name}·${def.name}` });
        } else {
          const vol = f.volume != null ? f.volume : def.volume;
          const tubDur = vol / fl;
          subtotal += vol;
          parts.push(`${def.name} 注水 ${vol} L（${fl} L/min × ${tubDur.toFixed(0)} 分钟）`);
          tNeed = Math.max(tNeed, tubDur);
          events.push({ flow: fl, dur: tubDur, label: `${b.name}·${def.name}` });
        }
      });
      if (showerFlow > 0) {
        subtotal += showerFlow * b.minutes;
        tNeed = Math.max(tNeed, b.minutes);
      }
      dTotal += subtotal;
      detail.push({ name: b.name, parts, subtotal });
    });

    // 错峰断点：各用水事件结束时刻排序，逐断点计算累计需求与该刻在用流量
    const breakpoints = [...new Set(events.map((e) => e.dur))].sort((a, b) => a - b);
    const timeline = breakpoints.map((t) => {
      const cumD = events.reduce((s, e) => s + e.flow * Math.min(e.dur, t), 0);
      const qAt = events.filter((e) => e.dur >= t).reduce((s, e) => s + e.flow, 0);
      const active = events.filter((e) => e.dur >= t).map((e) => e.label);
      return { t, cumD, qAt, active };
    });

    return {
      bathroomCount: valid.length,
      concurrentCount: concurrent.length,
      n, qDem, dTotal, tNeed, hasAlwaysOn, detail, flowParts, timeline,
      vDay: (people || 0) * CONFIG.personDailyL,
      people: people || 0,
    };
  }

  // ---------- 供给侧 ----------

  /** 单机能力（底层逻辑表公式） */
  function capability(CONFIG, p, temps) {
    const delta = temps.mixed - temps.cold;
    const cMix = p.tankL * (temps.set - temps.cold) / delta;
    const rRate = p.powerKW * 860 / (60 * delta);
    return {
      cMix, rRate,
      v10: cMix + 10 * rRate,
      v1h: cMix + 60 * rRate,
      tReheatMin: p.tankL * (temps.set - temps.cold) / (p.powerKW * 860) * 60,
    };
  }

  // ---------- 判定 ----------

  /**
   * 单机 vs 需求（错峰断点校验）
   * 逐断点检查：每个卫生间结束用水的时刻 t，要求 累计需求 D(t) ≤ C + R×t
   * 返回 { items, cap, pass, tMaxMin, timelineChecked, checks, cost }
   */
  function evaluateCap(CONFIG, p, cap, dem, temps) {
    let tMax = Infinity, pass, mainText, mainLevel = "green";
    let timelineChecked = [];

    if (dem.hasAlwaysOn) {
      pass = cap.rRate >= dem.qDem;
      mainLevel = pass ? "green" : "red";
      mainText = pass
        ? `含"一直洗"需求：产热水能力 ${cap.rRate.toFixed(1)} ≥ 同时用水 ${dem.qDem.toFixed(1)} L/min，满足`
        : `含"一直洗"需求：产热水能力 ${cap.rRate.toFixed(1)} < 同时用水 ${dem.qDem.toFixed(1)} L/min，不满足`;
    } else if (cap.rRate >= dem.qDem) {
      pass = true;
      mainText = `产热水能力 R=${cap.rRate.toFixed(1)} ≥ 同时用水 q=${dem.qDem.toFixed(1)} L/min，全程不限时长`;
    } else {
      // 逐断点校验：任一时刻 累计需求 ≤ 可供水量（C + R×t）
      let failAt = null, failSegQ = 0;
      timelineChecked = dem.timeline.map((bp) => {
        const avail = cap.cMix + cap.rRate * bp.t;
        const ok = bp.cumD <= avail + 1e-9;
        if (!ok && failAt === null) { failAt = bp.t; failSegQ = bp.qAt; }
        return { t: bp.t, cumD: bp.cumD, avail, ok, qAt: bp.qAt, active: bp.active };
      });

      if (failAt === null) {
        pass = true;
        const worst = timelineChecked.reduce((w, bp) =>
          (bp.avail - bp.cumD < w.margin ? { margin: bp.avail - bp.cumD, t: bp.t } : w),
          { margin: Infinity, t: dem.tNeed });
        mainText = `全程满足：任一断点 可供 ≥ 累计需求（最紧张时刻为第 ${worst.t.toFixed(0)} 分钟）`;
      } else {
        pass = false; mainLevel = "red";
  // 断供时刻：失败断点前的区间内线性插值
        const i = dem.timeline.findIndex((b) => b.t === failAt);
        const tPrev = i > 0 ? dem.timeline[i - 1].t : 0;
        const cumPrev = i > 0 ? dem.timeline[i - 1].cumD : 0;
        tMax = failSegQ > cap.rRate
          ? tPrev + (cap.cMix + cap.rRate * tPrev - cumPrev) / (failSegQ - cap.rRate)
          : failAt;
        mainText = `第 ${failAt.toFixed(0)} 分钟断供：累计需求 ${dem.timeline[i].cumD.toFixed(0)}L > 可供 ${(cap.cMix + cap.rRate * failAt).toFixed(0)}L（断供约在 ${tMax.toFixed(1)} 分钟处）`;
      }
    }

    const reheatOk = cap.tReheatMin <= CONFIG.targetReheatMin;
    const reheat = { level: reheatOk ? "green" : "yellow",
      text: `满水再加热 ${cap.tReheatMin.toFixed(0)} 分钟${reheatOk ? "" : `（超过目标 ${CONFIG.targetReheatMin} 分钟）`}` };
    const marginOver = dem.dTotal > 0 && cap.cMix >= 3 * dem.dTotal;
    const margin = { level: marginOver ? "yellow" : "green",
      text: marginOver ? "容量偏大（混水量超过单次需求 3 倍）" : "容量匹配合理" };

    return {
      items: [{ product: p, qty: 1 }],
      cap, pass, tMaxMin: tMax, timelineChecked,
      checks: { r1: { pass, level: mainLevel, text: mainText }, r2  : reheat, r3: margin },
      cost: cost(CONFIG, [{ product: p, qty: 1 }], dem, temps),
    };
  }

  // ---------- 费用（仅初投资；运行费不展示） ----------

  function cost(CONFIG, items, dem, temps) {
    const capex = items.reduce((s, it) => s + it.product.price * it.qty, 0);
    return { capex };
  }

  // ---------- 三档匹配（按产品版本组：标准版/舒适版/尊享版，每组单机） ----------

  /**
   * 每档：组内满足判定的最便宜机型；都不满足则取组内最强机型并标 shortfall
   */
  function matchTiers(CONFIG, PRODUCTS, TIERS, dem, temps) {
    const out = {};
    TIERS.forEach((tier) => {
      const group = PRODUCTS.filter((p) => p.group === tier.group);
      const evals = group.map((p) => evaluateCap(CONFIG, p, capability(CONFIG, p, temps), dem, temps));
      const passing = evals.filter((e) => e.pass).sort((a, b) => a.cost.capex - b.cost.capex);
      if (passing.length > 0) {
        out[tier.key] = passing[0];
      } else {
        const strongest = evals.sort((a, b) => b.cap.rRate - a.cap.rRate)[0] || null;
        out[tier.key] = strongest ? { ...strongest, shortfall: true } : null;
      }
    });
    return out;
  }

  // ---------- 场景化输出 ----------

  /** "N 个花洒同开能洗多久"：T = C / (F − R)；F ≤ R 则不限 */
  function durationTable(cap, showerFlow, maxN) {
    const rows = [];
    for (let i =  1; i <= maxN; i++) {
      const flow = i * showerFlow;
      if (cap.rRate >= flow) {
        rows.push({ n: i, flow, unlimited: true, minutes: Infinity });
      } else {
        rows.push({ n: i, flow, unlimited: false,
          minutes: Math.floor(cap.cMix / (flow - cap.rRate)) });
      }
    }
    return rows;
  }

  /** 能力边界（不满足时展示"能满足什么情况"） */
  function capacityBoundary(CONFIG, cap, showerFlow) {
    return {
      sustainedFlow: cap.rRate,
      maxShowersUnlimited: Math.floor(cap.rRate / showerFlow),
      avail15: cap.cMix + cap.rRate * 15,
    };
  }

  /**
   * 给水管径建议（GB 50015：生活给水管道设计流速 ≤1.2m/s，按 1.0m/s 偏安全取值）
   */
  const PIPE_TABLE = [
    { dn: "DN20（De25）", maxFlow: 19 },
    { dn: "DN25（De32）", maxFlow: 32 },
    { dn: "DN32（De40）", maxFlow: 50 },
    { dn: "DN40（De50）", maxFlow: 78 },
    { dn: "DN50（De63）", maxFlow: 122 },
  ];
  function pipeAdvice(qPeak) {
    const hit = PIPE_TABLE.find((p) => p.maxFlow >= qPeak);
    return hit || { dn: "DN50 以上（需水力计算）", maxFlow: Infinity };
  }

  return {
    bathroomFlow, demand, capability, evaluateCap,
    cost, matchTiers, durationTable, capacityBoundary,
    pipeAdvice, PIPE_TABLE,
  };
});
