// NEUROVERBS - Configuración única (Frontend)
// -------------------------------------------------
// ✅ Cambia SOLO aquí:
//   - webAppUrl: URL /exec de tu Apps Script (Google Sheets backend)
//   - oauthClientId: Client ID de Google Identity Services
//   - allowedDomain: dominio permitido (vacío "" = permitir cualquier dominio)
// -------------------------------------------------
(function(){
  const cfg = {
    webAppUrl: "https://script.google.com/macros/s/AKfycbwFYYMybfaF7ac9yxP7shnIZZaiKxgnO6BvHNaXfcOk-oQ2jSUUGnrBWyinXuhko20/exec",
    oauthClientId: "637468265896-5olh8rhf76setm52743tashi3vq1la67.apps.googleusercontent.com",
    allowedDomain: ""
  };

  // Overrides opcionales por URL: ?webapp=...&clientid=...&domain=...
  try{
    const p = new URLSearchParams(location.search);
    const oWeb = p.get("webapp");
    const oCid = p.get("clientid");
    const oDom = p.get("domain");
    if (oWeb) cfg.webAppUrl = oWeb;
    if (oCid) cfg.oauthClientId = oCid;
    if (oDom !== null) cfg.allowedDomain = oDom; // permite dominio vacío
  }catch(_){}

  // Persistir para que core.js y otras páginas lo lean sin query
  try{
    if (cfg.webAppUrl) localStorage.setItem("WEB_APP_URL_V5", cfg.webAppUrl);
    if (cfg.oauthClientId) localStorage.setItem("OAUTH_CLIENT_ID_NV", cfg.oauthClientId);
    if (cfg.allowedDomain !== undefined) localStorage.setItem("ALLOWED_DOMAIN_NV", cfg.allowedDomain);
  }catch(_){}

  window.NEUROVERBS_CONFIG = cfg;
})();
