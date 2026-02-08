/*
  NeuroVerbs — Autenticación local (API propia)
  -------------------------------------------------
  - Login con usuario/contraseña (sin depender de Workspace)
  - Token en localStorage
  - Helpers globales: window.NVAuth

  Backend recomendado: Cloudflare Worker (con CORS) + D1.

  Config:
    - window.NEUROVERBS_CONFIG.authApiBase
    - o localStorage.AUTH_API_BASE_NV

  Storage:
    - nv_local_token
    - nv_local_user
*/
(() => {
  "use strict";

  function cfg() {
    return (window.NEUROVERBS_CONFIG || {});
  }

  function getApiBase() {
    try {
      const fromCfg = cfg().authApiBase;
      const fromLS = localStorage.getItem("AUTH_API_BASE_NV");
      const base = (fromCfg !== undefined && fromCfg !== null && String(fromCfg).trim() !== "")
        ? String(fromCfg).trim()
        : (fromLS ? String(fromLS).trim() : "");
      return base.replace(/\/+$/, "");
    } catch (_) {
      return "";
    }
  }

  function setApiBase(base) {
    try {
      const b = String(base || "").trim().replace(/\/+$/, "");
      localStorage.setItem("AUTH_API_BASE_NV", b);
      if (window.NEUROVERBS_CONFIG) window.NEUROVERBS_CONFIG.authApiBase = b;
      return b;
    } catch (_) {
      return "";
    }
  }

  function getToken() {
    try { return localStorage.getItem("nv_local_token") || ""; } catch(_) { return ""; }
  }
  function getUser() {
    try {
      const raw = localStorage.getItem("nv_local_user") || "";
      return raw ? JSON.parse(raw) : null;
    } catch(_) {
      return null;
    }
  }

  function setSession(token, user) {
    try {
      if (token) localStorage.setItem("nv_local_token", token);
      if (user) localStorage.setItem("nv_local_user", JSON.stringify(user));
    } catch (_) {}

    // Para que core.js y el ranking usen la misma UI: guardamos user_profile
    try {
      if (user) {
        const sub = user.sub || (user.id ? ("local:" + user.id) : "");
        localStorage.setItem("user_profile", JSON.stringify({
          sub,
          name: user.name || user.username || "Usuario",
          email: user.email || "",
          picture: user.picture || ""
        }));
      }
    } catch (_) {}
  }

  function clearSession() {
    try { localStorage.removeItem("nv_local_token"); } catch(_) {}
    try { localStorage.removeItem("nv_local_user"); } catch(_) {}
  }

  function isLogged() {
    const t = getToken();
    const u = getUser();
    return !!(t && u);
  }

  async function api(path, { method="GET", body=null, token=null } = {}) {
    const base = getApiBase();
    if (!base) throw new Error("AUTH_API_BASE no configurado");
    const url = base + path;

    const headers = { "Content-Type": "application/json" };
    // token: si se pasa explícitamente "" (string vacía) NO se envía Authorization.
    // Esto es útil para endpoints públicos como /api/bootstrap/admin.
    const t = (token === undefined || token === null) ? getToken() : String(token);
    if (t) headers["Authorization"] = "Bearer " + t;

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    let data = null;
    try { data = await res.json(); } catch(_) {}
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) ? (data.error || data.message) : ("HTTP " + res.status);
      throw new Error(msg);
    }
    return data;
  }

  async function login(usernameOrEmail, password) {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: { usernameOrEmail, password },
      token: ""
    });
    if (!data || !data.token || !data.user) throw new Error("Respuesta inválida de login");
    setSession(data.token, data.user);
    return data.user;
  }

  async function me() {
    return api("/api/auth/me");
  }

  async function logout() {
    clearSession();
    return { ok: true };
  }

  // Best-effort: registra usuario en Sheets vía backend (/api/xp con delta=0)
  async function registerZeroXp() {
    try {
      await api("/api/xp", { method: "POST", body: { xpDelta: 0 } });
    } catch (_) {}
  }

  window.NVAuth = {
    getApiBase,
    setApiBase,
    getToken,
    getUser,
    setSession,
    clearSession,
    isLogged,
    api,
    login,
    me,
    logout,
    registerZeroXp
  };
})();
