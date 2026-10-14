/**
 * 选型计算引擎验收脚本：node test-calc.js
 * 依据《热水计算底层逻辑.xlsx》（恒热内部口径）：
 *   C = 容积×(设定−冷水)/(洗澡−冷水)；R = 功率×860/(60×(洗澡−冷水))
 *   可供水量 = C + R×t ≥ 用水总量 D；一直洗：R ≥ 瞬时流量 q
 * 基准工况：冷水 5℃、设定 60℃、洗澡 43℃
 */
const fs = require("fs");
const path = require("path");

const dataSrc = fs.readFileSync(path.join(__dirname, "data.js"), "utf8");
const { CONFIG, FIXTURES, PRODUCTS, TIERS } = new Function(
  dataSrc + "; return { CONFIG, FIXTURES, PRODUCTS, TIERS };"
)();
const HWCalc = require("./calc.js");

let failed = 0;
function assert(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failed++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const T = { cold: 5, set: 60, mixed: 43 };
const P = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

// ===== A. 供给侧与底层逻辑表逐行核对 =====
const table = [
  ["EDGS300-PDV", 434.2, 7.167],
  ["EHPD400-5207C", 578.9, 3.282],
  ["GCC280-52HP-H", 405.3, 19.614],
  ["GCC380-70HP-H", 550, 26.404],
  ["GCC380-90HP-H", 550, 33.947],
];
table.forEach(([id, cExp, rExp]) => {
  const c = HWCalc.capability(CONFIG, P[id], T);
  assert(`供给侧 ${id}：C≈${cExp} R≈${rExp}`,
    near(c.cMix, cExp,  1) && near(c.rRate, rExp, 0.05),
    `C=${c.cMix.toFixed(1)} R=${c.rRate.toFixed(2)}`);
});

// ===== B. 需求侧与三档匹配 =====
function bath(showers, tubs, minutes, concurrent, alwaysOn) {
  return {
    name: "卫生间", minutes, concurrent: !!concurrent, alwaysOn: !!alwaysOn,
    fixtures: [
      ...showers.map((fl) => ({ key: "rain", flow: fl, volume: 0 })),
      ...tubs.map((v) => ({ key: "bathtub", flow: FIXTURES.bathtub.flow, volume: v })),
    ],
  };
}
function match(bathrooms, people, peak, temps) {
  const dem = HWCalc.demand(CONFIG, FIXTURES, bathrooms, people, peak);
  return { dem, r: HWCalc.matchTiers(CONFIG, PRODUCTS, TIERS, dem, temps) };
}
const tierLine = (r) => ["economy", "standard", "premium"].map((k) =>
  r[k] ? `${r[k].items[0].product.id}${r[k].shortfall ? "(不足)" : ""}` : "无").join(" | ");

// S1：1卫 手持 9L×15min（冬）→ D=135，三档全满足，尊享取最便宜的 GCC280
(function () {
  const { dem, r } = match([bath([9], [], 15, true)], 2, 2, T);
  assert("S1 1卫手持：三档全满足，尊享=GCC280",
    near(dem.dTotal, 135, 1) && !r.economy.shortfall && r.premium.items[0].product.id === "GCC280-52HP-H",
    tierLine(r));
})();

// S2：2卫顶喷 14L×15min 同时（冬）→ D=420
// EDGS: 434+108=542 ✓；EHPD: 579+49=628 ✓；GCC280: 405+294=699 ✓
(function () {
  const { dem, r } = match([bath([14], [], 15, true), bath([14], [], 15, true)], 4, 4, T);
  assert("S2 2卫顶喷同时：三档全满足",
    near(dem.dTotal, 420, 1) && !r.economy.shortfall && !r.standard.shortfall && !r.premium.shortfall,
    tierLine(r));
})();

// S3：4卫顶喷同时 15min（冬）→ D=840
// EDGS 542 ✗、EHPD 628 ✗、GCC280 699 ✗、GCC380-70: 550+396=946 ✓
(function () {
  const { r } = match(Array.from({ length: 4 }, () => bath([14], [], 15, true)), 6, 6, T);
  assert("S3 4卫顶喷：基础/中间不足，尊享=GCC380-70",
    r.economy.shortfall && r.standard.shortfall &&
    r.premium.items[0].product.id === "GCC380-70HP-H" && !r.premium.shortfall,
    tierLine(r));
})();

// S4：2卫顶喷一直洗（冬）→ q=28：GCC280 19.6✗、GCC380-70 26.4✗、GCC380-90 33.9✓
(function () {
  const { r } = match([bath([14], [], 15, true, true), bath([14], [], 15, true, true)], 4, 4, T);
  assert("S4 一直洗：只有 GCC380-90 顶住",
    r.economy.shortfall && r.standard.shortfall &&
    r.premium.items[0].product.id === "GCC380-90HP-H" && !r.premium.shortfall,
    tierLine(r));
})();

// S5：夏季影响（冷水 20℃）：2卫顶喷同时 → EHPD 夏季可供 777L ≥ 420 ✓
(function () {
  const Ts = { cold: 20, set: 60, mixed: 43 };
  const { r } = match([bath([14], [], 15, true), bath([14], [], 15, true)], 4, 4, Ts);
  assert("S5 夏季中间档 EHPD400 满足", !r.standard.shortfall, tierLine(r));
})();

// S6：时长表 — GCC380-90 冬：R=33.9；2个顶喷(28)不限；3个(42)：T=550/(42−33.9)=68min
(function () {
  const cap = HWCalc.capability(CONFIG, P["GCC380-90HP-H"], T);
  const rows = HWCalc.durationTable(cap, 14, 3);
  assert("S6 时长表：2个不限、3个约68分钟",
    rows[1].unlimited && !rows[2].unlimited && near(rows[2].minutes, 68, 2),
    `2个=${rows[1].unlimited ? "不限" : rows[1].minutes}，3个=${rows[2].minutes}min`);
})();


// S7：浴缸新默认（300L、20L/min）— 1顶喷15min + 浴缸同时 → D=510，tNeed=15
(function () {
  const dem = HWCalc.demand(CONFIG, FIXTURES, [bath([14], [300], 15, true)], 2, 2);
  assert("S7 浴缸 300L/20L：D=510，tNeed=15（注水15分钟）",
    near(dem.dTotal, 510, 1) && near(dem.tNeed, 15,  0.1),
    `D=${dem.dTotal.toFixed(0)} tNeed=${dem.tNeed.toFixed(1)}`);
})();

// S8：错峰用水 — A 9L×10min + B 13L×12min + C 13L×20min 同时开，EDGS300（C=434, R=7.2）
// 断点校验：t=10: 350≤505 ✓；t=12: 402≤520 ✓；t=20: 506≤577 ✓ → 全程满足
(function () {
  const dem = HWCalc.demand(CONFIG, FIXTURES, [
    bath([9], [], 10, true), bath([13], [], 12, true), bath([13], [], 20, true)], 3, 3);
  const ev = HWCalc.evaluateCap(CONFIG, P["EDGS300-PDV"], HWCalc.capability(CONFIG, P["EDGS300-PDV"], T), dem, T);
  assert("S8 错峰 10/12/20min：EDGS 全程满足",
    ev.pass && ev.timelineChecked.length === 3 && ev.timelineChecked.every((x) => x.ok),
  `断点数=${ev.timelineChecked.length} 判定=${ev.checks.r1.text}`);
})();

// S9：错峰断供定位 — 4个14L顶喷，时长 10/12/15/20min，EDGS300
// t=10: 累计 560 > 可供 434+72=506 ✗ → 断供点插值 t=434.2/(56−7.17)=8.9 分钟
(function () {
  const dem = HWCalc.demand(CONFIG, FIXTURES, [
    bath([14], [], 10, true), bath([14], [], 12, true),
    bath([14], [], 15, true), bath([14], [], 20, true)], 4, 4);
  const ev = HWCalc.evaluateCap(CONFIG, P["EDGS300-PDV"], HWCalc.capability(CONFIG, P["EDGS300-PDV"], T), dem, T);
  assert("S9 错峰断供：第10分钟断供，插值≈8.9分钟",
    !ev.pass && near(ev.tMaxMin, 8.9, 0.3) && ev.timelineChecked[0].ok === false,
    `tMax=${ev.tMaxMin.toFixed(1)} 判定=${ev.checks.r1.text}`);
})();

console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
