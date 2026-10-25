/**
 * 登录门禁：经销商公司 + 手机号码（11 位数字）+ 统一密码
 * 在线部署时：密码由服务端校验，登录写入服务器记录
 * 本地调试（无服务器）时：回退到本地校验
 */
(function () {
  const screen = document.getElementById("loginScreen");
  const main = document.getElementById("mainPage");
  if (!screen || !main) return;

  function unlock() {
    screen.remove();
    main.style.display = "";
  }

  // 退出登录：清除登录态后回到登录界面
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      ["everhot_login", "everhot_token", "everhot_company", "everhot_phone"]
        .forEach((k) => localStorage.removeItem(k));
      location.reload();
    });
  }

  if (localStorage.getItem("everhot_login") === "1") { unlock(); return; }

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const company = document.getElementById("loginCompany").value.trim();
    const phone = document.getElementById("loginPhone").value.trim();
    const pwd = document.getElementById("loginPwd").value;
    const err = document.getElementById("loginError");

    let msg = "";
    if (!company) msg = "请填写经销商公司名称";
    else if (!/^\d{11}$/.test(phone)) msg = "手机号码须为 11 位数字";
    else if (!pwd) msg = "请输入密码";
    if (msg) {
      err.textContent = msg;
      err.classList.remove("hidden");
      return;
    }

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, phone, password: pwd }),
      });
      const data = await res.json();
      if (!data.ok) {
        err.textContent = data.msg || "登录失败";
        err.classList.remove("hidden");
        return;
      }
      localStorage.setItem("everhot_token", data.token);
    } catch {
      // 本地调试（file:// 或无 API）：回退本地校验
      if (pwd !== "EVERHOT") {
        err.textContent = "密码错误（统一密码请联系恒热获取）";
        err.classList.remove("hidden");
        return;
      }
    }

    localStorage.setItem("everhot_login", "1");
    localStorage.setItem("everhot_company", company);
    localStorage.setItem("everhot_phone", phone);

    // 本地留痕（在线模式由服务端记录；此处作为离线兜底）
    try {
      const logins = JSON.parse(localStorage.getItem("everhot_logins") || "[]");
      logins.push({ time: Date.now(), company, phone });
      localStorage.setItem("everhot_logins", JSON.stringify(logins));
    } catch {}

    unlock();
  });
})();
