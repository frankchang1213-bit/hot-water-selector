/**
 * 恒热别墅热水选型工具 — 生产服务器（静态文件 + 登录验证 + 数据汇总 API）
 * 部署于腾讯云轻量服务器 Ubuntu，Node.js 运行
 *
 * API：
 *   POST /api/login      {company, phone, password} 经销商登录（密码服务端校验）+ 登录留痕
 *   POST /api/selection  {token, record}            选型提交留痕
 *   POST /api/admin      {password}                 管理员获取全部记录
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = +process.env.PORT || 8080;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "logs.json");
const DEALER_PWD = process.env.DEALER_PWD || "EVERHOT";
const ADMIN_PWD = process.env.ADMIN_PWD || "EVERHOT-ADMIN";

// 有效登录 token（内存即可，重启后重新登录）
const tokens = new Set();

const DOC_ROOTS = {
  "/docs/leaflets/": path.join(ROOT, "docs", "leaflets"),
  "/docs/manuals/": path.join(ROOT, "docs", "manuals"),
  "/docs/cases/": path.join(ROOT, "docs", "cases"),
  "/docs/brand/": path.join(ROOT, "docs", "brand"),
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".json": "application/json; charset=utf-8",
};

function send(res, code, body, type) {
  res.writeHead(code, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), "application/json; charset=utf-8");

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { logins: [], selections: [] }; }
}
function writeData(d) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(buf || "{}")); } catch { resolve({}); } });
  });
}

function serveDocDir(res, route, dir) {
  fs.readdir(dir, (err, files) => {
    if (err) { send(res, 404, "目录不存在"); return; }
    const items = (files || [])
      .filter((f) => { try { return fs.statSync(path.join(dir, f)).isFile(); } catch { return false; } })
      .map((f) => `<li><a href="${route}${encodeURIComponent(f)}">${f}</a></li>`)
      .join("");
    const body = items || `<li style="color:#999">资料整理中，敬请期待</li>`;
    send(res, 200, `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
      <title>资料下载 · EVERHOT 恒热</title>
      <style>body{font-family:"Microsoft YaHei",sans-serif;max-width:800px;margin:40px auto;padding:0 20px}
      h1{font-size:20px;border-bottom:3px solid #EA0021;padding-bottom:10px}
      li{margin:10px 0}a{color:#1a1a1a}a:hover{color:#EA0021}
      .back{color:#888;font-size:13px}</style></head>
      <body><h1>资料下载</h1><ul>${body}</ul>
      <p><a class="back" href="/">← 返回选型工具</a></p></body></html>`, "text/html; charset=utf-8");
  });
}

http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);

  // ===== API =====
  if (req.method === "POST" && urlPath === "/api/login") {
    const { company, phone, password } = await readBody(req);
    if (!company || !/^\d{11}$/.test(phone || "")) return sendJson(res, 400, { ok: false, msg: "请填写公司名称和 11 位手机号" });
    if (password !== DEALER_PWD) return sendJson(res, 401, { ok: false, msg: "密码错误" });
    const token = crypto.randomUUID();
    tokens.add(token);
    const d = readData();
    d.logins.push({ time: Date.now(), company, phone, ip: req.socket.remoteAddress });
    writeData(d);
    return sendJson(res, 200, { ok: true, token });
  }

  if (req.method === "POST" && urlPath === "/api/selection") {
    const { token, record } = await readBody(req);
    if (!tokens.has(token)) return sendJson(res, 401, { ok: false, msg: "未登录" });
    const d = readData();
    d.selections.push({ time: Date.now(), ...record });
    writeData(d);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && urlPath === "/api/admin") {
    const { password } = await readBody(req);
    if (password !== ADMIN_PWD) return sendJson(res, 401, { ok: false, msg: "管理员密码错误" });
    return sendJson(res, 200, { ok: true, ...readData() });
  }

  // ===== 资料目录 =====
  const route = Object.keys(DOC_ROOTS).find((r) => urlPath.startsWith(r));
  if (route) {
    const dir = DOC_ROOTS[route];
    const rel = urlPath.slice(route.length);
    if (!rel) { serveDocDir(res, route, dir); return; }
    const file = path.join(dir, rel);
    if (!path.normalize(file).startsWith(path.normalize(dir))) return send(res, 403, "Forbidden");
    return fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, "文件不存在");
      send(res, 200, data, MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
    });
  }

  // ===== 静态文件 =====
  const p = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.join(ROOT, path.normalize(p).replace(/^([/\\])+/, ""));
  if (!file.startsWith(ROOT)) return send(res, 403, "Forbidden");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not Found");
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`恒热别墅热水选型系统已启动：http://0.0.0.0:${PORT}`);
});
