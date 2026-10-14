# 恒热别墅热水选型系统 — 项目档案

> 本文件用于跨会话接续维护。新会话只需说"继续维护 hot-water-selector 选型工具"。
> 最后更新：2026-09-06

## 项目概述
为恒热（EVERHOT）经销商开发的别墅热水在线选型工具：登录门禁 → 拖拽配置卫生间洁具 → 三档方案（基础款/中间款/豪华舒适）+ 打印预览/报价单 + 合同模板 + 管理后台数据汇总。

## 目录结构（hot-water-selector/）
- `index.html` — 选型工具主页（含登录界面）
- `contract.html` — 销售合同模板（可填写打印，**内容不要改动**）
- `admin.html` — 管理后台（登录/选型记录），密码 `EVERHOT-ADMIN`
- `data.js` — 全部可配置数据：产品库（含卖点 sellingPoints / 质保 warranty）、价格、洁具、温度参数
- `calc.js` — 计算引擎（纯函数，恒热内部口径，含错峰断点校验）
- `app.js` — 页面交互（卫生间卡片内嵌洁具按钮、推荐方案置顶、场景试算器、报价单、打印预览）
- `login.js` — 登录门禁（在线走 /api/login 服务端验证，离线回退本地校验 EVERHOT）
- `serve.js` — 本地调试服务器（8080 端口，勿上传）
- `server-prod.js` — 生产服务器（部署时改名 server.js），含 /api/login、/api/selection、/api/admin
- `deploy.js` — 一键部署脚本（ssh2，装 Node + SFTP 上传 + systemd）
- `test-calc.js` — 计算引擎验收测试
- `assets/` — poster.jpg（海报原图）、poster-scene.jpg（裁剪场景图）、everhot-logo.png、quantum.png（产品透明底图）、hero-factory.jpg（主页主视觉：Rheem工厂实景，源自 混动方案书/34984975_…_o.jpg）
- `docs/` — 资料下载目录（leaflets 电子单页 / manuals 说明书 / cases 大宅案例 / brand 关于恒热）
- `tools/` — 部署工具（ssh2、server-auth.txt 服务器密码，勿上传）

## 计算逻辑口径（恒热内部《热水计算底层逻辑.xlsx》，用户最终确认版）
- 混水量 C = 容积 × (设定温度 − 冷水温度) ÷ (洗澡温度 − 冷水温度)，默认 设定60 / 洗澡43 / 冬季冷水5
- 产热水能力 R = 功率 kW × 860 ÷ (60 × 温差) [L/min]
- 判定：可供水量 = C + R×t ≥ 用水总量 D（t = 同时用水集合中最长时长）
- 一直洗场景：R ≥ 瞬时流量 q 才满足
- 错峰校验：每个卫生间结束用水的断点时刻都要满足 累计需求 ≤ C + R×t
- 三档产品组：标准版=EDGS300-PDV(300L/19kW/¥33658)、舒适版=EHPD400-5207C(400L/8.7kW/¥38988)、尊享版=GCC280-52(280L/52kW/¥78999) / GCC380-70(70kW/¥110999) / GCC380-90(90kW/¥142999)
- 每档单机，不满足时展示能力边界，不推荐多机并联
- 浴缸默认 300L / 20L/min；常住人数 1~10 必填；地址必填仅中文；电话 11 位数字
- 不显示年运行费（用户明确要求）；管路建议已删除（交给给排水专业人员）

## 登录页设计（按设计稿 1.jpeg，用户多轮确认）
- 左屏：品牌文案块（红点 + CENTRAL HOT WATER SYSTEM + EVERHOT FOR EVERLOVE + 大户型选恒热·商用级大水量 + 红短划线 + 副标题）→ Triton Hybrid 系列文案（居中）→ 场景图（poster-scene.jpg）+ 产品 quantum.png（left 35%、bottom 29%、height 72%，脚底贴地砖线）
- 右屏：logo 右上角不动，红色标题"别墅热水选型系统"，底部红色"400 服务热线：400-8869-119"
- 设计稿原件：C:\Users\Rheem\Desktop\混动方案书\1.jpeg

## 常用命令
- 本地预览：`cd hot-water-selector && node serve.js`（本机 8080）
- 回归测试：`cd hot-water-selector && node test-calc.js`（改计算逻辑后必跑）
- 部署上线：`cd hot-water-selector && SRV_PWD=$(cat tools/server-auth.txt) node deploy.js`

## 服务器（腾讯云轻量服务器，Ubuntu 24.04，2核4G）
- IP：1.117.59.208，工具运行在 **8088 端口**（8080 被服务器上原有的 DeepSeek 服务占用，勿动）
- SSH 用户：ubuntu；密码：见 `tools/server-auth.txt`（用户授权使用，勿外传勿上传）
- 代码位置：`/home/ubuntu/hotwater/`；数据：`/home/ubuntu/hotwater/data/logs.json`
- 系统服务：`hotwater.service`（开机自启）；日志：`sudo journalctl -u hotwater -n 50`
- 线上地址：http://1.117.59.208:8088 ；管理后台 /admin.html
- 防火墙：腾讯云控制台已放行 8088/TCP；服务器 ufw 已放行

## 待办/已知事项
- 域名未绑定（等用户购买备案域名后绑定 + HTTPS）
- EDGS300/EHPD400 的卖点和质保文案为占位，待厂家官方话术
- docs/manuals、docs/cases 资料目录为空，等用户拷文件
- 合同模板内容已定稿勿动
