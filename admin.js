/* NeuroVerbs — Panel de Administrador (Auth API + D1)
   - Login admin (usuario/contraseña)
   - Crear/gestionar cuentas
   - Bootstrap para crear el primer admin (solo una vez)
*/
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const ui = {
    // bootstrap
    bootUsername: $("bootUsername"),
    bootName: $("bootName"),
    bootEmail: $("bootEmail"),
    bootPass: $("bootPass"),
    bootToken: $("bootToken"),
    btnBootstrap: $("btnBootstrap"),
    bootMsg: $("bootMsg"),

    // login
    adminLogin: $("adminLogin"),
    loginUser: $("loginUser"),
    loginPass: $("loginPass"),
    btnLogin: $("btnLogin"),
    btnCfgApi: $("btnCfgApi"),
    loginMsg: $("loginMsg"),

    // state cards
    adminDenied: $("adminDenied"),
    adminPanel: $("adminPanel"),

    // create user
    newName: $("newName"),
    newUsername: $("newUsername"),
    newEmail: $("newEmail"),
    newPass: $("newPass"),
    newRole: $("newRole"),
    btnCreate: $("btnCreate"),
    createMsg: $("createMsg"),

    // list
    btnRefresh: $("btnRefresh"),
    usersTbody: $("usersTbody"),
    usersMsg: $("usersMsg"),
  };

  function setMsg(el, text, ok) {
    if (!el) return;
    el.textContent = text || "";
    el.className = ok ? "ok" : "bad";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showOnly(which) {
    // which: 'panel' | 'denied' | 'login'
    if (ui.adminPanel) ui.adminPanel.style.display = (which === "panel") ? "block" : "none";
    if (ui.adminDenied) ui.adminDenied.style.display = (which === "denied") ? "block" : "none";
    if (ui.adminLogin) ui.adminLogin.style.display = (which === "login") ? "block" : "none";
  }

  async function ensureApiBase() {
    const current = (window.NVAuth && NVAuth.getApiBase) ? (NVAuth.getApiBase() || "") : "";
    if (current) return current;
    // No forzamos prompt, solo avisamos.
    throw new Error("Primero configura la API (Auth API Base)");
  }

  async function whoAmI() {
    const res = await NVAuth.me();
    const me = res && (res.user || res.me || res);
    if (!me) throw new Error("No se pudo validar sesión");
    return me;
  }

  function renderUsers(users) {
    const tb = ui.usersTbody;
    if (!tb) return;
    tb.innerHTML = "";

    (users || []).forEach((u) => {
      const tr = document.createElement("tr");
      const active = (u.active === undefined ? true : !!u.active);
      tr.innerHTML = `
        <td>${escapeHtml(String(u.id ?? ""))}</td>
        <td>${escapeHtml(String(u.username ?? ""))}</td>
        <td>${escapeHtml(String(u.name ?? ""))}</td>
        <td>${escapeHtml(String(u.email ?? ""))}</td>
        <td>${escapeHtml(String(u.role ?? "student"))}</td>
        <td>${active ? "✅" : "⛔"}</td>
        <td>
          <div class="actions">
            <button class="miniBtn" data-act="toggle" data-id="${u.id}" data-active="${active ? "1" : "0"}">${active ? "Desactivar" : "Activar"}</button>
            <button class="miniBtn" data-act="role" data-id="${u.id}">Cambiar rol</button>
            <button class="miniBtn" data-act="reset" data-id="${u.id}">Reset pass</button>
          </div>
        </td>
      `;
      tb.appendChild(tr);
    });
  }

  async function listUsers() {
    setMsg(ui.usersMsg, "Cargando usuarios...", true);
    const data = await NVAuth.api("/api/admin/users", { method: "GET" });
    const users = data && (data.users || data.data || data);
    const arr = Array.isArray(users) ? users : (users && users.users ? users.users : []);
    renderUsers(arr);
    setMsg(ui.usersMsg, `Total: ${arr.length}`, true);
  }

  async function toggleUser(id, currentActive) {
    const nextActive = currentActive ? 0 : 1;
    await NVAuth.api(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { active: nextActive }
    });
  }

  async function changeRole(id) {
    const role = prompt("Nuevo rol (admin | student)", "student");
    if (role === null) return;
    const r = String(role).trim();
    await NVAuth.api(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { role: r }
    });
  }

  async function resetPassword(id) {
    const pass = prompt("Nueva contraseña", "");
    if (pass === null) return;
    if (String(pass).trim().length < 8) {
      alert("Contraseña muy corta (mínimo 8)");
      return;
    }
    // Worker espera 'password' para reset
    await NVAuth.api(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { password: String(pass) }
    });
  }

  async function doBootstrap() {
    setMsg(ui.bootMsg, "Creando admin...", true);

    try {
      await ensureApiBase();

      const username = String(ui.bootUsername?.value || "").trim().toLowerCase();
      const name = String(ui.bootName?.value || "").trim();
      const email = String(ui.bootEmail?.value || "").trim().toLowerCase();
      const password = String(ui.bootPass?.value || "");
      const bootstrapToken = String(ui.bootToken?.value || "");

      if (!username) throw new Error("Falta usuario");
      if (!password || password.length < 8) throw new Error("La contraseña debe tener mínimo 8 caracteres");
      if (!bootstrapToken) throw new Error("Falta Bootstrap Token");

      await NVAuth.api("/api/bootstrap/admin", {
        method: "POST",
        body: { username, name, email, password, bootstrapToken },
        token: "" // importante: sin Authorization
      });

      setMsg(ui.bootMsg, "Admin creado ✔ (ya puedes iniciar sesión abajo)", true);

      // Sugerencia: poner usuario en login
      if (ui.loginUser) ui.loginUser.value = username;
      if (ui.loginPass) ui.loginPass.focus();

    } catch (err) {
      setMsg(ui.bootMsg, String(err && err.message ? err.message : err), false);
    }
  }

  async function doLogin() {
    setMsg(ui.loginMsg, "Ingresando...", true);

    try {
      await ensureApiBase();

      const u = String(ui.loginUser?.value || "").trim();
      const p = String(ui.loginPass?.value || "");
      if (!u || !p) throw new Error("Escribe usuario y contraseña");

      await NVAuth.login(u, p);
      const me = await whoAmI();

      if (String(me.role || "").toLowerCase() !== "admin") {
        showOnly("denied");
        setMsg(ui.loginMsg, "Tu cuenta no tiene rol admin", false);
        return;
      }

      // registrar en Sheets (delta 0) para que exista en leaderboard si aplica
      try { await NVAuth.registerZeroXp(); } catch (_) {}

      showOnly("panel");
      setMsg(ui.loginMsg, "", true);
      await listUsers();

    } catch (err) {
      showOnly("login");
      setMsg(ui.loginMsg, String(err && err.message ? err.message : err), false);
    }
  }

  async function boot() {
    // Mostrar login por defecto
    showOnly("login");

    // Prefill requerido por el usuario
    if (ui.loginUser && !ui.loginUser.value) ui.loginUser.value = "spellingyoguisbe";

    // Configurar API
    if (ui.btnCfgApi) {
      ui.btnCfgApi.addEventListener("click", () => {
        const current = NVAuth.getApiBase() || "";
        const v = prompt(
          "Pega la URL base de tu API de autenticación (Cloudflare Worker).\nEj: https://tu-worker.tudominio.workers.dev",
          current
        );
        if (v !== null) {
          NVAuth.setApiBase(v);
          setMsg(ui.loginMsg, "API guardada ✔", true);
        }
      });
    }

    // Bootstrap
    if (ui.btnBootstrap) ui.btnBootstrap.addEventListener("click", doBootstrap);

    // Login
    if (ui.btnLogin) ui.btnLogin.addEventListener("click", doLogin);

    // Enter en password
    if (ui.loginPass) {
      ui.loginPass.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doLogin();
      });
    }

    // Create user
    if (ui.btnCreate) {
      ui.btnCreate.addEventListener("click", async () => {
        setMsg(ui.createMsg, "Creando...", true);
        try {
          const body = {
            username: String(ui.newUsername?.value || "").trim().toLowerCase(),
            name: String(ui.newName?.value || "").trim(),
            email: String(ui.newEmail?.value || "").trim().toLowerCase(),
            password: String(ui.newPass?.value || ""),
            role: String(ui.newRole?.value || "student").trim()
          };
          if (!body.username) throw new Error("Falta usuario");
          if (!body.password || body.password.length < 8) throw new Error("Contraseña muy corta (mínimo 8)");

          await NVAuth.api("/api/admin/users", { method: "POST", body });
          if (ui.newPass) ui.newPass.value = "";
          setMsg(ui.createMsg, "Usuario creado ✔", true);
          await listUsers();
        } catch (err) {
          setMsg(ui.createMsg, String(err && err.message ? err.message : err), false);
        }
      });
    }

    // Refresh
    if (ui.btnRefresh) ui.btnRefresh.addEventListener("click", () => listUsers().catch(e => setMsg(ui.usersMsg, String(e.message||e), false)));

    // Delegate actions
    document.addEventListener("click", async (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("button[data-act]") : null;
      if (!btn) return;
      const act = btn.getAttribute("data-act");
      const id = btn.getAttribute("data-id");
      const curA = btn.getAttribute("data-active");
      if (!act || !id) return;
      try {
        if (act === "toggle") { await toggleUser(id, curA === "1"); await listUsers(); }
        if (act === "role") { await changeRole(id); await listUsers(); }
        if (act === "reset") { await resetPassword(id); alert("Contraseña actualizada ✔"); }
      } catch (err) {
        alert(String(err && err.message ? err.message : err));
      }
    });

    // Si ya hay sesión local válida, entrar
    try {
      if (NVAuth.isLogged()) {
        const me = await whoAmI();
        if (String(me.role || "").toLowerCase() === "admin") {
          showOnly("panel");
          await listUsers();
        } else {
          showOnly("denied");
        }
      }
    } catch (_) {
      // sesión mala
      try { NVAuth.clearSession(); } catch(__) {}
      showOnly("login");
    }
  }

  window.addEventListener("load", boot);
})();
