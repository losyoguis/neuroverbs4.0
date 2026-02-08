/* NeuroVerbs — Panel Admin (API propia) */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const ui = {
    loginCard: $("loginCard"),
    adminArea: $("adminArea"),
    inApiBase: $("inApiBase"),
    btnSaveApi: $("btnSaveApi"),
    inUser: $("adminUser"),
    inPass: $("adminPass"),
    btnLogin: $("btnAdminLogin"),
    loginMsg: $("loginMsg"),
    whoami: $("whoami"),
    btnRefresh: $("btnRefresh"),
    // create
    cUsername: $("cUsername"),
    cName: $("cName"),
    cEmail: $("cEmail"),
    cPass: $("cPass"),
    cRole: $("cRole"),
    btnCreate: $("btnCreate"),
    createMsg: $("createMsg"),
    // table
    usersTbody: $("usersTbody"),
    usersMsg: $("usersMsg"),
  };

  function setMsg(el, text, ok){
    if(!el) return;
    el.textContent = text || "";
    el.className = ok ? "ok" : "bad";
  }

  function normalizeMe(data){
    if(!data) return null;
    if(data.user) return data.user;
    if(data.me) return data.me;
    return data;
  }

  async function loadMe(){
    const u = normalizeMe(await NVAuth.me());
    if(!u) throw new Error("No se pudo validar sesión");
    return u;
  }

  function renderUsers(users){
    const tb = ui.usersTbody;
    if(!tb) return;
    tb.innerHTML = "";
    (users||[]).forEach(u => {
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
            <button class="miniBtn" data-act="toggle" data-id="${u.id}">${active ? "Desactivar" : "Activar"}</button>
            <button class="miniBtn" data-act="role" data-id="${u.id}">Cambiar rol</button>
            <button class="miniBtn" data-act="reset" data-id="${u.id}">Reset pass</button>
          </div>
        </td>
      `;
      tb.appendChild(tr);
    });
  }

  function escapeHtml(s){
    return String(s)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/\"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  async function listUsers(){
    setMsg(ui.usersMsg, "Cargando usuarios...", true);
    const data = await NVAuth.api("/api/admin/users", { method:"GET" });
    const users = data.users || data.data || data;
    renderUsers(Array.isArray(users) ? users : (users.users || []));
    setMsg(ui.usersMsg, `Total: ${(Array.isArray(users)?users:(users.users||[])).length}`, true);
  }

  async function toggleUser(id){
    const data = await NVAuth.api(`/api/admin/users/${encodeURIComponent(id)}`, {
      method:"PATCH",
      body:{ toggleActive:true }
    });
    return data;
  }

  async function changeRole(id){
    const role = prompt("Nuevo rol (admin | student)", "student");
    if(role === null) return;
    await NVAuth.api(`/api/admin/users/${encodeURIComponent(id)}`, {
      method:"PATCH",
      body:{ role:String(role).trim() }
    });
  }

  async function resetPassword(id){
    const pass = prompt("Nueva contraseña", "");
    if(pass === null) return;
    if(String(pass).trim().length < 4) { alert("Contraseña muy corta"); return; }
    await NVAuth.api(`/api/admin/users/${encodeURIComponent(id)}`, {
      method:"PATCH",
      body:{ newPassword:String(pass) }
    });
  }

  async function boot(){
    // UI: cargar base actual
    try{ ui.inApiBase.value = NVAuth.getApiBase() || ""; }catch(_){ }

    if(ui.btnSaveApi){
      ui.btnSaveApi.addEventListener("click", ()=>{
        NVAuth.setApiBase(ui.inApiBase.value || "");
        setMsg(ui.loginMsg, "API guardada ✔", true);
      });
    }

    // Si ya hay sesión, intentar entrar
    if(NVAuth.isLogged()){
      try{
        const me = await loadMe();
        if(me.role !== "admin") throw new Error("Tu cuenta no es admin");
        ui.loginCard.style.display = "none";
        ui.adminArea.style.display = "block";
        ui.whoami.textContent = `${me.name || me.username || "admin"} (${me.role})`;
        await listUsers();
      }catch(err){
        // Forzar re-login
        NVAuth.clearSession();
      }
    }

    if(ui.btnLogin){
      ui.btnLogin.addEventListener("click", async ()=>{
        setMsg(ui.loginMsg, "Ingresando...", true);
        try{
          NVAuth.setApiBase(ui.inApiBase.value || NVAuth.getApiBase());
          const u = (ui.inUser.value || "").trim();
          const p = (ui.inPass.value || "").trim();
          if(!u || !p) throw new Error("Escribe usuario y contraseña");
          await NVAuth.login(u, p);
          const me = await loadMe();
          if(me.role !== "admin") throw new Error("Tu cuenta no es admin");
          await NVAuth.registerZeroXp();
          ui.loginCard.style.display = "none";
          ui.adminArea.style.display = "block";
          ui.whoami.textContent = `${me.name || me.username || "admin"} (${me.role})`;
          await listUsers();
          setMsg(ui.loginMsg, "", true);
        }catch(err){
          setMsg(ui.loginMsg, String(err && err.message ? err.message : err), false);
        }
      });
    }

    if(ui.btnCreate){
      ui.btnCreate.addEventListener("click", async ()=>{
        setMsg(ui.createMsg, "Creando...", true);
        try{
          const body = {
            username: (ui.cUsername.value||"").trim(),
            name: (ui.cName.value||"").trim(),
            email: (ui.cEmail.value||"").trim(),
            password: (ui.cPass.value||"").trim(),
            role: (ui.cRole.value||"student")
          };
          if(!body.username) throw new Error("Falta username");
          if(!body.password || body.password.length < 4) throw new Error("Contraseña muy corta");
          await NVAuth.api("/api/admin/users", { method:"POST", body });
          ui.cPass.value = "";
          setMsg(ui.createMsg, "Usuario creado ✔", true);
          await listUsers();
        }catch(err){
          setMsg(ui.createMsg, String(err && err.message ? err.message : err), false);
        }
      });
    }

    if(ui.btnRefresh){
      ui.btnRefresh.addEventListener("click", async ()=>{
        try{ await listUsers(); }catch(err){ setMsg(ui.usersMsg, String(err.message||err), false); }
      });
    }

    // delegate actions
    document.addEventListener("click", async (e)=>{
      const btn = e.target && e.target.closest ? e.target.closest("button[data-act]") : null;
      if(!btn) return;
      const act = btn.getAttribute("data-act");
      const id = btn.getAttribute("data-id");
      if(!act || !id) return;
      try{
        if(act === "toggle"){ await toggleUser(id); await listUsers(); }
        if(act === "role"){ await changeRole(id); await listUsers(); }
        if(act === "reset"){ await resetPassword(id); alert("Contraseña actualizada ✔"); }
      }catch(err){
        alert(String(err && err.message ? err.message : err));
      }
    });
  }

  window.addEventListener("load", boot);
})();
