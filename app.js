/**
 * 恒热别墅热水选型工具 — 页面交互与报价单生成
 * 依赖 data.js（CONFIG / FIXTURES / TIERS / PRODUCTS / ACCESSORIES / DEALER / LOGIC_VERSION）和 calc.js（HWCalc）
 *
 * 计算逻辑：恒热内部口径（《热水计算底层逻辑.xlsx》）
 *   C = 容积×(设定−冷水)/(洗澡−冷水)；R = 功率×860/(60×温差)；可供 = C + R×t ≥ 需求 D
 * 选型原则：每档单机；不满足时标注并写出能力边界
 */

(function () {
  // ===== 状态 =====
  // bathrooms: [{ name, fixtures: [{key, flow, volume?}], minutes, alwaysOn, concurrent }]
  let bathrooms = [];
  let lastPlans = [];   // 最近一次生成的方案（场景试算器用）
  let lastDem = null;

  const listEl = document.getElementById("bathroomList");
  const emptyTip = document.getElementById("emptyTip");
  const resultSection = document.getElementById("resultSection");
  const calcSummary = document.getElementById("calcSummary");
  const tierResults = document.getElementById("tierResults");
  const quoteEl = document.getElementById("quote");

  // ===== 卫生间卡片（洁具按钮内嵌每个卡片，点击加入/可拖拽） =====
  function addBathroom() {
    bathrooms.push({
      name: `卫生间 ${bathrooms.length + 1}`,
      fixtures: [],
      minutes: CONFIG.defaultMinutes,
      alwaysOn: false,
      concurrent: false,
    });
    renderBathrooms();
  }

  function addFixture(i, key) {
    bathrooms[i].fixtures.push({ key, flow: FIXTURES[key].flow, volume: FIXTURES[key].volume });
    renderBathrooms();
  }

  function renderBathrooms() {
    listEl.innerHTML = "";
    emptyTip.classList.toggle("hidden", bathrooms.length > 0);

    bathrooms.forEach((b, i) => {
      const card = document.createElement("div");
      card.className = "bathroom";

      const chips = b.fixtures.map((f, j) => {
        const def = FIXTURES[f.key];
        const volInput = def.volume > 0
          ? `<input class="chip-flow" type="number" min="20" max="500" step="10" value="${f.volume}"
               data-vol-i="${i}" data-vol-j="${j}" title="容积 L，可修改">L`
          : "";
        return `<span class="fixture-chip">${def.svg} ${def.name}
          <input class="chip-flow" type="number" min="1" max="40" step="0.5" value="${f.flow}"
                 data-flow-i="${i}" data-flow-j="${j}" title="流量 L/min，可修改">${volInput}
          <span class="remove" data-i="${i}" data-j="${j}" title="移除">×</span></span>`;
      }).join("");

      // 内嵌洁具按钮（点击加入本卫生间；也可拖拽到其他卫生间）
      const miniPalette = Object.entries(FIXTURES).map(([key, f]) =>
        `<button type="button" class="mini-fixture" draggable="true" data-fx="${key}" data-target="${i}"
           title="点击加入本卫生间，或拖到其他卫生间">${f.svg} ${f.name}</button>`).join("");

      const flow = HWCalc.bathroomFlow(FIXTURES, b);
      card.innerHTML = `
        <div class="bathroom-head">
          <input class="b-name" type="text" value="${b.name}" data-name="${i}" maxlength="12">
          <button class="del" data-del="${i}">删除</button>
        </div>
        <div class="dropzone" data-drop="${i}">
          ${chips || '<span class="dz-hint">点下方按钮加入洁具，或从其他卫生间拖过来</span>'}
        </div>
        <div class="mini-palette">${miniPalette}</div>
        <div class="bathroom-opts">
          <label>洗澡时长 <input type="number" min="5" max="120" value="${b.minutes}"
                 data-minutes="${i}" ${b.alwaysOn ? "disabled" : ""}> 分钟</label>
          <label><input type="checkbox" data-alwayson="${i}" ${b.alwaysOn ? "checked" : ""}> 一直洗</label>
          <label><input type="checkbox" data-concurrent="${i}" ${b.concurrent ? "checked" : ""}> 同时开启</label>
          <span class="b-flow">本间峰值 ${flow} L/min</span>
        </div>`;
      listEl.appendChild(card);
    });

    bindBathroomEvents();
  }

  function bindBathroomEvents() {
    listEl.querySelectorAll(".dropzone").forEach((dz) => {
      dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
      dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
      dz.addEventListener("drop", (e) => {
        e.preventDefault();
        dz.classList.remove("dragover");
        const key = e.dataTransfer.getData("text/plain");
        if (FIXTURES[key]) addFixture(+dz.dataset.drop, key);
      });
    });
    listEl.querySelectorAll(".mini-fixture").forEach((btn) => {
      btn.addEventListener("click", () => addFixture(+btn.dataset.target, btn.dataset.fx));
      btn.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", btn.dataset.fx));
    });
    listEl.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", () => {
        bathrooms.splice(+btn.dataset.del, 1);
        renderBathrooms();
      }));
    listEl.querySelectorAll(".b-name").forEach((inp) =>
      inp.addEventListener("change", () => {
        bathrooms[+inp.dataset.name].name = inp.value.trim() || `卫生间 ${+inp.dataset.name + 1}`;
      }));
    listEl.querySelectorAll(".remove").forEach((x) =>
      x.addEventListener("click", () => {
        bathrooms[+x.dataset.i].fixtures.splice(+x.dataset.j, 1);
        renderBathrooms();
      }));
    listEl.querySelectorAll("[data-flow-i]").forEach((inp) =>
      inp.addEventListener("change", () => {
        bathrooms[+inp.dataset.flowI].fixtures[+inp.dataset.flowJ].flow = Math.max(1, +inp.value || 9);
        renderBathrooms();
      }));
    listEl.querySelectorAll("[data-vol-i]").forEach((inp) =>
      inp.addEventListener("change", () => {
        bathrooms[+inp.dataset.volI].fixtures[+inp.dataset.volJ].volume =
          Math.min(500, Math.max(20, +inp.value || FIXTURES.bathtub.volume));
      }));
    listEl.querySelectorAll("[data-minutes]").forEach((inp) =>
      inp.addEventListener("change", () => {
        bathrooms[+inp.dataset.minutes].minutes = Math.max(1, +inp.value || CONFIG.defaultMinutes);
      }));
    listEl.querySelectorAll("[data-alwayson]").forEach((cb) =>
      cb.addEventListener("change", () => {
        bathrooms[+cb.dataset.alwayson].alwaysOn = cb.checked;
        renderBathrooms();
      }));
    listEl.querySelectorAll("[data-concurrent]").forEach((cb) =>
      cb.addEventListener("change", () => {
        bathrooms[+cb.dataset.concurrent].concurrent = cb.checked;
      }));
  }

  // ===== 工况参数 =====
  function readConditions() {
    const seasonKey = document.getElementById("season").value;
    const season = CONFIG.seasons[seasonKey];
    const coldOverride = +document.getElementById("coldTemp").value;
    CONFIG.targetReheatMin = +document.getElementById("targetReheat").value || CONFIG.targetReheatMin;
    return {
      seasonName: season.name,
      temps: {
        cold: coldOverride > 0 ? coldOverride : season.cold,
        set: +document.getElementById("setTemp").value || CONFIG.setTemp,
        mixed: +document.getElementById("mixedTemp").value || CONFIG.mixedTemp,
      },
    };
  }

  function bindSeasonAutofill() {
    const seasonEl = document.getElementById("season");
    const coldEl = document.getElementById("coldTemp");
    seasonEl.addEventListener("change", () => {
      coldEl.value = CONFIG.seasons[seasonEl.value].cold;
    });
    coldEl.value = CONFIG.seasons[seasonEl.value].cold;
  }

  /** 花洒基准（能力边界文案用） */
  function showerBasis() {
    let flow = 9, name = "花洒";
    bathrooms.forEach((b) => b.fixtures.forEach((f) => {
      const def = FIXTURES[f.key];
      if (def && def.shower) {
        const fl = f.flow != null ? f.flow : def.flow;
        if (fl >= flow) { flow = fl; name = def.name; }
      }
    }));
    return { flow, name };
  }

  // ===== 展示组件 =====
  function itemsText(items) {
    return items.map((it) => it.product.name).join(" ＋ ");
  }

  function planTable(items) {
    const rows = items.map((it) => {
      const subtotal = it.price * it.qty;
      return `<tr><td>${it.name}</td><td>${it.spec || "—"}</td>
        <td>¥${it.price.toLocaleString()}</td><td>${it.qty}</td>
        <td>¥${subtotal.toLocaleString()}</td></tr>`;
    });
    const total = items.reduce((s, it) => s + it.price * it.qty, 0);
    return `<table>
      <tr><th>项目</th><th>规格/说明</th><th>单价</th><th>数量</th><th>小计</th></tr>
      ${rows.join("")}
      <tr class="total-row"><td colspan="4">合计</td><td>¥${total.toLocaleString()}</td></tr>
    </table>`;
  }

  /** 判定 chips */
  function checksHtml(chk) {
    const chips = ["r1", "r2", "r3"]
      .filter((k) => chk[k])
      .map((k) => `<li class="chk-${chk[k].level}">${chk[k].text}</li>`)
      .join("");
    return `<ul class="checks">${chips}</ul>`;
  }

  /** 产品卖点与质保 */
  function sellingHtml(plan) {
    const p = plan.items[0].product;
    if (!p.sellingPoints) return "";
    return `<div class="selling">
      <p class="selling-title">产品卖点</p>
      <ul>${p.sellingPoints.map((s) => `<li>${s}</li>`).join("")}</ul>
      <p class="warranty">质保：${p.warranty}</p>
    </div>`;
  }

  /** 场景化话术 */
  function talkTrack(plan, dem) {
    const p = plan.items[0].product;
    const lines = [];
    if (p.powerKW >= 40) lines.push(`${p.powerKW}kW 大功率，相当于 ${Math.round(p.powerKW / 20)} 台 20kW 壁挂炉的功率总和`);
    lines.push(`产热水能力 ${plan.cap.rRate.toFixed(1)} L/min，10 分钟可供 ${plan.cap.v10.toFixed(0)} L，1 小时可供 ${plan.cap.v1h.toFixed(0)} L`);
    lines.push(`满水再加热约 ${plan.cap.tReheatMin.toFixed(0)} 分钟`);
    return lines;
  }

  /** 计算明细（折叠；逐卫生间展开需求侧，供给侧全公式代入） */
  function calcStepsHtml(plan, dem, temps) {
    const delta = temps.mixed - temps.cold;
    const demandLines = dem.detail.map((d) =>
      `<p>· ${d.name}：${d.parts.join("；")}　→ 小计 <b>${d.subtotal.toFixed(0)} L</b></p>`).join("");
    const supplyLines = plan.items.map((it) => {
      const p = it.product;
      const c = HWCalc.capability(CONFIG, p, temps);
      return `<p>· ${p.id}（${p.tankL}L/${p.powerKW}kW）：
        混水量 C = ${p.tankL} × (${temps.set}−${temps.cold}) ÷ (${temps.mixed}−${temps.cold}) = ${c.cMix.toFixed(0)}L；
        产热水能力 R = ${p.powerKW} × 860 ÷ (60 × ${delta}) = ${c.rRate.toFixed(1)}L/min；
        满水再加热 = ${p.tankL} × (${temps.set}−${temps.cold}) ÷ (${p.powerKW} × 860) × 60 = ${c.tReheatMin.toFixed(0)} 分钟</p>`;
    }).join("");
    const judge = plan.checks.r1;
    // 错峰逐时刻校验表
    const timelineRows = (plan.timelineChecked || []).map((bp) =>
      `<tr class="${bp.ok ? "" : "row-fail"}">
        <td>第 ${bp.t.toFixed(0)} 分钟</td>
        <td>${bp.active.join("、")}</td>
        <td>${bp.cumD.toFixed(0)} L</td>
        <td>${bp.avail.toFixed(0)} L</td>
        <td>${bp.ok ? "✓" : "✗ 断供"}</td>
      </tr>`).join("");
    const timelineTable = timelineRows
      ? `<p><b>逐时刻校验</b>（每个卫生间结束用水的时刻都检查：累计需求 ≤ 可供 C+R×t）：</p>
         <table class="dur-table"><tr><th>时刻</th><th>在用卫生间</th><th>累计需求</th><th>可供水量</th><th>判定</th></tr>${timelineRows}</table>`
      : "";
    return `<details class="calc-steps">
      <summary>查看计算明细</summary>
      <div class="steps-body">
        <p><b>工况</b>：冷水 ${temps.cold}℃ · 机器设定 ${temps.set}℃ · 洗澡温度 ${temps.mixed}℃（温差 ${delta}℃）</p>
        <p><b>需求侧</b>（同时开启 ${dem.concurrentCount} 个卫生间，逐个计算）：</p>
        ${demandLines}
        <p>用水总量 D = ${dem.detail.map((d) => d.subtotal.toFixed(0)).join(" + ")} = <b>${dem.dTotal.toFixed(0)} L</b></p>
        <p>瞬时流量 q = ${dem.flowParts.join(" + ")} = <b>${dem.qDem.toFixed(1)} L/min</b>；
          需要时长 t = <b>${dem.tNeed.toFixed(0)} 分钟</b>（各卫生间淋浴时长与浴缸注水时长中最长）</p>
        <p><b>供给侧</b>：混水量 C = <b>${plan.cap.cMix.toFixed(0)} L</b>；产热水能力 R = <b>${plan.cap.rRate.toFixed(1)} L/min</b></p>
        ${timelineTable}
        ${supplyLines}
        <p class="judge ${judge.pass ? "judge-pass" : "judge-fail"}"><b>判定：${judge.pass ? "✓ 满足" : "✗ 不满足"}</b>　${judge.text}</p>
      </div>
    </details>`;
  }

  /** 场景试算器：顶喷/手持/浴缸自由组合，即时出可持续时长 */
  function scenarioHtml(plan, planIdx) {
    return `<div class="dur-block" data-plan="${planIdx}">
      <p class="sc-title">场景试算（自由组合，即时出结果）：</p>
      <div class="sc-controls">
        <label>顶喷花洒 <input class="sc-input" type="number" min="0" max="8" value="0" data-plan="${planIdx}" data-fx="rain"> 个</label>
        <label>手持花洒 <input class="sc-input" type="number" min="0" max="8" value="0" data-plan="${planIdx}" data-fx="handheld"> 个</label>
        <label>浴缸 <input class="sc-input" type="number" min="0" max="4" value="0" data-plan="${planIdx}" data-fx="bathtub"> 个</label>
      </div>
      <div class="sc-result" id="scResult-${planIdx}"><span class="dur-note">选择数量后自动计算可持续洗浴时长</span></div>
    </div>`;
  }

  /** 场景试算：瞬时流量 q、可持续时长 T = C/(q−R)、与需要时长 tNeed 对比 */
  function scenarioResultHtml(plan, counts) {
    const q = counts.rain * FIXTURES.rain.flow + counts.handheld * FIXTURES.handheld.flow +
              counts.bathtub * FIXTURES.bathtub.flow;
    if (q <= 0) return `<span class="dur-note">选择数量后自动计算可持续洗浴时长</span>`;
    const tubVol = counts.bathtub * FIXTURES.bathtub.volume;
    const desc = [
      counts.rain > 0 ? `${counts.rain} 个顶喷（各 ${FIXTURES.rain.flow} L/min）` : "",
      counts.handheld > 0 ? `${counts.handheld} 个手持（各 ${FIXTURES.handheld.flow} L/min）` : "",
      counts.bathtub > 0 ? `${counts.bathtub} 个浴缸（各 ${FIXTURES.bathtub.volume}L，注水 ${FIXTURES.bathtub.flow} L/min）` : "",
    ].filter(Boolean).join(" + ");
    const cap = plan.cap;
    const tNeed = lastDem ? lastDem.tNeed : 15;
    let line2;
    if (cap.rRate >= q) {
      line2 = `可持续 <b>不限时长</b>（产热水能力 ${cap.rRate.toFixed(1)} ≥ 需求流量 ${q.toFixed(1)} L/min）`;
    } else {
      const t = Math.floor(cap.cMix / (q - cap.rRate));
      const ok = t >= tNeed;
      line2 = `可持续约 <b>${t} 分钟</b>（T = C÷(q−R) = ${cap.cMix.toFixed(0)}÷(${q.toFixed(1)}−${cap.rRate.toFixed(1)})），` +
        (ok ? `≥ 需要 ${tNeed.toFixed(0)} 分钟 <b class="sc-ok">✓ 够用</b>`
            : `< 需要 ${tNeed.toFixed(0)} 分钟 <b class="sc-no">✗ 不够</b>`);
    }
    return `<p>场景：${desc}</p><p>瞬时流量 q = <b>${q.toFixed(1)} L/min</b>；${line2}</p>`;
  }

  /** 无解/不达标时的能力边界 */
  function shortfallHtml(plan, dem) {
    const { flow, name } = showerBasis();
    const b = HWCalc.capacityBoundary(CONFIG, plan.cap, flow);
    const lines = [];
    if (b.maxShowersUnlimited > 0) lines.push(`${b.maxShowersUnlimited} 个${name}（各 ${flow} L/min）同开，不限时长`);
    lines.push(`单次洗浴（15 分钟）最多可供热水 ${b.avail15.toFixed(0)} L`);
    return `<div class="shortfall">
      <p><b>⚠ 该档位单机无法完全满足当前需求</b>，此机型可满足：</p>
      <ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>
      <p class="shortfall-sug">建议：选择更高档位机型，或与厂家确认分区供水方案（如分层分设主机）。</p>
    </div>`;
  }

  // ===== 主流程 =====
  function onGenerate() {
    const custName = document.getElementById("custName");
    const custPhone = document.getElementById("custPhone");
    const custAddr = document.getElementById("custAddr");
    const peopleEl = document.getElementById("people");

    // 必填与格式校验：姓名必填；电话仅数字（11 位）；地址必填且仅中文；常住 1~10 人
    const rules = [
      { el: custName, bad: !custName.value.trim() },
      { el: custPhone, bad: !/^\d{11}$/.test(custPhone.value.trim()) },
      { el: custAddr, bad: !/^[\u4e00-\u9fa5]+$/.test(custAddr.value.trim()) },
      { el: peopleEl, bad: !peopleEl.value.trim() || +peopleEl.value < 1 || +peopleEl.value > 10 },
    ];
    let firstBad = null;
    rules.forEach(({ el, bad }) => {
      el.classList.toggle("field-error", bad);
      if (bad && !firstBad) firstBad = el;
    });
    if (firstBad) {
      const msgs = {
        custName: "请填写客户姓名",
        custPhone: "联系电话须为 11 位数字",
        custAddr: "项目地址为必填项，且只能填写中文",
        people: "常住人口须为 1~10 人",
      };
      alert(msgs[firstBad.id]);
      firstBad.focus();
      return;
    }

    const used = bathrooms.filter((b) => b.fixtures.length > 0);
    if (used.length === 0) { alert("请先添加卫生间并加入洁具"); return; }

    const cond = readConditions();
    const people = +peopleEl.value;
    const dem = HWCalc.demand(CONFIG, FIXTURES, bathrooms, people, people);
    const result = HWCalc.matchTiers(CONFIG, PRODUCTS, TIERS, dem, cond.temps);
    lastDem = dem;

    const cust = {
      name: custName.value.trim(),
      phone: custPhone.value.trim(),
      addr: document.getElementById("custAddr").value.trim(),
    };

    calcSummary.innerHTML = `
      <p>设计工况：<b>${cond.seasonName}季</b>（冷水 ${cond.temps.cold}℃）· 机器设定 <b>${cond.temps.set}℃</b> · 洗澡温度 <b>${cond.temps.mixed}℃</b> · 常住 <b>${people}</b> 人</p>
      <p>需求侧：同时洗浴 <b>${dem.n}</b> 个花洒 · 瞬时流量 <b>${dem.qDem.toFixed(1)} L/min</b> · 用水总量 <b>${dem.dTotal.toFixed(0)} L</b> · 需要时长 <b>${dem.tNeed.toFixed(0)} 分钟</b>${dem.hasAlwaysOn ? " · <b>含一直洗</b>（按持续产热水能力判定）" : ""}</p>`;

    // 推荐排序：最能满足且最便宜的档位排最前（标"推荐"）
    const tierKeys = TIERS.map((t) => t.key);
    const recKey = tierKeys.find((k) => result[k] && !result[k].shortfall) || null;
    const orderedKeys = recKey ? [recKey, ...tierKeys.filter((k) => k !== recKey)] : tierKeys;

    let html = "";
    const quotePlans = [];
    lastPlans = [];

    orderedKeys.forEach((key, idx) => {
      const tier = TIERS.find((t) => t.key === key);
      const plan = result[key];
      if (!plan) return;
      lastPlans[idx] = plan;
      const items = plan.items.map((it) => ({
        name: it.product.name, qty: it.qty, price: it.product.price,
        spec: `${it.product.tankL}L / ${it.product.powerKW}kW`,
      })).concat(ACCESSORIES.map((a) => ({ name: a.name, spec: a.note, price: a.price, qty: 1 })));

      const isRec = key === recKey;
      const track = talkTrack(plan, dem).map((l) => `<li>${l}</li>`).join("");
      html += `<div class="plan ${isRec ? "plan-rec" : ""}">
        <h3><span class="tag tag-${tier.key}">${tier.name}</span>${isRec ? '<span class="rec-badge">推荐</span>' : ""}<span class="plan-models">${itemsText(plan.items)}</span></h3>
        ${plan.shortfall ? shortfallHtml(plan, dem) : ""}
        <ul class="talk-track">${track}</ul>
        ${checksHtml(plan.checks)}
        ${planTable(items)}
        ${sellingHtml(plan)}
        <p class="cost-line">初投资 <b>¥${plan.cost.capex.toLocaleString()}</b>（不含辅材）</p>
        ${scenarioHtml(plan, idx)}
        ${calcStepsHtml(plan, dem, cond.temps)}
      </div>`;
      quotePlans.push({ title: tier.name, rec: isRec, plan, items });
    });

    html += `<p class="basis-note">设计依据：《热水计算底层逻辑》（恒热内部口径 ${typeof LOGIC_VERSION !== "undefined" ? LOGIC_VERSION : ""}）；GB 50015-2019《建筑给水排水设计标准》</p>`;

    tierResults.innerHTML = html;
    renderQuote(dem, cond, cust, quotePlans);

    // 选型提交留痕（在线：上报服务器；离线：写 localStorage 兜底）
    const record = {
      customer: cust,
      conditions: `${cond.seasonName}季·冷水${cond.temps.cold}℃·设定${cond.temps.set}℃·洗澡${cond.temps.mixed}℃·常住${people}人`,
      bathrooms: bathrooms.filter((b) => b.fixtures.length > 0).map((b) =>
        `${b.name}：${b.fixtures.map((f) => {
          const def = FIXTURES[f.key];
          return def.volume > 0 ? `${def.name}${f.volume}L` : `${def.name}${f.flow}L/min`;
        }).join("+")}，${b.alwaysOn ? "一直洗" : b.minutes + "分钟"}${b.concurrent ? "，同时开" : ""}`
      ).join("\n"),
      result: TIERS.map((t) => {
        const p = result[t.key];
        return p ? `${t.name}：${p.items.map((it) => it.product.id).join("+")}${p.shortfall ? "（不足）" : ""}` : "";
      }).filter(Boolean).join("\n"),
    };
    const token = localStorage.getItem("everhot_token");
    if (token) {
      fetch("/api/selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, record }),
      }).catch(() => {});
    }
    try {
      const selections = JSON.parse(localStorage.getItem("everhot_selections") || "[]");
      selections.push({ time: Date.now(), ...record });
      localStorage.setItem("everhot_selections", JSON.stringify(selections));
    } catch {}
    resultSection.classList.remove("hidden");
    resultSection.scrollIntoView({ behavior: "smooth" });
  }

  // ===== 报价单（打印区域） =====
  // ===== 报价单（打印区域）：高端客户版式 =====
  function renderQuote(dem, cond, cust, plans) {
    const date = new Date().toLocaleDateString("zh-CN");
    // 经销商信息取登录时填写的内容
    const dealerName = localStorage.getItem("everhot_company") || DEALER.name;
    const dealerPhone = localStorage.getItem("everhot_phone") || "";
    const bathroomDesc = bathrooms.filter((b) => b.fixtures.length > 0).map((b) => {
      const names = b.fixtures.map((f) => {
        const def = FIXTURES[f.key];
        return def.volume > 0 ? `${def.name}(${f.volume}L)` : `${def.name}(${f.flow}L/min)`;
      }).join("+");
      return `${b.name}（${names}，${b.alwaysOn ? "一直洗" : b.minutes + "分钟"}${b.concurrent ? "，同时开启" : ""}）`;
    }).join("；");

    // 每个方案：卖点话术 + 选型依据（计算过程）
    const sections = plans.map(({ title, rec, plan, items }) => {
      const p = plan.items[0].product;
      const cap = plan.cap;
      const t = cond.temps;
      const delta = t.mixed - t.cold;
      const track = talkTrack(plan, dem).map((l) => `<li>${l}</li>`).join("");
      const sell = p.sellingPoints
        ? `<ul class="q-sell">${p.sellingPoints.map((s) => `<li>${s}</li>`).join("")}</ul>
           <p class="q-warranty">质保承诺：${p.warranty}</p>` : "";
      const judge = plan.checks.r1;
      // 选型依据：为什么这台机器合理
      const reason = `
        <div class="q-reason">
          <p class="q-reason-title">选型计算依据</p>
          <p>用水需求：同时开启 ${dem.concurrentCount} 个卫生间，用水总量 <b>${dem.dTotal.toFixed(0)} L</b>，瞬时流量 <b>${dem.qDem.toFixed(1)} L/min</b>，最长用水 <b>${dem.tNeed.toFixed(0)} 分钟</b></p>
          <p>本机能力：混水量 C = ${p.tankL}×(${t.set}−${t.cold})÷(${t.mixed}−${t.cold}) = <b>${cap.cMix.toFixed(0)} L</b>；
            产热水能力 R = ${p.powerKW}×860÷(60×${delta}) = <b>${cap.rRate.toFixed(1)} L/min</b></p>
          <p>可供水量 = C + R×t = ${cap.cMix.toFixed(0)} + ${cap.rRate.toFixed(1)}×${dem.tNeed.toFixed(0)} = <b>${(cap.cMix + cap.rRate * dem.tNeed).toFixed(0)} L</b></p>
          <p class="q-judge ${judge.pass ? "ok" : "no"}">结论：${judge.pass ? "✓ 满足" : "✗ 不满足"} — ${judge.text}</p>
        </div>`;
      return `<section class="q-plan ${rec ? "q-rec" : ""}">
        <h3 class="q-plan-title"><span class="q-tier">${title}</span>${rec ? '<span class="q-rec-tag">推荐方案</span>' : ""}<span class="q-model">${itemsText(plan.items)}</span></h3>
        <ul class="q-track">${track}</ul>
        ${planTable(items)}
        ${sell}
        ${reason}
        <p class="q-capex">方案投资（不含辅材）：<b>¥${plan.cost.capex.toLocaleString()}</b></p>
      </section>`;
    }).join("");

    quoteEl.innerHTML = `
      <div class="q-head">
        <img src="assets/everhot-logo.png" alt="EVERHOT 恒热" class="logo">
        <div class="q-head-right">报价日期：${date}</div>
      </div>
      <div class="q-titlebar">别墅热水系统选型报价单</div>

      <section class="q-block">
        <h3 class="q-block-title">客户与设计工况</h3>
        <div class="q-meta">
          <p>客户姓名：${cust.name}　联系电话：${cust.phone}</p>
          <p>项目地址：${cust.addr}</p>
          <p>设计工况：${cond.seasonName}季（冷水 ${cond.temps.cold}℃）· 机器设定 ${cond.temps.set}℃ · 洗澡温度 ${cond.temps.mixed}℃ · 常住 ${dem.people} 人</p>
          <p>户型配置：${bathroomDesc}</p>
        </div>
      </section>

      ${sections}

      <div class="q-foot">
        <p>经销商：${dealerName}${dealerPhone ? "　联系电话：" + dealerPhone : ""}</p>
        <p>说明：本报价为选型参考价，最终价格以实际签约为准；产品参数以厂家最新技术资料为准。</p>
      </div>`;
  }

  // ===== 事件绑定 =====
  document.getElementById("addBathroomBtn").addEventListener("click", addBathroom);
  document.getElementById("generateBtn").addEventListener("click", onGenerate);
  document.getElementById("printBtn").addEventListener("click", () => window.print());

  // 打印预览：把报价单内容克隆到 A4 预览页
  const previewModal = document.getElementById("previewModal");
  document.getElementById("previewBtn").addEventListener("click", () => {
    document.getElementById("previewPage").innerHTML = quoteEl.innerHTML;
    previewModal.classList.remove("hidden");
  });
  document.getElementById("previewCloseBtn").addEventListener("click", () => previewModal.classList.add("hidden"));
  document.getElementById("previewPrintBtn").addEventListener("click", () => window.print());
  previewModal.addEventListener("click", (e) => { if (e.target === previewModal) previewModal.classList.add("hidden"); });

  // 场景试算器（事件委托，数量一变立即重算）
  tierResults.addEventListener("input", (e) => {
    if (!e.target.classList.contains("sc-input")) return;
    const idx = e.target.dataset.plan;
    const block = e.target.closest(".dur-block");
    const counts = { rain: 0, handheld: 0, bathtub: 0 };
    block.querySelectorAll(".sc-input").forEach((inp) => {
      counts[inp.dataset.fx] = Math.max(0, +inp.value || 0);
    });
    document.getElementById(`scResult-${idx}`).innerHTML = scenarioResultHtml(lastPlans[idx], counts);
  });

  renderBathrooms();
  bindSeasonAutofill();
})();
