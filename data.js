/**
 * 恒热 EVERHOT 别墅热水选型工具 — 常量参数、洁具库、产品库
 *
 * 计算逻辑依据：《热水计算底层逻辑.xlsx》（恒热内部口径）
 *   供给侧：混水量 C = 容积 × (机器设定温度 − 冷水温度) / (洗澡温度 − 冷水温度)
 *          产热水能力 R = 功率 × 860 / (60 × (洗澡温度 − 冷水温度))   [L/min]
 *   需求侧：D = Σ(每个卫生间洁具流量 × 使用时长)（+浴缸容积）
 *   判定：按最长使用时间 t 计算可供水量 C + R×t ≥ D
 * 所有常量与产品数据均参数化于此，代码不硬编码。
 */

const LOGIC_VERSION = "v3.0-恒热内部口径";

const CONFIG = {
  // ===== 温度参数（页面可调，此处为默认值；与底层逻辑表一致）=====
  setTemp: 60,              // 机器设定温度 °C
  mixedTemp: 43,            // 洗澡温度 °C（底层逻辑表口径）

  // 季节 → 冷水计算温度 °C（冬季默认最不利工况；页面可手动覆盖）
  seasons: {
    spring: { name: "春", cold: 10 },
    summer: { name: "夏", cold: 20 },
    autumn: { name: "秋", cold: 15 },
    winter: { name: "冬", cold: 5 },
  },
  defaultSeason: "winter",

  defaultMinutes: 15,       // 默认洗澡时长（分钟）
  personDailyL: 100,        // 每人日用水量 L（费用估算用）
  targetReheatMin: 60,      // 满水再加热目标时间（分钟），超过提示

  // 费用估算单价
  cGas: 3.0,                // 天然气单价 元/m³（热值 8500 kcal/m³）
  gasHeatValue: 8500,
  cEl: 0.6,                 // 电单价 元/kWh
  copHp: 3.0,               // 热泵能效比（费用估算用）
};

// ===== 洁具库（额定流量参照 GB 50015-2019 表3.2.12；流量/容积页面可逐个修改）=====
const FIXTURES = {
  handheld: { name: "手持花洒", flow: 9, volume: 0, shower: true,
    svg: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#EA0021" stroke-width="2" stroke-linecap="round"><path d="M4 20 L10 14"/><path d="M9 9 L15 15"/><path d="M11 6 L18 13"/><circle cx="18" cy="6" r="3"/><path d="M19 10 l1 2"/></svg>' },
  rain: { name: "顶喷花洒", flow: 14, volume: 0, shower: true,
    svg: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#EA0021" stroke-width="2" stroke-linecap="round"><path d="M12 3 v3"/><rect x="5" y="6" width="14" height="4" rx="2"/><path d="M7 14 v2 M12 14 v3 M17 14 v2"/></svg>' },
  bathtub: { name: "浴缸", flow: 20, volume: 300, shower: false,
    svg: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#EA0021" stroke-width="2" stroke-linecap="round"><path d="M3 12 h18 v3 a4 4 0 0 1 -4 4 H7 a4 4 0 0 1 -4 -4 z"/><path d="M5 12 V6 a2 2 0 0 1 4 0"/><path d="M6 21 l-1 1 M18 21 l1 1"/></svg>' },
};

// ===== 方案档位（对应底层逻辑表：标准版 / 舒适版 / 尊享版）=====
const TIERS = [
  { key: "economy",  name: "基础款方案", group: "标准版" },
  { key: "standard", name: "中间款方案", group: "舒适版" },
  { key: "premium",  name: "豪华舒适方案", group: "尊享版" },
];

// ===== 产品库（型号/价格/参数与说明书、价格表、底层逻辑表核对一致）=====
// fuel: "gas" 燃气 / "heatpump" 热泵；powerKW 为底层逻辑表口径的功率
// group: 标准版 / 舒适版 / 尊享版（对应三档方案）
// sellingPoints / warranty：产品卖点与质保期（GCC 系列取自方案书与说明书；
//   EDGS/EHPD 待厂家官方话术确认后替换）
const PRODUCTS = [
  { id: "EDGS300-PDV", name: "恒热燃气容积式热水炉 EDGS300-PDV",
    fuel: "gas", tankL: 300, powerKW: 19, group: "标准版",
    price: 33658, desc: "300L 燃气容积式，室内强排，恒温舒适",
    sellingPoints: ["300L 大容量储水，水温恒定波动小", "室内强制排气式，安装灵活", "燃气即热补充，洗浴不间断"],
    warranty: "以厂家最新质保政策为准" },
  { id: "EHPD400-5207C", name: "恒热热泵热水器 EHPD400-5207C",
    fuel: "heatpump", tankL: 400, powerKW: 8.7, group: "舒适版",
    price: 38988, desc: "2P 空气源热泵，一级能效，400L 大容量",
    sellingPoints: ["空气源热泵，一级能效，运行省电", "400L 超大容量，多人连续洗浴", "水电分离，安全无忧"],
    warranty: "以厂家最新质保政策为准" },
  { id: "GCC280-52HP-H", name: "恒热混动容积式热水炉 GCC280-52HP-H",
    fuel: "gas", tankL: 280, powerKW: 52, group: "尊享版",
    price: 78999, desc: "HART3.0 混动双擎，52kW 澎湃动力",
    sellingPoints: ["HART3.0 混动双擎：燃气+热泵智能切换", "热效率超 107%（按低热值）", "LeakSense 泄漏监控、NOx<30mg/m³", "褐金搪瓷抑菌内胆，抗菌率 99%", "IoT 智联，手机远程控制"],
    warranty: "整机 5 年，内胆 8 年" },
  { id: "GCC380-70HP-H", name: "恒热混动容积式热水炉 GCC380-70HP-H",
    fuel: "gas", tankL: 380, powerKW: 70, group: "尊享版",
    price: 110999, desc: "70kW 大功率，多卫同时用水无衰减",
    sellingPoints: ["HART3.0 混动双擎：燃气+热泵智能切换", "70kW 大功率，相当于 3.5 台壁挂炉", "褐金搪瓷抑菌内胆，抗菌率 99%", "IoT 智联，手机远程控制"],
    warranty: "整机 5 年，内胆 8 年" },
  { id: "GCC380-90HP-H", name: "恒热混动容积式热水炉 GCC380-90HP-H",
    fuel: "gas", tankL: 380, powerKW: 90, group: "尊享版",
    price: 142999, desc: "90kW 旗舰，8 卫同开热水澎湃",
    sellingPoints: ["HART3.0 混动双擎：燃气+热泵智能切换", "90kW 旗舰功率，8 卫同开热水澎湃", "褐金搪瓷抑菌内胆，抗菌率 99%", "LeakSense 泄漏监控、NOx<30mg/m³", "IoT 智联，手机远程控制"],
    warranty: "整机 5 年，内胆 8 年" },
];

// ===== 建议辅件（计入报价单）=====
const ACCESSORIES = [
  { id: "PUMP", name: "热水循环泵（即开即热）", price: 1200, note: "别墅多层建议配置" },
  { id: "PIPE", name: "管路及安装辅材", price: 800, note: "按常规户型预估" },
];

// ===== 经销商信息（占位，打印在报价单上）=====
const DEALER = {
  name: "恒热授权经销商",
  contact: "联系电话：000-00000000",
};
