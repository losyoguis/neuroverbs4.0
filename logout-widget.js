/* NeuroVerbs — Logout Widget (Google Workspace session inside app)
   - Injects an orange "Cerrar sesión" button (top-right) on every page where a session is detected.
   - Best-effort Google Identity Services logout: disableAutoSelect + revoke(email).
   - Clears app session keys and redirects to index.html.
*/
(() => {
  "use strict";

  const BTN_ID = "logoutBtnGlobal";

  // ---------- utils ----------
  function safeJsonParse(s){
    try{ return JSON.parse(s); }catch(_){ return null; }
  }
  function decodeJwt(token){
    try{
      if(!token || typeof token !== "string") return null;
      const parts = token.split(".");
      if(parts.length < 2) return null;
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const pad = "=".repeat((4 - (b64.length % 4)) % 4);
      const json = decodeURIComponent(escape(atob(b64 + pad)));
      return safeJsonParse(json);
    }catch(_){ return null; }
  }
  function getSessionToken(){
    try{
      return localStorage.getItem("google_id_token") || sessionStorage.getItem("google_id_token") || "";
    }catch(_){ return ""; }
  }
  function getProfile(){
    // Try stored profile first
    try{
      const raw = localStorage.getItem("user_profile") || sessionStorage.getItem("user_profile");
      const p = safeJsonParse(raw || "");
      if(p && (p.email || p.name || p.picture || p.sub)) return p;
    }catch(_){}

    // JWT payload fallback
    const payload = decodeJwt(getSessionToken());
    if(payload){
      const p = {
        sub: payload.sub || "",
        name: payload.name || payload.given_name || "",
        email: payload.email || "",
        picture: payload.picture || ""
      };
      try{ localStorage.setItem("user_profile", JSON.stringify(p)); }catch(_){}
      return p;
    }
    return { sub:"", name:"", email:"", picture:"" };
  }
  function isLogged(){
    const token = getSessionToken();
    if(token) return true;
    const p = getProfile();
    return !!(p && (p.email || p.sub));
  }

  // ---------- session clear ----------
  function clearAppSession(){
    const keys = [
      "user_profile",
      "google_id_token",
      "rank_user",
      "mjb_user",
      "google_user",
      "neuroverbs_user",
      "auth_user"
    ];
    for(const k of keys){
      try{ localStorage.removeItem(k); }catch(_){}
      try{ sessionStorage.removeItem(k); }catch(_){}
    }
  }

  // ---------- logout ----------
  function logout(){
    const p = getProfile();
    try{
      if(window.google && google.accounts && google.accounts.id){
        try{ google.accounts.id.disableAutoSelect(); }catch(_){}
        if(typeof google.accounts.id.revoke === "function" && p.email){
          try{ google.accounts.id.revoke(p.email, ()=>{}); }catch(_){}
        }
      }
    }catch(_){}

    clearAppSession();

    // Return to entry page
    try{
      const path = (location.pathname || "").toLowerCase();
      if(path.endsWith("/index.html") || path.endsWith("index.html")){
        location.reload();
      }else{
        location.href = "index.html";
      }
    }catch(_){
      try{ location.reload(); }catch(__){}
    }
  }

  // ---------- UI ----------
  function ensureButton(){
    let btn = document.getElementById(BTN_ID);
    if(btn) return btn;

    btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "Cerrar sesión";

    Object.assign(btn.style, {
      position: "fixed",
      top: "14px",
      right: "14px",
      zIndex: "200000",
      padding: "10px 14px",
      borderRadius: "999px",
      border: "1px solid rgba(255,170,60,.55)",
      background: "linear-gradient(135deg,#ffb84a,#ff7a00)",
      color: "#1b1430",
      fontWeight: "900",
      cursor: "pointer",
      boxShadow: "0 10px 24px rgba(0,0,0,.30)",
      userSelect: "none",
      letterSpacing: ".2px",
      minWidth: "140px",
      display: "none"
    });

    btn.addEventListener("click", (e) => {
      try{ e.preventDefault(); }catch(_){}
      logout();
    });

    document.body.appendChild(btn);
    return btn;
  }

  function mount(){
    const btn = ensureButton();
    btn.style.display = isLogged() ? "block" : "none";
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", mount, { once:true });
  }else{
    mount();
  }

  window.addEventListener("pageshow", mount);
  window.addEventListener("storage", mount);
  setInterval(mount, 1500);

  // expose
  try{ window.NVLogout = logout; }catch(_){}
})();
