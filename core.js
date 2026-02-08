
// =========================
// Google Auth (GSI) + Sheets (Apps Script WebApp)
// =========================
const NV_CFG = (window.NEUROVERBS_CONFIG || {});
const DEFAULT_WEB_APP_URL = (NV_CFG.webAppUrl || "https://script.google.com/macros/s/AKfycbwh3qTioH-xVnVL43V5_Y7_lc-Ng6BYCvNsj3E6IPDpanwUGa6cgqYpbR6yt724E5UF/exec");
// Tip: si vuelves a implementar el Web App, puedes pasar la nueva URL así:
//   tuapp.html?webapp=PASTE_AQUI_LA_URL
// y queda guardada en localStorage automáticamente.
const WEB_APP_URL = (
  new URLSearchParams(location.search).get("webapp")
  || NV_CFG.webAppUrl
  || localStorage.getItem("WEB_APP_URL_V5")
  || DEFAULT_WEB_APP_URL
);
console.log("[Neuroverbs] WEB_APP_URL =", WEB_APP_URL);
try{ localStorage.setItem("WEB_APP_URL_V5", WEB_APP_URL); }catch(_){ }
const ALLOWED_DOMAIN = (NV_CFG.allowedDomain !== undefined ? NV_CFG.allowedDomain : (localStorage.getItem("ALLOWED_DOMAIN_NV") || "iemanueljbetancur.edu.co"));
const ALLOWED_EMAIL_SUFFIX = (ALLOWED_DOMAIN ? "@"+ALLOWED_DOMAIN : "");
const OAUTH_CLIENT_ID = (NV_CFG.oauthClientId || localStorage.getItem("OAUTH_CLIENT_ID_NV") || "637468265896-5olh8rhf76setm52743tashi3vq1la67.apps.googleusercontent.com");

// Leaderboard paging
const LB_PAGE_SIZE = 5;
let __lbOffset = 0;
let __lbTotal = 0; // total participantes (desde servidor)

// XP sync guard
window.__lastXpSynced = null;          // usado por awardXP()
window.__suppressXpSyncUntil = 0;      // ms timestamp

function parseJwt(token) {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(atob(base64).split('').map(c =>
    '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
  ).join(''));
  return JSON.parse(jsonPayload);
}

function showUserChip(profile) {
  const chip = document.getElementById("userChip");
  const pic = document.getElementById("userPic");
  const name = document.getElementById("userName");
  const email = document.getElementById("userEmail");
  if (!chip) return;

  chip.style.display = "flex";
  if (pic) {
    pic.src = profile.picture || "";
    pic.style.display = profile.picture ? "block" : "none";
  }
  if (name) name.textContent = profile.name || "Usuario";
  if (email) email.textContent = profile.email || "";
}

function hideUserChip() {
  const chip = document.getElementById("userChip");
  if (chip) chip.style.display = "none";
}

function clearSession() {
  localStorage.removeItem("google_id_token");
  localStorage.removeItem("user_profile");
  hideUserChip();
  const sec = document.getElementById("leaderboardSection");
  if (sec) sec.style.display = "none";
}

function jsonpRequest(url) {
  return new Promise((resolve, reject) => {
    const cb = "__cb_" + Math.random().toString(36).slice(2) + "_" + Date.now();
    const timeout = setTimeout(() => {
      try { delete window[cb]; } catch(_){}
      reject(new Error("JSONP timeout"));
    }, 12000);

    window[cb] = (data) => {
      clearTimeout(timeout);
      try { delete window[cb]; } catch(_){}
      try { script.remove(); } catch(_){}
      resolve(data);
    };

    const script = document.createElement("script");
    script.src = url + (url.includes("?") ? "&" : "?") + "callback=" + encodeURIComponent(cb) + "&_=" + Date.now();
    script.onerror = () => {
      clearTimeout(timeout);
      try { delete window[cb]; } catch(_){}
      reject(new Error("JSONP load error"));
    };
    document.body.appendChild(script);
  });
}

// POST cross-domain sin CORS (Apps Script no expone CORS headers).
// En Apps Script, doPost debe parsear JSON desde text/plain.
function postToSheets(payload) {
  // ✅ Preferimos JSONP (GET) para evitar CORS y poder ver respuesta/errores.
  // El backend (Apps Script) acepta action=upsert/xp también por GET cuando ALLOW_GET_UPSERT=true.
  try {
    const params = new URLSearchParams();
    params.set("action", payload.action || "upsert");
    if (payload.idToken) params.set("idToken", payload.idToken);
    if (payload.xpDelta !== undefined) params.set("xpDelta", String(payload.xpDelta));
    params.set("_", String(Date.now()));

    const url = WEB_APP_URL + (WEB_APP_URL.includes("?") ? "&" : "?") + params.toString();

    jsonpRequest(url, 8000).then((res) => {
      if (!res || res.ok !== true) {
        console.warn("[Sheets] Respuesta no-ok:", res);
      } else {
        // opcional: podrías usar res.user.xp si quieres sincronizar XP
        // console.log("[Sheets] OK:", res);
      }
    }).catch((err) => {
      console.warn("[Sheets] JSONP falló, fallback POST no-cors:", err);
      // Fallback POST silencioso
      const body = JSON.stringify(payload);
      try {
        fetch(WEB_APP_URL, {
          method: "POST",
          mode: "no-cors",
          keepalive: true,
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body
        }).catch(()=>{});
      } catch(e) {}

      // Fallback beacon
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(WEB_APP_URL, new Blob([body], { type: "text/plain;charset=utf-8" }));
        }
      } catch(e) {}
    });
  } catch (e) {
    console.warn("[Sheets] postToSheets error:", e);
  }
}

function registrarEnSheets(idToken) {
  // upsert sin sumar XP
  postToSheets({ action: "upsert", idToken, xpDelta: 0 });

  // Diagnóstico (solo consola): confirma que el /exec apunta al Sheet correcto
  try {
    setTimeout(() => {
      debugSheetsEndpoint();
    }, 800);
  } catch(e) {}
}

function debugSheetsEndpoint() {
  try {
    const cb = "cb_debug_" + Math.random().toString(36).slice(2);
    window[cb] = (res) => {
      console.log("[Sheets][debug]", res);
      try { delete window[cb]; } catch(e) { window[cb] = undefined; }
    };
    const src = WEB_APP_URL + "?action=debug&callback=" + encodeURIComponent(cb) + "&t=" + Date.now();
    const s = document.createElement("script");
    s.src = src;
    s.onerror = () => console.warn("[Sheets][debug] no cargó el endpoint");
    document.body.appendChild(s);
  } catch (e) {
    console.warn("[Sheets][debug] error", e);
  }
}

function queueXpDelta(idToken, xpDelta) {
  if (!idToken) return;
  const delta = Number(xpDelta || 0);
  if (!Number.isFinite(delta) || delta <= 0) return;

  // Evitar sumar XP por sincronizaciones internas / refresh
  if (Date.now() < window.__suppressXpSyncUntil) return;

  // ✅ Siempre usamos el mismo endpoint/acción que soporta el backend (doPost -> action=upsert)
  postToSheets({ action: "upsert", idToken, xpDelta: delta });
}

// Trae el XP del usuario desde Sheets y lo aplica (Sheets manda)
async function fetchAndApplyUserFromSheets() {
  const profRaw = localStorage.getItem("user_profile");
  if (!profRaw) return;
  let prof;
  try { prof = JSON.parse(profRaw); } catch(_) { return; }
  if (!prof || !prof.sub) return;

  try {
    const url = WEB_APP_URL + "?action=user&sub=" + encodeURIComponent(prof.sub);
    const data = await jsonpRequest(url);
    if (!data || !data.ok || !data.user) return;

    const serverXp = Number(data.user.xp || 0);
    if (!Number.isFinite(serverXp)) return;
    applyServerXpSafely(serverXp, "user_endpoint");
    } catch (e) {
    console.warn("No pude leer XP desde Sheets:", e);
  }
}

// Aplica XP del servidor al HUD sin generar "deltas" extra.
// Solo sube el XP si el servidor va por delante (nunca lo baja aquí para evitar parpadeos por retardos).
function applyServerXpSafely(serverXp, source) {
  const sXp = Number(serverXp || 0);
  if (!Number.isFinite(sXp)) return;

  const localXp = Number(typeof xp !== "undefined" ? (xp || 0) : 0);
  if (sXp <= localXp) return;

  // Evitar que cualquier lógica de delta intente reenviar este cambio
  window.__suppressXpSyncUntil = Date.now() + 2500;
  window.__lastXpSynced = sXp;

  if (typeof xp !== "undefined") xp = sXp;

  try { persistState(); } catch (_) {}
  try { actualizarStats(); } catch (_) {}
  if (source) console.log("[XP] HUD actualizado desde servidor:", sXp, "source=", source);
}

// =========================
// Leaderboard paginado (5 por página)
// =========================
function resetLeaderboardPaging() {
  __lbOffset = 0;
}

function lbPrev() {
  // No permitir ir a páginas negativas
  if (__lbOffset <= 0) return;
  __lbOffset = Math.max(0, __lbOffset - LB_PAGE_SIZE);
  cargarLeaderboardPage();
}

function lbNext() {
  // No permitir ir más allá del total
  const total = Number(__lbTotal || 0);
  if (total && (__lbOffset + LB_PAGE_SIZE) >= total) return;
  __lbOffset = __lbOffset + LB_PAGE_SIZE;
  cargarLeaderboardPage();
}

function cargarLeaderboard() {
  // wrapper para compatibilidad con llamadas existentes
  cargarLeaderboardPage();
}

function cargarLeaderboardPage() {
  const sec = document.getElementById("leaderboardSection");
  const st = document.getElementById("lbStatus");
  const list = document.getElementById("leaderboardList");
  const pageInfo = document.getElementById("lbPageInfo");

  if (sec) sec.style.display = "block";
  if (st) st.textContent = "Cargando ranking...";
  if (list) list.innerHTML = "";
  if (pageInfo) pageInfo.textContent = String(Math.floor(__lbOffset / LB_PAGE_SIZE) + 1);

  const url = WEB_APP_URL + "?action=leaderboard&limit=" + encodeURIComponent(LB_PAGE_SIZE) + "&offset=" + encodeURIComponent(__lbOffset);
  jsonpRequest(url).then((data) => {
    renderLeaderboard(data);
  }).catch((err) => {
    if (st) st.textContent = "No se pudo cargar el ranking. Revisa la URL / permisos del WebApp.";
    console.error(err);
  });
}

function renderLeaderboard(data) {
  const sec = document.getElementById("leaderboardSection");
  const list = document.getElementById("leaderboardList");
  const st = document.getElementById("lbStatus");
  const pageInfo = document.getElementById("lbPageInfo");
  if (!sec || !list || !st) return;

  if (!data || !data.ok) {
    sec.style.display = "block";
    st.textContent = "No se pudo cargar el ranking.";
    list.innerHTML = "";
    return;
  }

  const rows = Array.isArray(data.leaderboard) ? data.leaderboard : (Array.isArray(data.rows) ? data.rows : []);
  const total = Number(data.total || 0);
  __lbTotal = total;

  // Si el offset quedó por fuera del total (ej. le dieron "Siguiente" cuando no había más páginas), corrige y recarga
  const maxOffset = total ? Math.max(0, (Math.ceil(total / LB_PAGE_SIZE) - 1) * LB_PAGE_SIZE) : 0;
  if (total && __lbOffset > maxOffset) {
    __lbOffset = maxOffset;
    cargarLeaderboardPage();
    return;
  }

  const start = rows.length ? Math.min(__lbOffset + 1, total || (__lbOffset + 1)) : 0;
  const end = rows.length ? Math.min(__lbOffset + rows.length, total || (__lbOffset + rows.length)) : 0;

  sec.style.display = "block";
  if (rows.length) {
    st.textContent = (total ? ("Participantes: " + total + " — mostrando " + start + "-" + end) : ("Mostrando " + start + "-" + end));
  } else {
    st.textContent = "Aún no hay participantes con XP. Inicia sesión y gana XP para aparecer.";
  }

  if (pageInfo) pageInfo.textContent = String(Math.floor(__lbOffset / LB_PAGE_SIZE) + 1);

  // Habilitar / deshabilitar flechas
  const prevBtn = document.getElementById("lbPrevBtn");
  const nextBtn = document.getElementById("lbNextBtn");
  if (prevBtn) prevBtn.disabled = (__lbOffset <= 0);
  if (nextBtn) nextBtn.disabled = (total ? (__lbOffset + LB_PAGE_SIZE >= total) : true);

  // Render cards
  list.innerHTML = rows.map((r, i) => {
    const rank = __lbOffset + i + 1;
    const pic = r.picture ? `<img class="lbAvatar" src="${r.picture}" alt="foto">` : `<div class="lbAvatar lbAvatarFallback">👤</div>`;
    const name = (r.name || r.email || "Usuario").toString();
    const xpVal = Number(r.xp || 0);
    const isTop3 = rank <= 3;
    return `
      <div class="lbRow${isTop3 ? " lbTop3" : ""}">
        <div class="lbRank">#${rank}</div>
        ${pic}
        <div class="lbInfo">
          <div class="lbName">${escapeHtml(name)}</div>
          <div class="lbXp">${xpVal} XP</div>
        </div>
      </div>
    `;
  }).join("");

  // Si el usuario actual está en esta página del ranking, sincroniza el HUD con su XP del servidor
  try {
    const prof = JSON.parse(localStorage.getItem("user_profile") || "null");
    if (prof && prof.sub && Array.isArray(rows)) {
      const me = rows.find(r => String(r.sub) === String(prof.sub));
      if (me) applyServerXpSafely(me.xp, "leaderboard_page");
    }
  } catch (_) {}
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
}

// =========================
// Google Auth init + restore session
// =========================
function onGoogleCredential(response) {
  const idToken = response.credential;
  const user = parseJwt(idToken);

  
  // 🔒 Solo cuentas del dominio institucional
  const email = String((user && user.email) || "").toLowerCase();
  if(ALLOWED_DOMAIN && !email.endsWith(ALLOWED_EMAIL_SUFFIX.toLowerCase())) {
    try{ toastAchievement("⚠️","Cuenta no permitida","Solo se permite iniciar sesión con cuentas @"+ALLOWED_DOMAIN); }catch(e){ alert("Solo se permite iniciar sesión con cuentas @"+ALLOWED_DOMAIN); }
    try{ if(window.google && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect && google.accounts.id.disableAutoSelect();
      google.accounts.id.revoke && google.accounts.id.revoke(email, ()=>{});
    } }catch(e){}
    clearSession();
    return;
  }
localStorage.setItem("google_id_token", idToken);
  localStorage.setItem("user_profile", JSON.stringify({
    sub: user.sub,
    name: user.name,
    email: user.email,
    picture: user.picture
  }));

  showUserChip({
    sub: user.sub,
    name: user.name,
    email: user.email,
    picture: user.picture
  });

  // Registrar / actualizar usuario en Sheets (sin sumar XP)
  registrarEnSheets(idToken);

  // Mostrar ranking y sincronizar XP desde Sheets
  const sec = document.getElementById("leaderboardSection");
  if (sec) sec.style.display = "block";
  resetLeaderboardPaging();
  cargarLeaderboardPage();
  fetchAndApplyUserFromSheets();
}

function initGoogleAuthAndSync() {
  const btn = document.getElementById("googleBtn");
  if (!btn) return;

  // Si ya hay sesión guardada, pinta UI + carga data
  const token = localStorage.getItem("google_id_token");
  const profRaw = localStorage.getItem("user_profile");
  if (token && profRaw) {
    try {
      const prof = JSON.parse(profRaw);
      showUserChip(prof);
      const sec = document.getElementById("leaderboardSection");
      if (sec) sec.style.display = "block";
      resetLeaderboardPaging();
      cargarLeaderboardPage();
      fetchAndApplyUserFromSheets();
    } catch(_){}
  }

  // Render button una vez
  try {
    if (!btn.__rendered) {
      google.accounts.id.initialize({
        client_id: OAUTH_CLIENT_ID,
        hd: "iemanueljbetancur.edu.co",
        callback: onGoogleCredential,
        ux_mode: "popup",
        hosted_domain: ALLOWED_DOMAIN
      });
      google.accounts.id.renderButton(btn, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "signin_with"
      });
      btn.__rendered = true;
    }
  } catch (err) {
    console.error("Error init Google Auth:", err);
    btn.innerHTML = '<button class="lbBtn" type="button" onclick="location.reload()">Reintentar Login</button>';
  }
}

window.addEventListener("load", () => {
  // GSI script carga async; reintenta init unos ms después
  let tries = 0;
  const t = setInterval(() => {
    tries++;
    if (window.google && google.accounts && google.accounts.id) {
      clearInterval(t);
      initGoogleAuthAndSync();
    }
    if (tries > 40) clearInterval(t);
  }, 150);
});


/* ===========================
   ✅ HINTS (se mantienen)
   =========================== */
const GROUP_HINTS = {
  1: {
    title: "Round 1 - Group 1",
    days: "Day 1 to 8",
    bullets: [
      "El patrón que se repite es que el verbo es de <em>una sílaba</em> y termina en <em>t</em> o <em>d</em>.",
      "Familia verbal: el infinitivo, el pasado y el participio <em>son los mismos</em> (C1=C2=C3)."
    ]
  },
  2: {
    title: "Round 1 - Group 2",
    days: "Day 9 to 25",
    bullets: [
      "Familia verbal: el pasado y el participio <em>son los mismos</em> (C2=C3)."
    ]
  },
  3: {
    title: "Round 1 - Group 3",
    days: "Day 26 to 40",
    bullets: [
      "Familia verbal: el infinitivo, el pasado y el participio <em>son diferentes</em> (C1≠C2≠C3)."
    ]
  }
};

/* ===========================
   🔗 SYNC: cargar verbos desde verbs.html
   (para traducción ES perfecta y consistencia)
   =========================== */
let __NY_VERBS_DB__ = null;
let __NY_VERBS_DB_READY__ = false;

async function loadVerbsDbFromVerbsHtml(){
  // Preferimos cargar desde JSON (más ligero y cacheable).
  // Si falla, hacemos fallback al método antiguo (extraer VERBS_DB desde verbs.html).
  try{
    // 1) JSON
    try{
      const r = await fetch("assets/verbs_db.json", { cache: "no-store" });
      if(r.ok){
        const db = await r.json();
        __NY_VERBS_DB__ = db;
        __NY_VERBS_DB_READY__ = Array.isArray(__NY_VERBS_DB__) && __NY_VERBS_DB__.length > 0;
        if(__NY_VERBS_DB_READY__) __nyNormalizeVerbsDb(__NY_VERBS_DB__);
        return { ok: __NY_VERBS_DB_READY__, count: (__NY_VERBS_DB__||[]).length, source:"json" };
      }
    }catch(_jsonErr){
      // seguimos al fallback
    }

    // 2) Fallback: verbs.html -> const VERBS_DB = [...]
    const res = await fetch("verbs.html", { cache: "no-store" });
    if(!res.ok) return { ok:false, count:0 };

    const txt = await res.text();
    const m = txt.match(/const\s+VERBS_DB\s*=\s*(\[[\s\S]*?\n\s*\]);/);
    if(!m) return { ok:false, count:0 };

    __NY_VERBS_DB__ = (new Function("return " + m[1]))();
    __NY_VERBS_DB_READY__ = Array.isArray(__NY_VERBS_DB__) && __NY_VERBS_DB__.length > 0;

    if(__NY_VERBS_DB_READY__){
      __nyNormalizeVerbsDb(__NY_VERBS_DB__);
    }

    return { ok: __NY_VERBS_DB_READY__, count: (__NY_VERBS_DB__||[]).length, source:"verbs.html" };
  }catch(e){
    __NY_VERBS_DB_READY__ = false;
    return { ok:false, count:0, error: String(e?.message || e) };
  }
}



async function loadVerbsDbFromVerbs2Html() {
  try {
    const res = await fetch('verbs2.html', { cache: 'no-store' });
    if (!res.ok) throw new Error('verbs2.html not found');
    const text = await res.text();

    // Extraer `const VERBS2_DB = [...]`
    const m = text.match(/const\s+VERBS2_DB\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (!m) throw new Error('VERBS2_DB not found in verbs2.html');

    // Evaluar de forma aislada
    const tmp = Function('return ' + m[1])();
    if (!Array.isArray(tmp)) throw new Error('VERBS2_DB is not an array');

    __NY_VERBS2_DB__ = tmp;
    __NY_VERBS2_DB_READY__ = true;
    console.log('[verbs2] Loaded overrides:', __NY_VERBS2_DB__.length);
  } catch (err) {
    // verbs2.html es opcional: no bloquear la app si no existe.
    __NY_VERBS2_DB__ = [];
    __NY_VERBS2_DB_READY__ = false;
    // console.debug('[verbs2] Not loaded:', err?.message || err);
  }
}

// === verbs3.html (Grupo 3) ===
let __NY_VERBS3_DB__ = [];

// Fallback embebido para entornos donde fetch('verbs3.html') falla (ej. file://)
const __NY_VERBS3_FALLBACK__ = [
  {
    "key": "get",
    "c1": "GET",
    "c2": "GOT",
    "c3": "GOTTEN",
    "es": "Obtener / Conseguir / Recibir / Llegar / Convertirse / Atrapar / Entender",
    "active": {
      "P": {
        "A": [
          [
            "I",
            "I get",
            "Yo consigo / obtengo"
          ],
          [
            "YOU_S",
            "You get",
            "Tú consigues"
          ],
          [
            "HE",
            "He gets",
            "Él consigue"
          ],
          [
            "SHE",
            "She gets",
            "Ella consigue"
          ],
          [
            "IT",
            "It gets",
            "Eso consigue"
          ],
          [
            "WE",
            "We get",
            "Nosotros conseguimos"
          ],
          [
            "YOU_P",
            "You get",
            "Ustedes consiguen"
          ],
          [
            "THEY",
            "They get",
            "Ellos consiguen"
          ]
        ],
        "N": [
          [
            "I",
            "I don’t get",
            "Yo no consigo / no obtengo"
          ],
          [
            "YOU_S",
            "You don’t get",
            "Tú no consigues"
          ],
          [
            "HE",
            "He doesn’t get",
            "Él no consigue"
          ],
          [
            "SHE",
            "She doesn’t get",
            "Ella no consigue"
          ],
          [
            "IT",
            "It doesn’t get",
            "Eso no consigue"
          ],
          [
            "WE",
            "We don’t get",
            "Nosotros no conseguimos"
          ],
          [
            "YOU_P",
            "You don’t get",
            "Ustedes no consiguen"
          ],
          [
            "THEY",
            "They don’t get",
            "Ellos no consiguen"
          ]
        ],
        "Q": [
          [
            "Do I get?",
            "¿Consigo yo?"
          ],
          [
            "Do you get?",
            "¿Consigues tú?"
          ],
          [
            "Does he get?",
            "¿Consigue él?"
          ],
          [
            "Does she get?",
            "¿Consigue ella?"
          ],
          [
            "Does it get?",
            "¿Consigue eso?"
          ],
          [
            "Do we get?",
            "¿Conseguimos nosotros?"
          ],
          [
            "Do you get?",
            "¿Consiguen ustedes?"
          ],
          [
            "Do they get?",
            "¿Consiguen ellos?"
          ]
        ]
      },
      "S": {
        "A": [
          [
            "I",
            "I got",
            "Yo conseguí / obtuve"
          ],
          [
            "YOU_S",
            "You got",
            "Tú conseguiste"
          ],
          [
            "HE",
            "He got",
            "Él consiguió"
          ],
          [
            "SHE",
            "She got",
            "Ella consiguió"
          ],
          [
            "IT",
            "It got",
            "Eso consiguió"
          ],
          [
            "WE",
            "We got",
            "Nosotros conseguimos / obtuvimos"
          ],
          [
            "YOU_P",
            "You got",
            "Ustedes consiguieron"
          ],
          [
            "THEY",
            "They got",
            "Ellos consiguieron"
          ]
        ],
        "N": [
          [
            "I",
            "I didn’t get",
            "Yo no conseguí / no obtuve"
          ],
          [
            "YOU_S",
            "You didn’t get",
            "Tú no conseguiste"
          ],
          [
            "HE",
            "He didn’t get",
            "Él no consiguió"
          ],
          [
            "SHE",
            "She didn’t get",
            "Ella no consiguió"
          ],
          [
            "IT",
            "It didn’t get",
            "Eso no consiguió"
          ],
          [
            "WE",
            "We didn’t get",
            "Nosotros no conseguimos / no obtuvimos"
          ],
          [
            "YOU_P",
            "You didn’t get",
            "Ustedes no consiguieron"
          ],
          [
            "THEY",
            "They didn’t get",
            "Ellos no consiguieron"
          ]
        ],
        "Q": [
          [
            "Did I get?",
            "¿Conseguí yo?"
          ],
          [
            "Did you get?",
            "¿Conseguiste tú?"
          ],
          [
            "Did he get?",
            "¿Consiguió él?"
          ],
          [
            "Did she get?",
            "¿Consiguió ella?"
          ],
          [
            "Did it get?",
            "¿Consiguió eso?"
          ],
          [
            "Did we get?",
            "¿Conseguimos nosotros?"
          ],
          [
            "Did you get?",
            "¿Consiguieron ustedes?"
          ],
          [
            "Did they get?",
            "¿Consiguieron ellos?"
          ]
        ]
      },
      "PP": {
        "A": [
          [
            "I",
            "I have gotten / got",
            "Yo he conseguido / he obtenido"
          ],
          [
            "YOU_S",
            "You have gotten",
            "Tú has conseguido"
          ],
          [
            "HE",
            "He has gotten",
            "Él ha conseguido"
          ],
          [
            "SHE",
            "She has gotten",
            "Ella ha conseguido"
          ],
          [
            "IT",
            "It has gotten",
            "Eso ha conseguido"
          ],
          [
            "WE",
            "We have gotten",
            "Nosotros hemos conseguido"
          ],
          [
            "YOU_P",
            "You have gotten",
            "Ustedes han conseguido"
          ],
          [
            "THEY",
            "They have gotten",
            "Ellos han conseguido"
          ]
        ],
        "N": [
          [
            "I",
            "I haven’t gotten / got",
            "Yo no he conseguido"
          ],
          [
            "YOU_S",
            "You haven’t gotten",
            "Tú no has conseguido"
          ],
          [
            "HE",
            "He hasn’t gotten",
            "Él no ha conseguido"
          ],
          [
            "SHE",
            "She hasn’t gotten",
            "Ella no ha conseguido"
          ],
          [
            "IT",
            "It hasn’t gotten",
            "Eso no ha conseguido"
          ],
          [
            "WE",
            "We haven’t gotten",
            "Nosotros no hemos conseguido"
          ],
          [
            "YOU_P",
            "You haven’t gotten",
            "Ustedes no han conseguido"
          ],
          [
            "THEY",
            "They haven’t gotten",
            "Ellos no han conseguido"
          ]
        ],
        "Q": [
          [
            "Have I gotten / got?",
            "¿He conseguido yo?"
          ],
          [
            "Have you gotten?",
            "¿Has conseguido tú?"
          ],
          [
            "Has he gotten?",
            "¿Ha conseguido él?"
          ],
          [
            "Has she gotten?",
            "¿Ha conseguido ella?"
          ],
          [
            "Has it gotten?",
            "¿Ha conseguido eso?"
          ],
          [
            "Have we gotten?",
            "¿Hemos conseguido nosotros?"
          ],
          [
            "Have you gotten?",
            "¿Han conseguido ustedes?"
          ],
          [
            "Have they gotten?",
            "¿Han conseguido ellos?"
          ]
        ]
      }
    },
    "note": "“gotten” es más común en EE. UU.; en Reino Unido se usa más “got” como participio."
  },
  {
    "key": "foresee",
    "c1": "FORESEE",
    "c2": "FORESAW",
    "c3": "FORESEEN",
    "es": "Prever / Anticipar / Ver con anticipación",
    "active": {
      "P": {
        "A": [
          [
            "I",
            "I foresee",
            "Yo preveo"
          ],
          [
            "YOU_S",
            "You foresee",
            "Tú prevés"
          ],
          [
            "HE",
            "He foresees",
            "Él prevé"
          ],
          [
            "SHE",
            "She foresees",
            "Ella prevé"
          ],
          [
            "IT",
            "It foresees",
            "Eso prevé"
          ],
          [
            "WE",
            "We foresee",
            "Nosotros prevemos"
          ],
          [
            "YOU_P",
            "You foresee",
            "Ustedes prevén"
          ],
          [
            "THEY",
            "They foresee",
            "Ellos prevén"
          ]
        ],
        "N": [
          [
            "I",
            "I don’t foresee",
            "Yo no preveo"
          ],
          [
            "YOU_S",
            "You don’t foresee",
            "Tú no prevés"
          ],
          [
            "HE",
            "He doesn’t foresee",
            "Él no prevé"
          ],
          [
            "SHE",
            "She doesn’t foresee",
            "Ella no prevé"
          ],
          [
            "IT",
            "It doesn’t foresee",
            "Eso no prevé"
          ],
          [
            "WE",
            "We don’t foresee",
            "Nosotros no prevemos"
          ],
          [
            "YOU_P",
            "You don’t foresee",
            "Ustedes no prevén"
          ],
          [
            "THEY",
            "They don’t foresee",
            "Ellos no prevén"
          ]
        ],
        "Q": [
          [
            "Do I foresee?",
            "¿Preveo yo?"
          ],
          [
            "Do you foresee?",
            "¿Prevés tú?"
          ],
          [
            "Does he foresee?",
            "¿Prevé él?"
          ],
          [
            "Does she foresee?",
            "¿Prevé ella?"
          ],
          [
            "Does it foresee?",
            "¿Prevé eso?"
          ],
          [
            "Do we foresee?",
            "¿Prevemos nosotros?"
          ],
          [
            "Do you foresee?",
            "¿Prevén ustedes?"
          ],
          [
            "Do they foresee?",
            "¿Prevén ellos?"
          ]
        ]
      },
      "S": {
        "A": [
          [
            "I",
            "I foresaw",
            "Yo preví"
          ],
          [
            "YOU_S",
            "You foresaw",
            "Tú previste"
          ],
          [
            "HE",
            "He foresaw",
            "Él previó"
          ],
          [
            "SHE",
            "She foresaw",
            "Ella previó"
          ],
          [
            "IT",
            "It foresaw",
            "Eso previó"
          ],
          [
            "WE",
            "We foresaw",
            "Nosotros previmos"
          ],
          [
            "YOU_P",
            "You foresaw",
            "Ustedes previeron"
          ],
          [
            "THEY",
            "They foresaw",
            "Ellos previeron"
          ]
        ],
        "N": [
          [
            "I",
            "I didn’t foresee",
            "Yo no preví"
          ],
          [
            "YOU_S",
            "You didn’t foresee",
            "Tú no previste"
          ],
          [
            "HE",
            "He didn’t foresee",
            "Él no previó"
          ],
          [
            "SHE",
            "She didn’t foresee",
            "Ella no previó"
          ],
          [
            "IT",
            "It didn’t foresee",
            "Eso no previó"
          ],
          [
            "WE",
            "We didn’t foresee",
            "Nosotros no previmos"
          ],
          [
            "YOU_P",
            "You didn’t foresee",
            "Ustedes no previeron"
          ],
          [
            "THEY",
            "They didn’t foresee",
            "Ellos no previeron"
          ]
        ],
        "Q": [
          [
            "Did I foresee?",
            "¿Preví yo?"
          ],
          [
            "Did you foresee?",
            "¿Previste tú?"
          ],
          [
            "Did he foresee?",
            "¿Previó él?"
          ],
          [
            "Did she foresee?",
            "¿Previó ella?"
          ],
          [
            "Did it foresee?",
            "¿Previó eso?"
          ],
          [
            "Did we foresee?",
            "¿Previmos nosotros?"
          ],
          [
            "Did you foresee?",
            "¿Previeron ustedes?"
          ],
          [
            "Did they foresee?",
            "¿Previeron ellos?"
          ]
        ]
      },
      "PP": {
        "A": [
          [
            "I",
            "I have foreseen",
            "Yo he previsto"
          ],
          [
            "YOU_S",
            "You have foreseen",
            "Tú has previsto"
          ],
          [
            "HE",
            "He has foreseen",
            "Él ha previsto"
          ],
          [
            "SHE",
            "She has foreseen",
            "Ella ha previsto"
          ],
          [
            "IT",
            "It has foreseen",
            "Eso ha previsto"
          ],
          [
            "WE",
            "We have foreseen",
            "Nosotros hemos previsto"
          ],
          [
            "YOU_P",
            "You have foreseen",
            "Ustedes han previsto"
          ],
          [
            "THEY",
            "They have foreseen",
            "Ellos han previsto"
          ]
        ],
        "N": [
          [
            "I",
            "I haven’t foreseen",
            "Yo no he previsto"
          ],
          [
            "YOU_S",
            "You haven’t foreseen",
            "Tú no has previsto"
          ],
          [
            "HE",
            "He hasn’t foreseen",
            "Él no ha previsto"
          ],
          [
            "SHE",
            "She hasn’t foreseen",
            "Ella no ha previsto"
          ],
          [
            "IT",
            "It hasn’t foreseen",
            "Eso no ha previsto"
          ],
          [
            "WE",
            "We haven’t foreseen",
            "Nosotros no hemos previsto"
          ],
          [
            "YOU_P",
            "You haven’t foreseen",
            "Ustedes no han previsto"
          ],
          [
            "THEY",
            "They haven’t foreseen",
            "Ellos no han previsto"
          ]
        ],
        "Q": [
          [
            "Have I foreseen?",
            "¿He previsto yo?"
          ],
          [
            "Have you foreseen?",
            "¿Has previsto tú?"
          ],
          [
            "Has he foreseen?",
            "¿Ha previsto él?"
          ],
          [
            "Has she foreseen?",
            "¿Ha previsto ella?"
          ],
          [
            "Has it foreseen?",
            "¿Ha previsto eso?"
          ],
          [
            "Have we foreseen?",
            "¿Hemos previsto nosotros?"
          ],
          [
            "Have you foreseen?",
            "¿Han previsto ustedes?"
          ],
          [
            "Have they foreseen?",
            "¿Han previsto ellos?"
          ]
        ]
      }
    }
  },
  {
    "key": "mistake",
    "c1": "MISTAKE",
    "c2": "MISTOOK",
    "c3": "MISTAKEN",
    "es": "Equivocarse / Confundir algo con otra cosa",
    "active": {
      "P": {
        "A": [
          [
            "I",
            "I mistake",
            "Yo me equivoco / confundo"
          ],
          [
            "YOU_S",
            "You mistake",
            "Tú te equivocas / confundes"
          ],
          [
            "HE",
            "He mistakes",
            "Él se equivoca / confunde"
          ],
          [
            "SHE",
            "She mistakes",
            "Ella se equivoca / confunde"
          ],
          [
            "IT",
            "It mistakes",
            "Eso se equivoca / confunde"
          ],
          [
            "WE",
            "We mistake",
            "Nosotros nos equivocamos"
          ],
          [
            "YOU_P",
            "You mistake",
            "Ustedes se equivocan"
          ],
          [
            "THEY",
            "They mistake",
            "Ellos se equivocan"
          ]
        ],
        "N": [
          [
            "I",
            "I don’t mistake",
            "Yo no me equivoco / confundo"
          ],
          [
            "YOU_S",
            "You don’t mistake",
            "Tú no te equivocas"
          ],
          [
            "HE",
            "He doesn’t mistake",
            "Él no se equivoca"
          ],
          [
            "SHE",
            "She doesn’t mistake",
            "Ella no se equivoca"
          ],
          [
            "IT",
            "It doesn’t mistake",
            "Eso no se equivoca"
          ],
          [
            "WE",
            "We don’t mistake",
            "Nosotros no nos equivocamos"
          ],
          [
            "YOU_P",
            "You don’t mistake",
            "Ustedes no se equivocan"
          ],
          [
            "THEY",
            "They don’t mistake",
            "Ellos no se equivocan"
          ]
        ],
        "Q": [
          [
            "Do I mistake?",
            "¿Me equivoco yo?"
          ],
          [
            "Do you mistake?",
            "¿Te equivocas tú?"
          ],
          [
            "Does he mistake?",
            "¿Se equivoca él?"
          ],
          [
            "Does she mistake?",
            "¿Se equivoca ella?"
          ],
          [
            "Does it mistake?",
            "¿Se equivoca eso?"
          ],
          [
            "Do we mistake?",
            "¿Nos equivocamos nosotros?"
          ],
          [
            "Do you mistake?",
            "¿Se equivocan ustedes?"
          ],
          [
            "Do they mistake?",
            "¿Se equivocan ellos?"
          ]
        ]
      },
      "S": {
        "A": [
          [
            "I",
            "I mistook",
            "Yo me equivoqué / confundí"
          ],
          [
            "YOU_S",
            "You mistook",
            "Tú te equivocaste"
          ],
          [
            "HE",
            "He mistook",
            "Él se equivocó"
          ],
          [
            "SHE",
            "She mistook",
            "Ella se equivocó"
          ],
          [
            "IT",
            "It mistook",
            "Eso se equivocó"
          ],
          [
            "WE",
            "We mistook",
            "Nosotros nos equivocamos"
          ],
          [
            "YOU_P",
            "You mistook",
            "Ustedes se equivocaron"
          ],
          [
            "THEY",
            "They mistook",
            "Ellos se equivocaron"
          ]
        ],
        "N": [
          [
            "I",
            "I didn’t mistake",
            "Yo no me equivoqué"
          ],
          [
            "YOU_S",
            "You didn’t mistake",
            "Tú no te equivocaste"
          ],
          [
            "HE",
            "He didn’t mistake",
            "Él no se equivocó"
          ],
          [
            "SHE",
            "She didn’t mistake",
            "Ella no se equivocó"
          ],
          [
            "IT",
            "It didn’t mistake",
            "Eso no se equivocó"
          ],
          [
            "WE",
            "We didn’t mistake",
            "Nosotros no nos equivocamos"
          ],
          [
            "YOU_P",
            "You didn’t mistake",
            "Ustedes no se equivocaron"
          ],
          [
            "THEY",
            "They didn’t mistake",
            "Ellos no se equivocaron"
          ]
        ],
        "Q": [
          [
            "Did I mistake?",
            "¿Me equivoqué yo?"
          ],
          [
            "Did you mistake?",
            "¿Te equivocaste tú?"
          ],
          [
            "Did he mistake?",
            "¿Se equivocó él?"
          ],
          [
            "Did she mistake?",
            "¿Se equivocó ella?"
          ],
          [
            "Did it mistake?",
            "¿Se equivocó eso?"
          ],
          [
            "Did we mistake?",
            "¿Nos equivocamos nosotros?"
          ],
          [
            "Did you mistake?",
            "¿Se equivocaron ustedes?"
          ],
          [
            "Did they mistake?",
            "¿Se equivocaron ellos?"
          ]
        ]
      },
      "PP": {
        "A": [
          [
            "I",
            "I have mistaken",
            "Yo me he equivocado"
          ],
          [
            "YOU_S",
            "You have mistaken",
            "Tú te has equivocado"
          ],
          [
            "HE",
            "He has mistaken",
            "Él se ha equivocado"
          ],
          [
            "SHE",
            "She has mistaken",
            "Ella se ha equivocado"
          ],
          [
            "IT",
            "It has mistaken",
            "Eso se ha equivocado"
          ],
          [
            "WE",
            "We have mistaken",
            "Nosotros nos hemos equivocado"
          ],
          [
            "YOU_P",
            "You have mistaken",
            "Ustedes se han equivocado"
          ],
          [
            "THEY",
            "They have mistaken",
            "Ellos se han equivocado"
          ]
        ],
        "N": [
          [
            "I",
            "I haven’t mistaken",
            "Yo no me he equivocado"
          ],
          [
            "YOU_S",
            "You haven’t mistaken",
            "Tú no te has equivocado"
          ],
          [
            "HE",
            "He hasn’t mistaken",
            "Él no se ha equivocado"
          ],
          [
            "SHE",
            "She hasn’t mistaken",
            "Ella no se ha equivocado"
          ],
          [
            "IT",
            "It hasn’t mistaken",
            "Eso no se ha equivocado"
          ],
          [
            "WE",
            "We haven’t mistaken",
            "Nosotros no nos hemos equivocado"
          ],
          [
            "YOU_P",
            "You haven’t mistaken",
            "Ustedes no se han equivocado"
          ],
          [
            "THEY",
            "They haven’t mistaken",
            "Ellos no se han equivocado"
          ]
        ],
        "Q": [
          [
            "Have I mistaken?",
            "¿Me he equivocado yo?"
          ],
          [
            "Have you mistaken?",
            "¿Te has equivocado tú?"
          ],
          [
            "Has he mistaken?",
            "¿Se ha equivocado él?"
          ],
          [
            "Has she mistaken?",
            "¿Se ha equivocado ella?"
          ],
          [
            "Has it mistaken?",
            "¿Se ha equivocado eso?"
          ],
          [
            "Have we mistaken?",
            "¿Nos hemos equivocado nosotros?"
          ],
          [
            "Have you mistaken?",
            "¿Se han equivocado ustedes?"
          ],
          [
            "Have they mistaken?",
            "¿Se han equivocado ellos?"
          ]
        ]
      }
    }
  },
  {
    "key": "undertake",
    "c1": "UNDERTAKE",
    "c2": "UNDERTOOK",
    "c3": "UNDERTAKEN",
    "es": "Emprender / Asumir (una tarea, responsabilidad, proyecto)",
    "active": {
      "P": {
        "A": [
          [
            "I",
            "I undertake",
            "Yo emprendo / asumo"
          ],
          [
            "YOU_S",
            "You undertake",
            "Tú emprendes"
          ],
          [
            "HE",
            "He undertakes",
            "Él emprende"
          ],
          [
            "SHE",
            "She undertakes",
            "Ella emprende"
          ],
          [
            "IT",
            "It undertakes",
            "Eso emprende"
          ],
          [
            "WE",
            "We undertake",
            "Nosotros emprendemos"
          ],
          [
            "YOU_P",
            "You undertake",
            "Ustedes emprenden"
          ],
          [
            "THEY",
            "They undertake",
            "Ellos emprenden"
          ]
        ],
        "N": [
          [
            "I",
            "I don’t undertake",
            "Yo no emprendo"
          ],
          [
            "YOU_S",
            "You don’t undertake",
            "Tú no emprendes"
          ],
          [
            "HE",
            "He doesn’t undertake",
            "Él no emprende"
          ],
          [
            "SHE",
            "She doesn’t undertake",
            "Ella no emprende"
          ],
          [
            "IT",
            "It doesn’t undertake",
            "Eso no emprende"
          ],
          [
            "WE",
            "We don’t undertake",
            "Nosotros no emprendemos"
          ],
          [
            "YOU_P",
            "You don’t undertake",
            "Ustedes no emprenden"
          ],
          [
            "THEY",
            "They don’t undertake",
            "Ellos no emprenden"
          ]
        ],
        "Q": [
          [
            "Do I undertake?",
            "¿Emprendo yo?"
          ],
          [
            "Do you undertake?",
            "¿Emprendes tú?"
          ],
          [
            "Does he undertake?",
            "¿Emprende él?"
          ],
          [
            "Does she undertake?",
            "¿Emprende ella?"
          ],
          [
            "Does it undertake?",
            "¿Emprende eso?"
          ],
          [
            "Do we undertake?",
            "¿Emprendemos nosotros?"
          ],
          [
            "Do you undertake?",
            "¿Emprenden ustedes?"
          ],
          [
            "Do they undertake?",
            "¿Emprenden ellos?"
          ]
        ]
      },
      "S": {
        "A": [
          [
            "I",
            "I undertook",
            "Yo emprendí"
          ],
          [
            "YOU_S",
            "You undertook",
            "Tú emprendiste"
          ],
          [
            "HE",
            "He undertook",
            "Él emprendió"
          ],
          [
            "SHE",
            "She undertook",
            "Ella emprendió"
          ],
          [
            "IT",
            "It undertook",
            "Eso emprendió"
          ],
          [
            "WE",
            "We undertook",
            "Nosotros emprendimos"
          ],
          [
            "YOU_P",
            "You undertook",
            "Ustedes emprendieron"
          ],
          [
            "THEY",
            "They undertook",
            "Ellos emprendieron"
          ]
        ],
        "N": [
          [
            "I",
            "I didn’t undertake",
            "Yo no emprendí"
          ],
          [
            "YOU_S",
            "You didn’t undertake",
            "Tú no emprendiste"
          ],
          [
            "HE",
            "He didn’t undertake",
            "Él no emprendió"
          ],
          [
            "SHE",
            "She didn’t undertake",
            "Ella no emprendió"
          ],
          [
            "IT",
            "It didn’t undertake",
            "Eso no emprendió"
          ],
          [
            "WE",
            "We didn’t undertake",
            "Nosotros no emprendimos"
          ],
          [
            "YOU_P",
            "You didn’t undertake",
            "Ustedes no emprendieron"
          ],
          [
            "THEY",
            "They didn’t undertake",
            "Ellos no emprendieron"
          ]
        ],
        "Q": [
          [
            "Did I undertake?",
            "¿Emprendí yo?"
          ],
          [
            "Did you undertake?",
            "¿Emprendiste tú?"
          ],
          [
            "Did he undertake?",
            "¿Emprendió él?"
          ],
          [
            "Did she undertake?",
            "¿Emprendió ella?"
          ],
          [
            "Did it undertake?",
            "¿Emprendió eso?"
          ],
          [
            "Did we undertake?",
            "¿Emprendimos nosotros?"
          ],
          [
            "Did you undertake?",
            "¿Emprendieron ustedes?"
          ],
          [
            "Did they undertake?",
            "¿Emprendieron ellos?"
          ]
        ]
      },
      "PP": {
        "A": [
          [
            "I",
            "I have undertaken",
            "Yo he emprendido / asumido"
          ],
          [
            "YOU_S",
            "You have undertaken",
            "Tú has emprendido"
          ],
          [
            "HE",
            "He has undertaken",
            "Él ha emprendido"
          ],
          [
            "SHE",
            "She has undertaken",
            "Ella ha emprendido"
          ],
          [
            "IT",
            "It has undertaken",
            "Eso ha emprendido"
          ],
          [
            "WE",
            "We have undertaken",
            "Nosotros hemos emprendido"
          ],
          [
            "YOU_P",
            "You have undertaken",
            "Ustedes han emprendido"
          ],
          [
            "THEY",
            "They have undertaken",
            "Ellos han emprendido"
          ]
        ],
        "N": [
          [
            "I",
            "I haven’t undertaken",
            "Yo no he emprendido"
          ],
          [
            "YOU_S",
            "You haven’t undertaken",
            "Tú no has emprendido"
          ],
          [
            "HE",
            "He hasn’t undertaken",
            "Él no ha emprendido"
          ],
          [
            "SHE",
            "She hasn’t undertaken",
            "Ella no ha emprendido"
          ],
          [
            "IT",
            "It hasn’t undertaken",
            "Eso no ha emprendido"
          ],
          [
            "WE",
            "We haven’t undertaken",
            "Nosotros no hemos emprendido"
          ],
          [
            "YOU_P",
            "You haven’t undertaken",
            "Ustedes no han emprendido"
          ],
          [
            "THEY",
            "They haven’t undertaken",
            "Ellos no han emprendido"
          ]
        ],
        "Q": [
          [
            "Have I undertaken?",
            "¿He emprendido yo?"
          ],
          [
            "Have you undertaken?",
            "¿Has emprendido tú?"
          ],
          [
            "Has he undertaken?",
            "¿Ha emprendido él?"
          ],
          [
            "Has she undertaken?",
            "¿Ha emprendido ella?"
          ],
          [
            "Has it undertaken?",
            "¿Ha emprendido eso?"
          ],
          [
            "Have we undertaken?",
            "¿Hemos emprendido nosotros?"
          ],
          [
            "Have you undertaken?",
            "¿Han emprendido ustedes?"
          ],
          [
            "Have they undertaken?",
            "¿Han emprendido ellos?"
          ]
        ]
      }
    }
  },
  {
    "key": "sink",
    "c1": "SINK",
    "c2": "SANK",
    "c3": "SUNK",
    "es": "Hundirse / Sumergirse",
    "active": {
      "P": {
        "A": [
          [
            "I",
            "I sink",
            "Yo me hundo"
          ],
          [
            "YOU_S",
            "You sink",
            "Tú te hundes"
          ],
          [
            "HE",
            "He sinks",
            "Él se hunde"
          ],
          [
            "SHE",
            "She sinks",
            "Ella se hunde"
          ],
          [
            "IT",
            "It sinks",
            "Eso se hunde"
          ],
          [
            "WE",
            "We sink",
            "Nosotros nos hundimos"
          ],
          [
            "YOU_P",
            "You sink",
            "Ustedes se hunden"
          ],
          [
            "THEY",
            "They sink",
            "Ellos se hunden"
          ]
        ],
        "N": [
          [
            "I",
            "I don’t sink",
            "Yo no me hundo"
          ],
          [
            "YOU_S",
            "You don’t sink",
            "Tú no te hundes"
          ],
          [
            "HE",
            "He doesn’t sink",
            "Él no se hunde"
          ],
          [
            "SHE",
            "She doesn’t sink",
            "Ella no se hunde"
          ],
          [
            "IT",
            "It doesn’t sink",
            "Eso no se hunde"
          ],
          [
            "WE",
            "We don’t sink",
            "Nosotros no nos hundimos"
          ],
          [
            "YOU_P",
            "You don’t sink",
            "Ustedes no se hunden"
          ],
          [
            "THEY",
            "They don’t sink",
            "Ellos no se hunden"
          ]
        ],
        "Q": [
          [
            "Do I sink?",
            "¿Me hundo yo?"
          ],
          [
            "Do you sink?",
            "¿Te hundes tú?"
          ],
          [
            "Does he sink?",
            "¿Se hunde él?"
          ],
          [
            "Does she sink?",
            "¿Se hunde ella?"
          ],
          [
            "Does it sink?",
            "¿Se hunde eso?"
          ],
          [
            "Do we sink?",
            "¿Nos hundimos nosotros?"
          ],
          [
            "Do you sink?",
            "¿Se hunden ustedes?"
          ],
          [
            "Do they sink?",
            "¿Se hunden ellos?"
          ]
        ]
      },
      "S": {
        "A": [
          [
            "I",
            "I sank",
            "Yo me hundí"
          ],
          [
            "YOU_S",
            "You sank",
            "Tú te hundiste"
          ],
          [
            "HE",
            "He sank",
            "Él se hundió"
          ],
          [
            "SHE",
            "She sank",
            "Ella se hundió"
          ],
          [
            "IT",
            "It sank",
            "Eso se hundió"
          ],
          [
            "WE",
            "We sank",
            "Nosotros nos hundimos"
          ],
          [
            "YOU_P",
            "You sank",
            "Ustedes se hundieron"
          ],
          [
            "THEY",
            "They sank",
            "Ellos se hundieron"
          ]
        ],
        "N": [
          [
            "I",
            "I didn’t sink",
            "Yo no me hundí"
          ],
          [
            "YOU_S",
            "You didn’t sink",
            "Tú no te hundiste"
          ],
          [
            "HE",
            "He didn’t sink",
            "Él no se hundió"
          ],
          [
            "SHE",
            "She didn’t sink",
            "Ella no se hundió"
          ],
          [
            "IT",
            "It didn’t sink",
            "Eso no se hundió"
          ],
          [
            "WE",
            "We didn’t sink",
            "Nosotros no nos hundimos"
          ],
          [
            "YOU_P",
            "You didn’t sink",
            "Ustedes no se hundieron"
          ],
          [
            "THEY",
            "They didn’t sink",
            "Ellos no se hundieron"
          ]
        ],
        "Q": [
          [
            "Did I sink?",
            "¿Me hundí yo?"
          ],
          [
            "Did you sink?",
            "¿Te hundiste tú?"
          ],
          [
            "Did he sink?",
            "¿Se hundió él?"
          ],
          [
            "Did she sink?",
            "¿Se hundió ella?"
          ],
          [
            "Did it sink?",
            "¿Se hundió eso?"
          ],
          [
            "Did we sink?",
            "¿Nos hundimos nosotros?"
          ],
          [
            "Did you sink?",
            "¿Se hundieron ustedes?"
          ],
          [
            "Did they sink?",
            "¿Se hundieron ellos?"
          ]
        ]
      },
      "PP": {
        "A": [
          [
            "I",
            "I have sunk",
            "Yo me he hundido"
          ],
          [
            "YOU_S",
            "You have sunk",
            "Tú te has hundido"
          ],
          [
            "HE",
            "He has sunk",
            "Él se ha hundido"
          ],
          [
            "SHE",
            "She has sunk",
            "Ella se ha hundido"
          ],
          [
            "IT",
            "It has sunk",
            "Eso se ha hundido"
          ],
          [
            "WE",
            "We have sunk",
            "Nosotros nos hemos hundido"
          ],
          [
            "YOU_P",
            "You have sunk",
            "Ustedes se han hundido"
          ],
          [
            "THEY",
            "They have sunk",
            "Ellos se han hundido"
          ]
        ],
        "N": [
          [
            "I",
            "I haven’t sunk",
            "Yo no me he hundido"
          ],
          [
            "YOU_S",
            "You haven’t sunk",
            "Tú no te has hundido"
          ],
          [
            "HE",
            "He hasn’t sunk",
            "Él no se ha hundido"
          ],
          [
            "SHE",
            "She hasn’t sunk",
            "Ella no se ha hundido"
          ],
          [
            "IT",
            "It hasn’t sunk",
            "Eso no se ha hundido"
          ],
          [
            "WE",
            "We haven’t sunk",
            "Nosotros no nos hemos hundido"
          ],
          [
            "YOU_P",
            "You haven’t sunk",
            "Ustedes no se han hundido"
          ],
          [
            "THEY",
            "They haven’t sunk",
            "Ellos no se han hundido"
          ]
        ],
        "Q": [
          [
            "Have I sunk?",
            "¿Me he hundido yo?"
          ],
          [
            "Have you sunk?",
            "¿Te has hundido tú?"
          ],
          [
            "Has he sunk?",
            "¿Se ha hundido él?"
          ],
          [
            "Has she sunk?",
            "¿Se ha hundido ella?"
          ],
          [
            "Has it sunk?",
            "¿Se ha hundido eso?"
          ],
          [
            "Have we sunk?",
            "¿Nos hemos hundido nosotros?"
          ],
          [
            "Have you sunk?",
            "¿Se han hundido ustedes?"
          ],
          [
            "Have they sunk?",
            "¿Se han hundido ellos?"
          ]
        ]
      }
    }
  },
  {
    "key": "shrink",
    "c1": "SHRINK",
    "c2": "SHRANK",
    "c3": "SHRUNK",
    "es": "Encogerse / Reducirse / Disminuir de tamaño",
    "active": {
      "P": {
        "A": [
          [
            "I",
            "I shrink",
            "Yo me encojo / me reduzco"
          ],
          [
            "YOU_S",
            "You shrink",
            "Tú te encoges"
          ],
          [
            "HE",
            "He shrinks",
            "Él se encoge"
          ],
          [
            "SHE",
            "She shrinks",
            "Ella se encoge"
          ],
          [
            "IT",
            "It shrinks",
            "Eso se encoge"
          ],
          [
            "WE",
            "We shrink",
            "Nosotros nos encogemos"
          ],
          [
            "YOU_P",
            "You shrink",
            "Ustedes se encogen"
          ],
          [
            "THEY",
            "They shrink",
            "Ellos se encogen"
          ]
        ],
        "N": [
          [
            "I",
            "I don’t shrink",
            "Yo no me encojo"
          ],
          [
            "YOU_S",
            "You don’t shrink",
            "Tú no te encoges"
          ],
          [
            "HE",
            "He doesn’t shrink",
            "Él no se encoge"
          ],
          [
            "SHE",
            "She doesn’t shrink",
            "Ella no se encoge"
          ],
          [
            "IT",
            "It doesn’t shrink",
            "Eso no se encoge"
          ],
          [
            "WE",
            "We don’t shrink",
            "Nosotros no nos encogemos"
          ],
          [
            "YOU_P",
            "You don’t shrink",
            "Ustedes no se encogen"
          ],
          [
            "THEY",
            "They don’t shrink",
            "Ellos no se encogen"
          ]
        ],
        "Q": [
          [
            "Do I shrink?",
            "¿Me encojo yo?"
          ],
          [
            "Do you shrink?",
            "¿Te encoges tú?"
          ],
          [
            "Does he shrink?",
            "¿Se encoge él?"
          ],
          [
            "Does she shrink?",
            "¿Se encoge ella?"
          ],
          [
            "Does it shrink?",
            "¿Se encoge eso?"
          ],
          [
            "Do we shrink?",
            "¿Nos encogemos nosotros?"
          ],
          [
            "Do you shrink?",
            "¿Se encogen ustedes?"
          ],
          [
            "Do they shrink?",
            "¿Se encogen ellos?"
          ]
        ]
      },
      "S": {
        "A": [
          [
            "I",
            "I shrank",
            "Yo me encogí"
          ],
          [
            "YOU_S",
            "You shrank",
            "Tú te encogiste"
          ],
          [
            "HE",
            "He shrank",
            "Él se encogió"
          ],
          [
            "SHE",
            "She shrank",
            "Ella se encogió"
          ],
          [
            "IT",
            "It shrank",
            "Eso se encogió"
          ],
          [
            "WE",
            "We shrank",
            "Nosotros nos encogimos"
          ],
          [
            "YOU_P",
            "You shrank",
            "Ustedes se encogieron"
          ],
          [
            "THEY",
            "They shrank",
            "Ellos se encogieron"
          ]
        ],
        "N": [
          [
            "I",
            "I didn’t shrink",
            "Yo no me encogí"
          ],
          [
            "YOU_S",
            "You didn’t shrink",
            "Tú no te encogiste"
          ],
          [
            "HE",
            "He didn’t shrink",
            "Él no se encogió"
          ],
          [
            "SHE",
            "She didn’t shrink",
            "Ella no se encogió"
          ],
          [
            "IT",
            "It didn’t shrink",
            "Eso no se encogió"
          ],
          [
            "WE",
            "We didn’t shrink",
            "Nosotros no nos encogimos"
          ],
          [
            "YOU_P",
            "You didn’t shrink",
            "Ustedes no se encogieron"
          ],
          [
            "THEY",
            "They didn’t shrink",
            "Ellos no se encogieron"
          ]
        ],
        "Q": [
          [
            "Did I shrink?",
            "¿Me encogí yo?"
          ],
          [
            "Did you shrink?",
            "¿Te encogiste tú?"
          ],
          [
            "Did he shrink?",
            "¿Se encogió él?"
          ],
          [
            "Did she shrink?",
            "¿Se encogió ella?"
          ],
          [
            "Did it shrink?",
            "¿Se encogió eso?"
          ],
          [
            "Did we shrink?",
            "¿Nos encogimos nosotros?"
          ],
          [
            "Did you shrink?",
            "¿Se encogieron ustedes?"
          ],
          [
            "Did they shrink?",
            "¿Se encogieron ellos?"
          ]
        ]
      },
      "PP": {
        "A": [
          [
            "I",
            "I have shrunk",
            "Yo me he encogido"
          ],
          [
            "YOU_S",
            "You have shrunk",
            "Tú te has encogido"
          ],
          [
            "HE",
            "He has shrunk",
            "Él se ha encogido"
          ],
          [
            "SHE",
            "She has shrunk",
            "Ella se ha encogido"
          ],
          [
            "IT",
            "It has shrunk",
            "Eso se ha encogido"
          ],
          [
            "WE",
            "We have shrunk",
            "Nosotros nos hemos encogido"
          ],
          [
            "YOU_P",
            "You have shrunk",
            "Ustedes se han encogido"
          ],
          [
            "THEY",
            "They have shrunk",
            "Ellos se han encogido"
          ]
        ],
        "N": [
          [
            "I",
            "I haven’t shrunk",
            "Yo no me he encogido"
          ],
          [
            "YOU_S",
            "You haven’t shrunk",
            "Tú no te has encogido"
          ],
          [
            "HE",
            "He hasn’t shrunk",
            "Él no se ha encogido"
          ],
          [
            "SHE",
            "She hasn’t shrunk",
            "Ella no se ha encogido"
          ],
          [
            "IT",
            "It hasn’t shrunk",
            "Eso no se ha encogido"
          ],
          [
            "WE",
            "We haven’t shrunk",
            "Nosotros no nos hemos encogido"
          ],
          [
            "YOU_P",
            "You haven’t shrunk",
            "Ustedes no se han encogido"
          ],
          [
            "THEY",
            "They haven’t shrunk",
            "Ellos no se han encogido"
          ]
        ],
        "Q": [
          [
            "Have I shrunk?",
            "¿Me he encogido yo?"
          ],
          [
            "Have you shrunk?",
            "¿Te has encogido tú?"
          ],
          [
            "Has he shrunk?",
            "¿Se ha encogido él?"
          ],
          [
            "Has she shrunk?",
            "¿Se ha encogido ella?"
          ],
          [
            "Has it shrunk?",
            "¿Se ha encogido eso?"
          ],
          [
            "Have we shrunk?",
            "¿Nos hemos encogido nosotros?"
          ],
          [
            "Have you shrunk?",
            "¿Se han encogido ustedes?"
          ],
          [
            "Have they shrunk?",
            "¿Se han encogido ellos?"
          ]
        ]
      }
    }
  },
  {
    "key": "choose",
    "c1": "CHOOSE",
    "c2": "CHOSE",
    "c3": "CHOSEN",
    "es": "Elegir / Escoger",
    "active": {
      "P": {
        "A": [
          [
            "I",
            "I choose",
            "Yo elijo"
          ],
          [
            "YOU_S",
            "You choose",
            "Tú eliges"
          ],
          [
            "HE",
            "He chooses",
            "Él elige"
          ],
          [
            "SHE",
            "She chooses",
            "Ella elige"
          ],
          [
            "IT",
            "It chooses",
            "Eso elige"
          ],
          [
            "WE",
            "We choose",
            "Nosotros elegimos"
          ],
          [
            "YOU_P",
            "You choose",
            "Ustedes eligen"
          ],
          [
            "THEY",
            "They choose",
            "Ellos eligen"
          ]
        ],
        "N": [
          [
            "I",
            "I don’t choose",
            "Yo no elijo"
          ],
          [
            "YOU_S",
            "You don’t choose",
            "Tú no eliges"
          ],
          [
            "HE",
            "He doesn’t choose",
            "Él no elige"
          ],
          [
            "SHE",
            "She doesn’t choose",
            "Ella no elige"
          ],
          [
            "IT",
            "It doesn’t choose",
            "Eso no elige"
          ],
          [
            "WE",
            "We don’t choose",
            "Nosotros no elegimos"
          ],
          [
            "YOU_P",
            "You don’t choose",
            "Ustedes no eligen"
          ],
          [
            "THEY",
            "They don’t choose",
            "Ellos no eligen"
          ]
        ],
        "Q": [
          [
            "Do I choose?",
            "¿Elijo yo?"
          ],
          [
            "Do you choose?",
            "¿Eliges tú?"
          ],
          [
            "Does he choose?",
            "¿Elige él?"
          ],
          [
            "Does she choose?",
            "¿Elige ella?"
          ],
          [
            "Does it choose?",
            "¿Elige eso?"
          ],
          [
            "Do we choose?",
            "¿Elegimos nosotros?"
          ],
          [
            "Do you choose?",
            "¿Eligen ustedes?"
          ],
          [
            "Do they choose?",
            "¿Eligen ellos?"
          ]
        ]
      },
      "S": {
        "A": [
          [
            "I",
            "I chose",
            "Yo elegí"
          ],
          [
            "YOU_S",
            "You chose",
            "Tú elegiste"
          ],
          [
            "HE",
            "He chose",
            "Él eligió"
          ],
          [
            "SHE",
            "She chose",
            "Ella eligió"
          ],
          [
            "IT",
            "It chose",
            "Eso eligió"
          ],
          [
            "WE",
            "We chose",
            "Nosotros elegimos"
          ],
          [
            "YOU_P",
            "You chose",
            "Ustedes eligieron"
          ],
          [
            "THEY",
            "They chose",
            "Ellos eligieron"
          ]
        ],
        "N": [
          [
            "I",
            "I didn’t choose",
            "Yo no elegí"
          ],
          [
            "YOU_S",
            "You didn’t choose",
            "Tú no elegiste"
          ],
          [
            "HE",
            "He didn’t choose",
            "Él no eligió"
          ],
          [
            "SHE",
            "She didn’t choose",
            "Ella no eligió"
          ],
          [
            "IT",
            "It didn’t choose",
            "Eso no eligió"
          ],
          [
            "WE",
            "We didn’t choose",
            "Nosotros no elegimos"
          ],
          [
            "YOU_P",
            "You didn’t choose",
            "Ustedes no eligieron"
          ],
          [
            "THEY",
            "They didn’t choose",
            "Ellos no eligieron"
          ]
        ],
        "Q": [
          [
            "Did I choose?",
            "¿Elegí yo?"
          ],
          [
            "Did you choose?",
            "¿Elegiste tú?"
          ],
          [
            "Did he choose?",
            "¿Eligió él?"
          ],
          [
            "Did she choose?",
            "¿Eligió ella?"
          ],
          [
            "Did it choose?",
            "¿Eligió eso?"
          ],
          [
            "Did we choose?",
            "¿Elegimos nosotros?"
          ],
          [
            "Did you choose?",
            "¿Eligieron ustedes?"
          ],
          [
            "Did they choose?",
            "¿Eligieron ellos?"
          ]
        ]
      },
      "PP": {
        "A": [
          [
            "I",
            "I have chosen",
            "Yo he elegido"
          ],
          [
            "YOU_S",
            "You have chosen",
            "Tú has elegido"
          ],
          [
            "HE",
            "He has chosen",
            "Él ha elegido"
          ],
          [
            "SHE",
            "She has chosen",
            "Ella ha elegido"
          ],
          [
            "IT",
            "It has chosen",
            "Eso ha elegido"
          ],
          [
            "WE",
            "We have chosen",
            "Nosotros hemos elegido"
          ],
          [
            "YOU_P",
            "You have chosen",
            "Ustedes han elegido"
          ],
          [
            "THEY",
            "They have chosen",
            "Ellos han elegido"
          ]
        ],
        "N": [
          [
            "I",
            "I haven’t chosen",
            "Yo no he elegido"
          ],
          [
            "YOU_S",
            "You haven’t chosen",
            "Tú no has elegido"
          ],
          [
            "HE",
            "He hasn’t chosen",
            "Él no ha elegido"
          ],
          [
            "SHE",
            "She hasn’t chosen",
            "Ella no ha elegido"
          ],
          [
            "IT",
            "It hasn’t chosen",
            "Eso no ha elegido"
          ],
          [
            "WE",
            "We haven’t chosen",
            "Nosotros no hemos elegido"
          ],
          [
            "YOU_P",
            "You haven’t chosen",
            "Ustedes no han elegido"
          ],
          [
            "THEY",
            "They haven’t chosen",
            "Ellos no han elegido"
          ]
        ],
        "Q": [
          [
            "Have I chosen?",
            "¿He elegido yo?"
          ],
          [
            "Have you chosen?",
            "¿Has elegido tú?"
          ],
          [
            "Has he chosen?",
            "¿Ha elegido él?"
          ],
          [
            "Has she chosen?",
            "¿Ha elegido ella?"
          ],
          [
            "Has it chosen?",
            "¿Ha elegido eso?"
          ],
          [
            "Have we chosen?",
            "¿Hemos elegido nosotros?"
          ],
          [
            "Have you chosen?",
            "¿Han elegido ustedes?"
          ],
          [
            "Have they chosen?",
            "¿Han elegido ellos?"
          ]
        ]
      }
    }
  },
  {
    "key": "know",
    "c1": "KNOW",
    "c2": "KNEW",
    "c3": "KNOWN",
    "es": "Saber / Conocer",
    "active": {
      "P": {
        "A": [
          [
            "I",
            "I know",
            "Yo sé / Yo conozco"
          ],
          [
            "YOU_S",
            "You know",
            "Tú sabes / conoces"
          ],
          [
            "HE",
            "He knows",
            "Él sabe / conoce"
          ],
          [
            "SHE",
            "She knows",
            "Ella sabe / conoce"
          ],
          [
            "IT",
            "It knows",
            "Eso sabe"
          ],
          [
            "WE",
            "We know",
            "Nosotros sabemos"
          ],
          [
            "YOU_P",
            "You know",
            "Ustedes saben"
          ],
          [
            "THEY",
            "They know",
            "Ellos saben"
          ]
        ],
        "N": [
          [
            "I",
            "I don’t know",
            "Yo no sé / no conozco"
          ],
          [
            "YOU_S",
            "You don’t know",
            "Tú no sabes / conoces"
          ],
          [
            "HE",
            "He doesn’t know",
            "Él no sabe / conoce"
          ],
          [
            "SHE",
            "She doesn’t know",
            "Ella no sabe / conoce"
          ],
          [
            "IT",
            "It doesn’t know",
            "Eso no sabe"
          ],
          [
            "WE",
            "We don’t know",
            "Nosotros no sabemos"
          ],
          [
            "YOU_P",
            "You don’t know",
            "Ustedes no saben"
          ],
          [
            "THEY",
            "They don’t know",
            "Ellos no saben"
          ]
        ],
        "Q": [
          [
            "Do I know?",
            "¿Sé yo? / ¿Conozco yo?"
          ],
          [
            "Do you know?",
            "¿Sabes tú? / ¿Conoces tú?"
          ],
          [
            "Does he know?",
            "¿Sabe él? / ¿Conoce él?"
          ],
          [
            "Does she know?",
            "¿Sabe ella? / ¿Conoce ella?"
          ],
          [
            "Does it know?",
            "¿Sabe eso?"
          ],
          [
            "Do we know?",
            "¿Sabemos nosotros?"
          ],
          [
            "Do you know?",
            "¿Saben ustedes?"
          ],
          [
            "Do they know?",
            "¿Saben ellos?"
          ]
        ]
      },
      "S": {
        "A": [
          [
            "I",
            "I knew",
            "Yo supe / conocí"
          ],
          [
            "YOU_S",
            "You knew",
            "Tú supiste / conociste"
          ],
          [
            "HE",
            "He knew",
            "Él supo / conoció"
          ],
          [
            "SHE",
            "She knew",
            "Ella supo / conoció"
          ],
          [
            "IT",
            "It knew",
            "Eso supo"
          ],
          [
            "WE",
            "We knew",
            "Nosotros supimos"
          ],
          [
            "YOU_P",
            "You knew",
            "Ustedes supieron"
          ],
          [
            "THEY",
            "They knew",
            "Ellos supieron"
          ]
        ],
        "N": [
          [
            "I",
            "I didn’t know",
            "Yo no supe / no conocí"
          ],
          [
            "YOU_S",
            "You didn’t know",
            "Tú no supiste"
          ],
          [
            "HE",
            "He didn’t know",
            "Él no supo"
          ],
          [
            "SHE",
            "She didn’t know",
            "Ella no supo"
          ],
          [
            "IT",
            "It didn’t know",
            "Eso no supo"
          ],
          [
            "WE",
            "We didn’t know",
            "Nosotros no supimos"
          ],
          [
            "YOU_P",
            "You didn’t know",
            "Ustedes no supieron"
          ],
          [
            "THEY",
            "They didn’t know",
            "Ellos no supieron"
          ]
        ],
        "Q": [
          [
            "Did I know?",
            "¿Supe yo? / ¿Conocí yo?"
          ],
          [
            "Did you know?",
            "¿Supiste tú?"
          ],
          [
            "Did he know?",
            "¿Supo él?"
          ],
          [
            "Did she know?",
            "¿Supo ella?"
          ],
          [
            "Did it know?",
            "¿Supo eso?"
          ],
          [
            "Did we know?",
            "¿Supimos nosotros?"
          ],
          [
            "Did you know?",
            "¿Supieron ustedes?"
          ],
          [
            "Did they know?",
            "¿Supieron ellos?"
          ]
        ]
      },
      "PP": {
        "A": [
          [
            "I",
            "I have known",
            "Yo he sabido / conocido"
          ],
          [
            "YOU_S",
            "You have known",
            "Tú has sabido / conocido"
          ],
          [
            "HE",
            "He has known",
            "Él ha sabido / conocido"
          ],
          [
            "SHE",
            "She has known",
            "Ella ha sabido / conocido"
          ],
          [
            "IT",
            "It has known",
            "Eso ha sabido"
          ],
          [
            "WE",
            "We have known",
            "Nosotros hemos sabido"
          ],
          [
            "YOU_P",
            "You have known",
            "Ustedes han sabido"
          ],
          [
            "THEY",
            "They have known",
            "Ellos han sabido"
          ]
        ],
        "N": [
          [
            "I",
            "I haven’t known",
            "Yo no he sabido / conocido"
          ],
          [
            "YOU_S",
            "You haven’t known",
            "Tú no has sabido"
          ],
          [
            "HE",
            "He hasn’t known",
            "Él no ha sabido"
          ],
          [
            "SHE",
            "She hasn’t known",
            "Ella no ha sabido"
          ],
          [
            "IT",
            "It hasn’t known",
            "Eso no ha sabido"
          ],
          [
            "WE",
            "We haven’t known",
            "Nosotros no hemos sabido"
          ],
          [
            "YOU_P",
            "You haven’t known",
            "Ustedes no han sabido"
          ],
          [
            "THEY",
            "They haven’t known",
            "Ellos no han sabido"
          ]
        ],
        "Q": [
          [
            "Have I known?",
            "¿He sabido yo?"
          ],
          [
            "Have you known?",
            "¿Has sabido tú?"
          ],
          [
            "Has he known?",
            "¿Ha sabido él?"
          ],
          [
            "Has she known?",
            "¿Ha sabido ella?"
          ],
          [
            "Has it known?",
            "¿Ha sabido eso?"
          ],
          [
            "Have we known?",
            "¿Hemos sabido nosotros?"
          ],
          [
            "Have you known?",
            "¿Han sabido ustedes?"
          ],
          [
            "Have they known?",
            "¿Han sabido ellos?"
          ]
        ]
      }
    }
  },
  {
    "key": "grow",
    "c1": "GROW",
    "c2": "GREW",
    "c3": "GROWN",
    "es": "Crecer / Cultivar / Aumentar",
    "active": {
      "P": {
        "A": [
          [
            "I",
            "I grow",
            "Yo crezco / cultivo"
          ],
          [
            "YOU_S",
            "You grow",
            "Tú creces / cultivas"
          ],
          [
            "HE",
            "He grows",
            "Él crece / cultiva"
          ],
          [
            "SHE",
            "She grows",
            "Ella crece / cultiva"
          ],
          [
            "IT",
            "It grows",
            "Eso crece"
          ],
          [
            "WE",
            "We grow",
            "Nosotros crecemos"
          ],
          [
            "YOU_P",
            "You grow",
            "Ustedes crecen"
          ],
          [
            "THEY",
            "They grow",
            "Ellos crecen"
          ]
        ],
        "N": [
          [
            "I",
            "I don’t grow",
            "Yo no crezco / no cultivo"
          ],
          [
            "YOU_S",
            "You don’t grow",
            "Tú no creces"
          ],
          [
            "HE",
            "He doesn’t grow",
            "Él no crece"
          ],
          [
            "SHE",
            "She doesn’t grow",
            "Ella no crece"
          ],
          [
            "IT",
            "It doesn’t grow",
            "Eso no crece"
          ],
          [
            "WE",
            "We don’t grow",
            "Nosotros no crecemos"
          ],
          [
            "YOU_P",
            "You don’t grow",
            "Ustedes no crecen"
          ],
          [
            "THEY",
            "They don’t grow",
            "Ellos no crecen"
          ]
        ],
        "Q": [
          [
            "Do I grow?",
            "¿Crezco yo? / ¿Cultivo yo?"
          ],
          [
            "Do you grow?",
            "¿Creces tú?"
          ],
          [
            "Does he grow?",
            "¿Crece él?"
          ],
          [
            "Does she grow?",
            "¿Crece ella?"
          ],
          [
            "Does it grow?",
            "¿Crece eso?"
          ],
          [
            "Do we grow?",
            "¿Crecemos nosotros?"
          ],
          [
            "Do you grow?",
            "¿Crecen ustedes?"
          ],
          [
            "Do they grow?",
            "¿Crecen ellos?"
          ]
        ]
      },
      "S": {
        "A": [
          [
            "I",
            "I grew",
            "Yo crecí / cultivé"
          ],
          [
            "YOU_S",
            "You grew",
            "Tú creciste"
          ],
          [
            "HE",
            "He grew",
            "Él creció"
          ],
          [
            "SHE",
            "She grew",
            "Ella creció"
          ],
          [
            "IT",
            "It grew",
            "Eso creció"
          ],
          [
            "WE",
            "We grew",
            "Nosotros crecimos"
          ],
          [
            "YOU_P",
            "You grew",
            "Ustedes crecieron"
          ],
          [
            "THEY",
            "They grew",
            "Ellos crecieron"
          ]
        ],
        "N": [
          [
            "I",
            "I didn’t grow",
            "Yo no crecí"
          ],
          [
            "YOU_S",
            "You didn’t grow",
            "Tú no creciste"
          ],
          [
            "HE",
            "He didn’t grow",
            "Él no creció"
          ],
          [
            "SHE",
            "She didn’t grow",
            "Ella no creció"
          ],
          [
            "IT",
            "It didn’t grow",
            "Eso no creció"
          ],
          [
            "WE",
            "We didn’t grow",
            "Nosotros no crecimos"
          ],
          [
            "YOU_P",
            "You didn’t grow",
            "Ustedes no crecieron"
          ],
          [
            "THEY",
            "They didn’t grow",
            "Ellos no crecieron"
          ]
        ],
        "Q": [
          [
            "Did I grow?",
            "¿Crecí yo?"
          ],
          [
            "Did you grow?",
            "¿Creciste tú?"
          ],
          [
            "Did he grow?",
            "¿Creció él?"
          ],
          [
            "Did she grow?",
            "¿Creció ella?"
          ],
          [
            "Did it grow?",
            "¿Creció eso?"
          ],
          [
            "Did we grow?",
            "¿Crecimos nosotros?"
          ],
          [
            "Did you grow?",
            "¿Crecieron ustedes?"
          ],
          [
            "Did they grow?",
            "¿Crecieron ellos?"
          ]
        ]
      },
      "PP": {
        "A": [
          [
            "I",
            "I have grown",
            "Yo he crecido / cultivado"
          ],
          [
            "YOU_S",
            "You have grown",
            "Tú has crecido"
          ],
          [
            "HE",
            "He has grown",
            "Él ha crecido"
          ],
          [
            "SHE",
            "She has grown",
            "Ella ha crecido"
          ],
          [
            "IT",
            "It has grown",
            "Eso ha crecido"
          ],
          [
            "WE",
            "We have grown",
            "Nosotros hemos crecido"
          ],
          [
            "YOU_P",
            "You have grown",
            "Ustedes han crecido"
          ],
          [
            "THEY",
            "They have grown",
            "Ellos han crecido"
          ]
        ],
        "N": [
          [
            "I",
            "I haven’t grown",
            "Yo no he crecido"
          ],
          [
            "YOU_S",
            "You haven’t grown",
            "Tú no has crecido"
          ],
          [
            "HE",
            "He hasn’t grown",
            "Él no ha crecido"
          ],
          [
            "SHE",
            "She hasn’t grown",
            "Ella no ha crecido"
          ],
          [
            "IT",
            "It hasn’t grown",
            "Eso no ha crecido"
          ],
          [
            "WE",
            "We haven’t grown",
            "Nosotros no hemos crecido"
          ],
          [
            "YOU_P",
            "You haven’t grown",
            "Ustedes no han crecido"
          ],
          [
            "THEY",
            "They haven’t grown",
            "Ellos no han crecido"
          ]
        ],
        "Q": [
          [
            "Have I grown?",
            "¿He crecido yo?"
          ],
          [
            "Have you grown?",
            "¿Has crecido tú?"
          ],
          [
            "Has he grown?",
            "¿Ha crecido él?"
          ],
          [
            "Has she grown?",
            "¿Ha crecido ella?"
          ],
          [
            "Has it grown?",
            "¿Ha crecido eso?"
          ],
          [
            "Have we grown?",
            "¿Hemos crecido nosotros?"
          ],
          [
            "Have you grown?",
            "¿Han crecido ustedes?"
          ],
          [
            "Have they grown?",
            "¿Han crecido ellos?"
          ]
        ]
      }
    }
  },
  {
    "key": "stride",
    "c1": "STRIDE",
    "c2": "STRODE",
    "c3": "STRIDDEN",
    "es": "Dar zancadas / Caminar con paso largo y firme",
    "active": {
      "P": {
        "A": [
          [
            "I",
            "I stride",
            "Yo camino con paso firme"
          ],
          [
            "YOU_S",
            "You stride",
            "Tú caminas con paso firme"
          ],
          [
            "HE",
            "He strides",
            "Él camina con paso firme"
          ],
          [
            "SHE",
            "She strides",
            "Ella camina con paso firme"
          ],
          [
            "IT",
            "It strides",
            "Eso camina con paso firme"
          ],
          [
            "WE",
            "We stride",
            "Nosotros caminamos firme"
          ],
          [
            "YOU_P",
            "You stride",
            "Ustedes caminan firme"
          ],
          [
            "THEY",
            "They stride",
            "Ellos caminan firme"
          ]
        ],
        "N": [
          [
            "I",
            "I don’t stride",
            "Yo no camino con paso firme"
          ],
          [
            "YOU_S",
            "You don’t stride",
            "Tú no caminas con paso firme"
          ],
          [
            "HE",
            "He doesn’t stride",
            "Él no camina con paso firme"
          ],
          [
            "SHE",
            "She doesn’t stride",
            "Ella no camina con paso firme"
          ],
          [
            "IT",
            "It doesn’t stride",
            "Eso no camina con paso firme"
          ],
          [
            "WE",
            "We don’t stride",
            "Nosotros no caminamos con firmeza"
          ],
          [
            "YOU_P",
            "You don’t stride",
            "Ustedes no caminan con firmeza"
          ],
          [
            "THEY",
            "They don’t stride",
            "Ellos no caminan con firmeza"
          ]
        ],
        "Q": [
          [
            "Do I stride?",
            "¿Camino con paso firme yo?"
          ],
          [
            "Do you stride?",
            "¿Caminas con paso firme tú?"
          ],
          [
            "Does he stride?",
            "¿Camina con paso firme él?"
          ],
          [
            "Does she stride?",
            "¿Camina con paso firme ella?"
          ],
          [
            "Does it stride?",
            "¿Camina con paso firme eso?"
          ],
          [
            "Do we stride?",
            "¿Caminamos con paso firme?"
          ],
          [
            "Do you stride?",
            "¿Caminan con paso firme ustedes?"
          ],
          [
            "Do they stride?",
            "¿Caminan con paso firme ellos?"
          ]
        ]
      },
      "S": {
        "A": [
          [
            "I",
            "I strode",
            "Yo caminé con paso firme"
          ],
          [
            "YOU_S",
            "You strode",
            "Tú caminaste con paso firme"
          ],
          [
            "HE",
            "He strode",
            "Él caminó con paso firme"
          ],
          [
            "SHE",
            "She strode",
            "Ella caminó con paso firme"
          ],
          [
            "IT",
            "It strode",
            "Eso caminó con paso firme"
          ],
          [
            "WE",
            "We strode",
            "Nosotros caminamos firmemente"
          ],
          [
            "YOU_P",
            "You strode",
            "Ustedes caminaron con firmeza"
          ],
          [
            "THEY",
            "They strode",
            "Ellos caminaron con firmeza"
          ]
        ],
        "N": [
          [
            "I",
            "I didn’t stride",
            "Yo no caminé con paso firme"
          ],
          [
            "YOU_S",
            "You didn’t stride",
            "Tú no caminaste con paso firme"
          ],
          [
            "HE",
            "He didn’t stride",
            "Él no caminó con paso firme"
          ],
          [
            "SHE",
            "She didn’t stride",
            "Ella no caminó con paso firme"
          ],
          [
            "IT",
            "It didn’t stride",
            "Eso no caminó con paso firme"
          ],
          [
            "WE",
            "We didn’t stride",
            "Nosotros no caminamos así"
          ],
          [
            "YOU_P",
            "You didn’t stride",
            "Ustedes no caminaron firmemente"
          ],
          [
            "THEY",
            "They didn’t stride",
            "Ellos no caminaron con firmeza"
          ]
        ],
        "Q": [
          [
            "Did I stride?",
            "¿Caminé con paso firme yo?"
          ],
          [
            "Did you stride?",
            "¿Caminaste tú con paso firme?"
          ],
          [
            "Did he stride?",
            "¿Caminó él con paso firme?"
          ],
          [
            "Did she stride?",
            "¿Caminó ella con paso firme?"
          ],
          [
            "Did it stride?",
            "¿Caminó eso con paso firme?"
          ],
          [
            "Did we stride?",
            "¿Caminamos con paso firme?"
          ],
          [
            "Did you stride?",
            "¿Caminaron ustedes con firmeza?"
          ],
          [
            "Did they stride?",
            "¿Caminaron ellos con paso firme?"
          ]
        ]
      },
      "PP": {
        "A": [
          [
            "I",
            "I have stridden",
            "Yo he caminado con paso firme"
          ],
          [
            "YOU_S",
            "You have stridden",
            "Tú has caminado con paso firme"
          ],
          [
            "HE",
            "He has stridden",
            "Él ha caminado con paso firme"
          ],
          [
            "SHE",
            "She has stridden",
            "Ella ha caminado con paso firme"
          ],
          [
            "IT",
            "It has stridden",
            "Eso ha caminado con paso firme"
          ],
          [
            "WE",
            "We have stridden",
            "Nosotros hemos caminado con firmeza"
          ],
          [
            "YOU_P",
            "You have stridden",
            "Ustedes han caminado con firmeza"
          ],
          [
            "THEY",
            "They have stridden",
            "Ellos han caminado con firmeza"
          ]
        ],
        "N": [
          [
            "I",
            "I haven’t stridden",
            "Yo no he caminado con paso firme"
          ],
          [
            "YOU_S",
            "You haven’t stridden",
            "Tú no has caminado con firmeza"
          ],
          [
            "HE",
            "He hasn’t stridden",
            "Él no ha caminado con paso firme"
          ],
          [
            "SHE",
            "She hasn’t stridden",
            "Ella no ha caminado con firmeza"
          ],
          [
            "IT",
            "It hasn’t stridden",
            "Eso no ha caminado con paso firme"
          ],
          [
            "WE",
            "We haven’t stridden",
            "Nosotros no hemos caminado así"
          ],
          [
            "YOU_P",
            "You haven’t stridden",
            "Ustedes no han caminado con firmeza"
          ],
          [
            "THEY",
            "They haven’t stridden",
            "Ellos no han caminado con firmeza"
          ]
        ],
        "Q": [
          [
            "Have I stridden?",
            "¿He caminado con paso firme yo?"
          ],
          [
            "Have you stridden?",
            "¿Has caminado tú con paso firme?"
          ],
          [
            "Has he stridden?",
            "¿Ha caminado él con paso firme?"
          ],
          [
            "Has she stridden?",
            "¿Ha caminado ella con paso firme?"
          ],
          [
            "Has it stridden?",
            "¿Ha caminado eso con paso firme?"
          ],
          [
            "Have we stridden?",
            "¿Hemos caminado nosotros así?"
          ],
          [
            "Have you stridden?",
            "¿Han caminado ustedes con firmeza?"
          ],
          [
            "Have they stridden?",
            "¿Han caminado ellos con firmeza?"
          ]
        ]
      }
    }
  },
  {
    "key": "swell",
    "c1": "SWELL",
    "c2": "SWELLED",
    "c3": "SWOLLEN",
    "es": "Hincharse / Inflarse / Aumentar",
    "active": {
      "P": {
        "A": [
          [
            "I",
            "I swell",
            "Yo me hincho / inflamo"
          ],
          [
            "YOU_S",
            "You swell",
            "Tú te hinchas"
          ],
          [
            "HE",
            "He swells",
            "Él se hincha"
          ],
          [
            "SHE",
            "She swells",
            "Ella se hincha"
          ],
          [
            "IT",
            "It swells",
            "Eso se hincha"
          ],
          [
            "WE",
            "We swell",
            "Nosotros nos hinchamos"
          ],
          [
            "YOU_P",
            "You swell",
            "Ustedes se hinchan"
          ],
          [
            "THEY",
            "They swell",
            "Ellos se hinchan"
          ]
        ],
        "N": [
          [
            "I",
            "I don’t swell",
            "Yo no me hincho"
          ],
          [
            "YOU_S",
            "You don’t swell",
            "Tú no te hinchas"
          ],
          [
            "HE",
            "He doesn’t swell",
            "Él no se hincha"
          ],
          [
            "SHE",
            "She doesn’t swell",
            "Ella no se hincha"
          ],
          [
            "IT",
            "It doesn’t swell",
            "Eso no se hincha"
          ],
          [
            "WE",
            "We don’t swell",
            "Nosotros no nos hinchamos"
          ],
          [
            "YOU_P",
            "You don’t swell",
            "Ustedes no se hinchan"
          ],
          [
            "THEY",
            "They don’t swell",
            "Ellos no se hinchan"
          ]
        ],
        "Q": [
          [
            "Do I swell?",
            "¿Me hincho yo?"
          ],
          [
            "Do you swell?",
            "¿Te hinchas tú?"
          ],
          [
            "Does he swell?",
            "¿Se hincha él?"
          ],
          [
            "Does she swell?",
            "¿Se hincha ella?"
          ],
          [
            "Does it swell?",
            "¿Se hincha eso?"
          ],
          [
            "Do we swell?",
            "¿Nos hinchamos nosotros?"
          ],
          [
            "Do you swell?",
            "¿Se hinchan ustedes?"
          ],
          [
            "Do they swell?",
            "¿Se hinchan ellos?"
          ]
        ]
      },
      "S": {
        "A": [
          [
            "I",
            "I swelled",
            "Yo me hinché / me inflé"
          ],
          [
            "YOU_S",
            "You swelled",
            "Tú te hinchaste"
          ],
          [
            "HE",
            "He swelled",
            "Él se hinchó"
          ],
          [
            "SHE",
            "She swelled",
            "Ella se hinchó"
          ],
          [
            "IT",
            "It swelled",
            "Eso se hinchó"
          ],
          [
            "WE",
            "We swelled",
            "Nosotros nos hinchamos"
          ],
          [
            "YOU_P",
            "You swelled",
            "Ustedes se hincharon"
          ],
          [
            "THEY",
            "They swelled",
            "Ellos se hincharon"
          ]
        ],
        "N": [
          [
            "I",
            "I didn’t swell",
            "Yo no me hinché"
          ],
          [
            "YOU_S",
            "You didn’t swell",
            "Tú no te hinchaste"
          ],
          [
            "HE",
            "He didn’t swell",
            "Él no se hinchó"
          ],
          [
            "SHE",
            "She didn’t swell",
            "Ella no se hinchó"
          ],
          [
            "IT",
            "It didn’t swell",
            "Eso no se hinchó"
          ],
          [
            "WE",
            "We didn’t swell",
            "Nosotros no nos hinchamos"
          ],
          [
            "YOU_P",
            "You didn’t swell",
            "Ustedes no se hincharon"
          ],
          [
            "THEY",
            "They didn’t swell",
            "Ellos no se hincharon"
          ]
        ],
        "Q": [
          [
            "Did I swell?",
            "¿Me hinché yo?"
          ],
          [
            "Did you swell?",
            "¿Te hinchaste tú?"
          ],
          [
            "Did he swell?",
            "¿Se hinchó él?"
          ],
          [
            "Did she swell?",
            "¿Se hinchó ella?"
          ],
          [
            "Did it swell?",
            "¿Se hinchó eso?"
          ],
          [
            "Did we swell?",
            "¿Nos hinchamos nosotros?"
          ],
          [
            "Did you swell?",
            "¿Se hincharon ustedes?"
          ],
          [
            "Did they swell?",
            "¿Se hincharon ellos?"
          ]
        ]
      },
      "PP": {
        "A": [
          [
            "I",
            "I have swollen",
            "Yo me he hinchado"
          ],
          [
            "YOU_S",
            "You have swollen",
            "Tú te has hinchado"
          ],
          [
            "HE",
            "He has swollen",
            "Él se ha hinchado"
          ],
          [
            "SHE",
            "She has swollen",
            "Ella se ha hinchado"
          ],
          [
            "IT",
            "It has swollen",
            "Eso se ha hinchado"
          ],
          [
            "WE",
            "We have swollen",
            "Nosotros nos hemos hinchado"
          ],
          [
            "YOU_P",
            "You have swollen",
            "Ustedes se han hinchado"
          ],
          [
            "THEY",
            "They have swollen",
            "Ellos se han hinchado"
          ]
        ],
        "N": [
          [
            "I",
            "I haven’t swollen",
            "Yo no me he hinchado"
          ],
          [
            "YOU_S",
            "You haven’t swollen",
            "Tú no te has hinchado"
          ],
          [
            "HE",
            "He hasn’t swollen",
            "Él no se ha hinchado"
          ],
          [
            "SHE",
            "She hasn’t swollen",
            "Ella no se ha hinchado"
          ],
          [
            "IT",
            "It hasn’t swollen",
            "Eso no se ha hinchado"
          ],
          [
            "WE",
            "We haven’t swollen",
            "Nosotros no nos hemos hinchado"
          ],
          [
            "YOU_P",
            "You haven’t swollen",
            "Ustedes no se han hinchado"
          ],
          [
            "THEY",
            "They haven’t swollen",
            "Ellos no se han hinchado"
          ]
        ],
        "Q": [
          [
            "Have I swollen?",
            "¿Me he hinchado yo?"
          ],
          [
            "Have you swollen?",
            "¿Te has hinchado tú?"
          ],
          [
            "Has he swollen?",
            "¿Se ha hinchado él?"
          ],
          [
            "Has she swollen?",
            "¿Se ha hinchado ella?"
          ],
          [
            "Has it swollen?",
            "¿Se ha hinchado eso?"
          ],
          [
            "Have we swollen?",
            "¿Nos hemos hinchado nosotros?"
          ],
          [
            "Have you swollen?",
            "¿Se han hinchado ustedes?"
          ],
          [
            "Have they swollen?",
            "¿Se han hinchado ellos?"
          ]
        ]
      }
    },
    "note": "Como participio, “swollen” es el más común; “swelled” también se usa en algunos contextos."
  },
  {
    "key": "undo",
    "c1": "UNDO",
    "c2": "UNDID",
    "c3": "UNDONE",
    "es": "Deshacer / Revertir",
    "active": {
      "P": {
        "A": [
          [
            "I",
            "I undo",
            "Yo deshago"
          ],
          [
            "YOU_S",
            "You undo",
            "Tú deshaces"
          ],
          [
            "HE",
            "He undoes",
            "Él deshace"
          ],
          [
            "SHE",
            "She undoes",
            "Ella deshace"
          ],
          [
            "IT",
            "It undoes",
            "Eso deshace"
          ],
          [
            "WE",
            "We undo",
            "Nosotros deshacemos"
          ],
          [
            "YOU_P",
            "You undo",
            "Ustedes deshacen"
          ],
          [
            "THEY",
            "They undo",
            "Ellos deshacen"
          ]
        ],
        "N": [
          [
            "I",
            "I don’t undo",
            "Yo no deshago"
          ],
          [
            "YOU_S",
            "You don’t undo",
            "Tú no deshaces"
          ],
          [
            "HE",
            "He doesn’t undo",
            "Él no deshace"
          ],
          [
            "SHE",
            "She doesn’t undo",
            "Ella no deshace"
          ],
          [
            "IT",
            "It doesn’t undo",
            "Eso no deshace"
          ],
          [
            "WE",
            "We don’t undo",
            "Nosotros no deshacemos"
          ],
          [
            "YOU_P",
            "You don’t undo",
            "Ustedes no deshacen"
          ],
          [
            "THEY",
            "They don’t undo",
            "Ellos no deshacen"
          ]
        ],
        "Q": [
          [
            "Do I undo?",
            "¿Deshago yo?"
          ],
          [
            "Do you undo?",
            "¿Deshaces tú?"
          ],
          [
            "Does he undo?",
            "¿Deshace él?"
          ],
          [
            "Does she undo?",
            "¿Deshace ella?"
          ],
          [
            "Does it undo?",
            "¿Deshace eso?"
          ],
          [
            "Do we undo?",
            "¿Deshacemos nosotros?"
          ],
          [
            "Do you undo?",
            "¿Deshacen ustedes?"
          ],
          [
            "Do they undo?",
            "¿Deshacen ellos?"
          ]
        ]
      },
      "S": {
        "A": [
          [
            "I",
            "I undid",
            "Yo deshice"
          ],
          [
            "YOU_S",
            "You undid",
            "Tú deshiciste"
          ],
          [
            "HE",
            "He undid",
            "Él deshizo"
          ],
          [
            "SHE",
            "She undid",
            "Ella deshizo"
          ],
          [
            "IT",
            "It undid",
            "Eso deshizo"
          ],
          [
            "WE",
            "We undid",
            "Nosotros deshicimos"
          ],
          [
            "YOU_P",
            "You undid",
            "Ustedes deshicieron"
          ],
          [
            "THEY",
            "They undid",
            "Ellos deshicieron"
          ]
        ],
        "N": [
          [
            "I",
            "I didn’t undo",
            "Yo no deshice"
          ],
          [
            "YOU_S",
            "You didn’t undo",
            "Tú no deshiciste"
          ],
          [
            "HE",
            "He didn’t undo",
            "Él no deshizo"
          ],
          [
            "SHE",
            "She didn’t undo",
            "Ella no deshizo"
          ],
          [
            "IT",
            "It didn’t undo",
            "Eso no deshizo"
          ],
          [
            "WE",
            "We didn’t undo",
            "Nosotros no deshicimos"
          ],
          [
            "YOU_P",
            "You didn’t undo",
            "Ustedes no deshicieron"
          ],
          [
            "THEY",
            "They didn’t undo",
            "Ellos no deshicieron"
          ]
        ],
        "Q": [
          [
            "Did I undo?",
            "¿Deshice yo?"
          ],
          [
            "Did you undo?",
            "¿Deshiciste tú?"
          ],
          [
            "Did he undo?",
            "¿Deshizo él?"
          ],
          [
            "Did she undo?",
            "¿Deshizo ella?"
          ],
          [
            "Did it undo?",
            "¿Deshizo eso?"
          ],
          [
            "Did we undo?",
            "¿Deshicimos nosotros?"
          ],
          [
            "Did you undo?",
            "¿Deshicieron ustedes?"
          ],
          [
            "Did they undo?",
            "¿Deshicieron ellos?"
          ]
        ]
      },
      "PP": {
        "A": [
          [
            "I",
            "I have undone",
            "Yo he deshecho"
          ],
          [
            "YOU_S",
            "You have undone",
            "Tú has deshecho"
          ],
          [
            "HE",
            "He has undone",
            "Él ha deshecho"
          ],
          [
            "SHE",
            "She has undone",
            "Ella ha deshecho"
          ],
          [
            "IT",
            "It has undone",
            "Eso ha deshecho"
          ],
          [
            "WE",
            "We have undone",
            "Nosotros hemos deshecho"
          ],
          [
            "YOU_P",
            "You have undone",
            "Ustedes han deshecho"
          ],
          [
            "THEY",
            "They have undone",
            "Ellos han deshecho"
          ]
        ],
        "N": [
          [
            "I",
            "I haven’t undone",
            "Yo no he deshecho"
          ],
          [
            "YOU_S",
            "You haven’t undone",
            "Tú no has deshecho"
          ],
          [
            "HE",
            "He hasn’t undone",
            "Él no ha deshecho"
          ],
          [
            "SHE",
            "She hasn’t undone",
            "Ella no ha deshecho"
          ],
          [
            "IT",
            "It hasn’t undone",
            "Eso no ha deshecho"
          ],
          [
            "WE",
            "We haven’t undone",
            "Nosotros no hemos deshecho"
          ],
          [
            "YOU_P",
            "You haven’t undone",
            "Ustedes no han deshecho"
          ],
          [
            "THEY",
            "They haven’t undone",
            "Ellos no han deshecho"
          ]
        ],
        "Q": [
          [
            "Have I undone?",
            "¿He deshecho yo?"
          ],
          [
            "Have you undone?",
            "¿Has deshecho tú?"
          ],
          [
            "Has he undone?",
            "¿Ha deshecho él?"
          ],
          [
            "Has she undone?",
            "¿Ha deshecho ella?"
          ],
          [
            "Has it undone?",
            "¿Ha deshecho eso?"
          ],
          [
            "Have we undone?",
            "¿Hemos deshecho nosotros?"
          ],
          [
            "Have you undone?",
            "¿Han deshecho ustedes?"
          ],
          [
            "Have they undone?",
            "¿Han deshecho ellos?"
          ]
        ]
      }
    }
  }
];

let __NY_VERBS3_DB_READY__ = false;

async function loadVerbsDbFromVerbs3Html(){
  try{
    const res = await fetch("verbs3.html", {cache: "no-store"});
    if(!res.ok) throw new Error("HTTP " + res.status);
    const html = await res.text();
    const m = html.match(/const\s+VERBS3_DB\s*=\s*(\[[\s\S]*?\])\s*;/);
    if(!m) throw new Error("VERBS3_DB no encontrado");
    const arrText = m[1];
    const db = Function("return " + arrText)();
    __NY_VERBS3_DB__ = Array.isArray(db) ? db : [];
    __nyNormalizeVerbsDb(__NY_VERBS3_DB__);
    __NY_VERBS3_DB_READY__ = true;
    return {ok:true, count: __NY_VERBS3_DB__.length};
  }catch(err){
    console.warn("No se pudo cargar verbs3.html:", err);
    // ✅ Si estamos en un entorno donde fetch falla (p.ej. abriendo neuroverbs.html por file://),
    // usamos un fallback embebido para no perder las traducciones exactas del Grupo 3.
    if(Array.isArray(__NY_VERBS3_FALLBACK__) && __NY_VERBS3_FALLBACK__.length){
      __NY_VERBS3_DB__ = __NY_VERBS3_FALLBACK__;
      __nyNormalizeVerbsDb(__NY_VERBS3_DB__);
      __NY_VERBS3_DB_READY__ = true;
      return {ok:true, count: __NY_VERBS3_DB__.length, fallback:true, error: String(err)};
    }

    __NY_VERBS3_DB_READY__ = false;
    __NY_VERBS3_DB__ = [];
    return {ok:false, error: String(err)};
  }
}





  // ===== Sincronización de verbos (neuroverbs.html ↔ verbs.html) =====
  // Carga la base VERBS_DB desde verbs.html y la fusiona con la base interna,
  // para que los menús de Grupo/Día y los ejercicios consulten SIEMPRE los verbos actualizados.
  let __verbsHtmlSyncPromise = null;
  async function ensureActiveDbFromVerbsHtml() {
    if (__verbsHtmlSyncPromise) return __verbsHtmlSyncPromise;
    __verbsHtmlSyncPromise = (async () => {
      const res = await loadVerbsDbFromVerbsHtml();
  loadVerbsDbFromVerbs2Html();

      const rawDb = window.__NY_VERBS_DB__ || [];
      if (res?.ok && window.__NY_VERBS_DB_READY__ && Array.isArray(rawDb) && rawDb.length) {
        const toNum = (x) => {
          const m = String(x ?? "").match(/(\d+)/);
          return m ? parseInt(m[1], 10) : NaN;
        };

        const ext = rawDb.map((v) => {
          const g = (typeof v.group === "number") ? v.group : toNum(v.group);
          const d = (typeof v.day === "number") ? v.day : toNum(v.day);

          const c1 = String(v.base || v.c1 || v.infinitive || v.inf || v.key || "").trim().toLowerCase();
          const c2 = String(v.past || v.c2 || "").trim().toLowerCase();
          const c3 = String(v.part || v.c3 || v.pp || "").trim().toLowerCase();

          const esp = String(v.meaning || v.es || v.esp || v.translation || "").trim();
          const key = String(v.key || c1).trim().toLowerCase();

          if (!g || !d || !c1 || !c2 || !c3) return null;
          return { g, d, esp, c1, c2, c3, key };
        }).filter(Boolean);

        if (ext.length) {
          // Fusionar con la base interna: si existe el mismo (g,d,c1) se actualiza; si no, se agrega.
          const map = new Map();
          (Array.isArray(verbosDB) ? verbosDB : []).forEach((v) => {
            const k = `${v.g}|${v.d}|${String(v.c1 || "").toLowerCase()}`;
            map.set(k, v);
          });
          ext.forEach((v) => {
            const k = `${v.g}|${v.d}|${String(v.c1 || "").toLowerCase()}`;
            const prev = map.get(k) || {};
            map.set(k, { ...prev, ...v });
          });

          const merged = Array.from(map.values()).filter((v) => v && v.g && v.d && v.c1 && v.c2 && v.c3);
          merged.sort((a, b) => (a.g - b.g) || (a.d - b.d) || String(a.c1).localeCompare(String(b.c1)));

          verbosDB = merged;
          verbosDB_R1 = merged;
          verbosDB_R2 = merged.map((v) => ({ ...v, d: v.d + 40 }));

          // Mantener la lógica de rounds: activeDB depende del round actual
          try {
            activeDB = (typeof currentRound !== "undefined" && currentRound === 2) ? verbosDB_R2 : verbosDB_R1;
          } catch {
            activeDB = verbosDB_R1;
          }

          window.__NY_VERB_SYNCED__ = true;
        }
      }
      return res;
    })().catch((err) => {
      console.warn("⚠️ No se pudo sincronizar verbs.html:", err);
      return { ok: false, error: err };
    });

    return __verbsHtmlSyncPromise;
  }


function __nyNormalizeVerbsDb(db){
  // Normaliza claves para búsquedas (key en minúscula; c1/c2/c3 en MAYÚSCULA).
  if(!Array.isArray(db)) return;
  db.forEach((e) => {
    if(!e || typeof e !== "object") return;
    if(e.key != null) e.key = String(e.key).trim().toLowerCase();
    if(e.c1 != null) e.c1 = String(e.c1).trim().toUpperCase();
    if(e.c2 != null) e.c2 = String(e.c2).trim().toUpperCase();
    if(e.c3 != null) e.c3 = String(e.c3).trim().toUpperCase();
  });
}

function __nyVerbKeyFromIndexVerb(v){
  return String((v && v.c1) ? v.c1 : "").trim().toLowerCase();
}
function __nyPronKeyToDb(pKey){
  // index usa: I, You, He, She, It, We, YouP, They
  const k = String(pKey||"");
  if(k==="You") return "YOU_S";
  if(k==="YouP") return "YOU_P";
  return k.toUpperCase(); // I->I, He->HE, etc.
}
function __nyPronIndexForQ(pKey){
  // Orden en verbs.html: I, YOU_S, HE, SHE, IT, WE, YOU_P, THEY
  const k = String(pKey||"");
  if(k==="I") return 0;
  if(k==="You") return 1;
  if(k==="He") return 2;
  if(k==="She") return 3;
  if(k==="It") return 4;
  if(k==="We") return 5;
  if(k==="YouP") return 6;
  if(k==="They") return 7;
  return 0;
}

function lookupSpanishLineFromVerbsHtml(tKind, modeKey, p, v){
  // Busca traducción exacta (ES) para la línea activa desde:
  // 1) verbs3.html (Grupo 3)
  // 2) verbs2.html (overrides)
  // 3) verbs.html  (base)
  const verbKey = __nyVerbKeyFromIndexVerb(v);
  if(!verbKey) return null;

  const findIn = (db) => {
    if(!Array.isArray(db)) return null;
    return db.find(x => String((x && (x.key || x.c1)) || "").trim().toLowerCase() === verbKey) || null;
  };

  const entry =
    (__NY_VERBS3_DB_READY__ ? findIn(__NY_VERBS3_DB__) : null) ||
    (__NY_VERBS2_DB_READY__ ? findIn(__NY_VERBS2_DB__) : null) ||
    (__NY_VERBS_DB_READY__  ? findIn(__NY_VERBS_DB__)  : null);

  if(!entry || !entry.active || !entry.active[tKind]) return null;

  const block = entry.active[tKind][modeKey];
  if(!Array.isArray(block)) return null;

  const pKey = (p && (p.key || p)) ? String(p.key || p) : "";
  const pronKey = __nyPronKeyToDb(pKey);
  const pronIndex = __nyPronIndexForQ(pKey);

  if(modeKey === "Q"){
    const row = block[pronIndex];
    if(!row) return null;
    return String(row.length === 2 ? row[1] : (row[2] || "")).trim() || null;
  }

  const row = block.find(r => r && r[0] === pronKey);
  if(!row) return null;
  return String(row[2] || "").trim() || null;
}


// Cargamos la DB lo más pronto posible (sin bloquear la app)
window.addEventListener("DOMContentLoaded", () => { loadVerbsDbFromVerbsHtml();
  loadVerbsDbFromVerbs2Html();
  loadVerbsDbFromVerbs3Html(); });



function renderGroupHint(groupId){
  const titulo = document.getElementById("pistaTitulo");
  const dias = document.getElementById("pistaDias");
  const lista = document.getElementById("pistaLista");
  const logoHTML = '<img src="assets/brain.png" alt="" class="inlineLogo">';

  const h = GROUP_HINTS[groupId] || null;

  if(!h){
    titulo.innerHTML = `${logoHTML} Pista Neuronal`;
    dias.textContent = "";
    lista.innerHTML = "";
    return;
  }

  const roundTitle = (currentRound===2)
    ? h.title.replace("Round 1","Round 2")
    : h.title;

  const roundDays = (currentRound===2)
    ? h.days.replace(/Day\s+(\d+)\s+to\s+(\d+)/i, (_,a,b)=>`Day ${Number(a)+40} to ${Number(b)+40}`)
    : h.days;

  titulo.innerHTML = `${logoHTML} ${roundTitle}`;
  dias.textContent = roundDays;
  lista.innerHTML = h.bullets.map(b=>`<li>${b}</li>`).join("");
}

/* ✅✅✅ Refuerzo: barra fija */

/* ✅✅✅ Altura segura para modales (se ajusta al alto real de la barra fija) */
function updateHudSafe(){
  const bar = document.getElementById("statsBar");
  if(!bar) return;
  const r = bar.getBoundingClientRect();
  const safe = Math.max(0, Math.ceil(r.bottom + 12)); // deja un pequeño margen debajo
  document.documentElement.style.setProperty("--hudSafe", safe + "px");
}
function pinStatsBar(){
  const bar = document.getElementById("statsBar");
  if(!bar) return;

  if(bar.parentElement !== document.body){
    document.body.prepend(bar);
  }

  bar.style.position = "fixed";
  bar.style.top = "12px";
  bar.style.left = "50%";
  bar.style.transform = "translateX(-50%)";
  bar.style.zIndex = "900";
  bar.style.width = "min(1120px, calc(100% - 40px))";
  initStatsCarousel();
  updateHudSafe();
}

/* ✅ Menú de puntajes: carrusel horizontal premium (una sola fila) */
function initStatsCarousel(){
  const bar = document.getElementById("statsBar");
  if(!bar) return;


  const prevBtn = bar.querySelector(".statsNavBtn.left");
  const nextBtn = bar.querySelector(".statsNavBtn.right");
  const scrollAmt = ()=>Math.max(240, Math.floor(bar.clientWidth * 0.60));
  if(prevBtn && !prevBtn.dataset.bound){
    prevBtn.dataset.bound = "1";
    prevBtn.addEventListener("click", ()=>{
      bar.scrollBy({ left: -scrollAmt(), behavior: "smooth" });
      setTimeout(()=>{ try{ refresh(); }catch(_){} }, 90);
    });
  }
  if(nextBtn && !nextBtn.dataset.bound){
    nextBtn.dataset.bound = "1";
    nextBtn.addEventListener("click", ()=>{
      bar.scrollBy({ left:  scrollAmt(), behavior: "smooth" });
      setTimeout(()=>{ try{ refresh(); }catch(_){} }, 90);
    });
  }

  const refresh = ()=>{
    const scrollable = (bar.scrollWidth - bar.clientWidth) > 2;
    bar.classList.toggle("isScrollable", scrollable);
    if(!scrollable){
      bar.classList.remove("atStart","atEnd");
      return;
    }
    bar.classList.toggle("atStart", bar.scrollLeft <= 1);
    bar.classList.toggle("atEnd", bar.scrollLeft >= (bar.scrollWidth - bar.clientWidth - 1));

    if(prevBtn) prevBtn.disabled = (!scrollable || bar.scrollLeft <= 1);
    if(nextBtn) nextBtn.disabled = (!scrollable || bar.scrollLeft >= (bar.scrollWidth - bar.clientWidth - 1));
  };

  const onWheel = (e)=>{
    if(!bar.classList.contains("isScrollable")) return;
    if(Math.abs(e.deltaY) > Math.abs(e.deltaX)){
      bar.scrollLeft += e.deltaY;
      e.preventDefault();
      refresh();
    }
  };

  let dragging=false, startX=0, startLeft=0;
  const onDown=(e)=>{
    if(e.pointerType==="mouse" && e.button!==0) return;
    if(!bar.classList.contains("isScrollable")) return;
    dragging=true;
    startX=e.clientX;
    startLeft=bar.scrollLeft;
    bar.classList.add("isDragging");
    try{ bar.setPointerCapture(e.pointerId); }catch(_){}
  };
  const onMove=(e)=>{
    if(!dragging) return;
    const dx=e.clientX-startX;
    bar.scrollLeft=startLeft - dx;
    refresh();
  };
  const onUp=()=>{
    dragging=false;
    bar.classList.remove("isDragging");
    refresh();
  };

  bar.addEventListener("scroll", ()=>requestAnimationFrame(refresh), {passive:true});
  bar.addEventListener("wheel", onWheel, {passive:false});
  bar.addEventListener("pointerdown", onDown, {passive:true});
  bar.addEventListener("pointermove", onMove, {passive:true});
  bar.addEventListener("pointerup", onUp, {passive:true});
  bar.addEventListener("pointercancel", onUp, {passive:true});

  refresh();
  setTimeout(refresh, 50);
  try{ updateHudSafe(); }catch(_){}
  setTimeout(()=>{ try{ updateHudSafe(); }catch(_){} }, 120);
  window.addEventListener("resize", ()=>{ requestAnimationFrame(refresh); try{ updateHudSafe(); }catch(_){} }, {passive:true});
}


/* ===========================
   ✅ SONIDOS
   =========================== */
let __audioCtx = null;

function getAudioCtx(){
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if(!Ctx) return null;
  if(!__audioCtx) __audioCtx = new Ctx();
  if(__audioCtx.state === "suspended"){
    __audioCtx.resume().catch(()=>{});
  }
  return __audioCtx;
}

function playTone(freq, ms, type="sine", vol=0.10, when=0){
  const ctx = getAudioCtx();
  if(!ctx) return;

  const now = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(vol, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + ms/1000);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + ms/1000 + 0.02);
}

function playCorrectSound(){
  playTone(660, 90, "triangle", 0.11, 0.00);
  playTone(880, 120, "triangle", 0.12, 0.09);
}

function playWrongSound(){
  playTone(220, 120, "sawtooth", 0.06, 0.00);
  playTone(160, 180, "sawtooth", 0.06, 0.10);
}

/* ===========================
   ✅ DATA (igual, Round 1)
   =========================== */
let verbosDB = [
  {g:1, d:1, esp:"Cortar", c1:"cut", c2:"cut", c3:"cut"},
  {g:1, d:1, esp:"Poner", c1:"put", c2:"put", c3:"put"},
  {g:1, d:2, esp:"Golpear", c1:"beat", c2:"beat", c3:"beat", alt3:["beaten"], ex:"El participio también puede ser 'beaten'."},
  {g:1, d:2, esp:"Sudar", c1:"sweat", c2:"sweat", c3:"sweat"},
  {g:1, d:3, esp:"Sentarse", c1:"sit", c2:"sat", c3:"sat", ex:"*Excepción: no cumple C1=C2=C3 (sit–sat–sat)."},
  {g:1, d:3, esp:"Comer", c1:"eat", c2:"ate", c3:"eaten", ex:"*Excepción: no cumple C1=C2=C3 (eat–ate–eaten)."},
  {g:1, d:4, esp:"Apostar", c1:"bet", c2:"bet", c3:"bet"},
  {g:1, d:4, esp:"Dejar", c1:"let", c2:"let", c3:"let"},
  {g:1, d:4, esp:"Fijar", c1:"set", c2:"set", c3:"set"},
  {g:1, d:4, esp:"Mojar", c1:"wet", c2:"wet", c3:"wet"},
  {g:1, d:5, esp:"Herir", c1:"hurt", c2:"hurt", c3:"hurt"},
  {g:1, d:5, esp:"Cerrar", c1:"shut", c2:"shut", c3:"shut"},
  {g:1, d:5, esp:"Reventar", c1:"burst", c2:"burst", c3:"burst"},
  {g:1, d:5, esp:"Empujar", c1:"thrust", c2:"thrust", c3:"thrust"},
  {g:1, d:6, esp:"Costar", c1:"cost", c2:"cost", c3:"cost"},
  {g:1, d:6, esp:"Arrojar", c1:"cast", c2:"cast", c3:"cast"},
  {g:1, d:6, esp:"Transmitir", c1:"broadcast", c2:"broadcast", c3:"broadcast"},
  {g:1, d:6, esp:"Predecir", c1:"forecast", c2:"forecast", c3:"forecast"},
  {g:1, d:7, esp:"Caber", c1:"fit", c2:"fit", c3:"fit"},
  {g:1, d:7, esp:"Golpear", c1:"hit", c2:"hit", c3:"hit"},
  {g:1, d:7, esp:"Rajar", c1:"slit", c2:"slit", c3:"slit"},
  {g:1, d:7, esp:"Escupir", c1:"spit", c2:"spit", c3:"spit", alt2:["spat"], alt3:["spat"], ex:"También se acepta 'spat' en pasado y participio (spit–spat–spat)."},
  {g:1, d:7, esp:"Dividir", c1:"split", c2:"split", c3:"split"},
  {g:1, d:7, esp:"Abandonar", c1:"quit", c2:"quit", c3:"quit"},
  {g:1, d:7, esp:"Tejer", c1:"knit", c2:"knit", c3:"knit"},
  {g:1, d:8, esp:"Pujar", c1:"bid", c2:"bid", c3:"bid"},
  {g:1, d:8, esp:"Librar", c1:"rid", c2:"rid", c3:"rid"},
  {g:1, d:8, esp:"Leer", c1:"read", c2:"read", c3:"read", ex:"Pronunciación: en presente suena /riːd/ (reed) y en pasado /rɛd/ (red)."},
  {g:1, d:8, esp:"Extender", c1:"spread", c2:"spread", c3:"spread"},
  {g:1, d:8, esp:"Guiar", c1:"lead", c2:"led", c3:"led", ex:"*Excepción: no cumple C1=C2=C3 (lead–led–led)."},

  {g:2, d:9, esp:"Pararse", c1:"stand", c2:"stood", c3:"stood"},
  {g:2, d:9, esp:"Entender", c1:"understand", c2:"understood", c3:"understood"},
  {g:2, d:9, esp:"Sobresalir", c1:"overstand", c2:"overstood", c3:"overstood"},
  {g:2, d:9, esp:"Resistir", c1:"withstand", c2:"withstood", c3:"withstood"},

  {g:2, d:10, esp:"Doblar", c1:"bend", c2:"bent", c3:"bent"},
  {g:2, d:10, esp:"Mezclar", c1:"blend", c2:"blent", c3:"blent", ex:"También se acepta 'blended' en pasado/participio (blend–blended–blended) en algunos contextos.", alt2:["blended"], alt3:["blended"]},
  {g:2, d:10, esp:"Prestar", c1:"lend", c2:"lent", c3:"lent"},
  {g:2, d:10, esp:"Enviar", c1:"send", c2:"sent", c3:"sent"},
  {g:2, d:10, esp:"Gastar", c1:"spend", c2:"spent", c3:"spent"},

  {g:2, d:11, esp:"Atar", c1:"bind", c2:"bound", c3:"bound"},
  {g:2, d:11, esp:"Desatar", c1:"unbind", c2:"unbound", c3:"unbound"},
  {g:2, d:11, esp:"Encontrar", c1:"find", c2:"found", c3:"found"},
  {g:2, d:11, esp:"Moler", c1:"grind", c2:"ground", c3:"ground"},
  {g:2, d:11, esp:"Enrollar", c1:"wind", c2:"wound", c3:"wound"},
  {g:2, d:11, esp:"Desenrollar", c1:"unwind", c2:"unwound", c3:"unwound"},

  {g:2, d:12, esp:"Aferrarse", c1:"cling", c2:"clung", c3:"clung"},
  {g:2, d:12, esp:"Picar", c1:"sting", c2:"stung", c3:"stung"},
  {g:2, d:12, esp:"Columpiarse", c1:"swing", c2:"swung", c3:"swung"},
  {g:2, d:12, esp:"Exprimir", c1:"wring", c2:"wrung", c3:"wrung"},
  {g:2, d:12, esp:"Colgar", c1:"hang", c2:"hung", c3:"hung"},

  {g:2, d:13, esp:"Sostener", c1:"hold", c2:"held", c3:"held"},
  {g:2, d:13, esp:"Contemplar", c1:"behold", c2:"beheld", c3:"beheld"},
  {g:2, d:13, esp:"Defender", c1:"uphold", c2:"upheld", c3:"upheld"},
  {g:2, d:13, esp:"Retener", c1:"withhold", c2:"withheld", c3:"withheld"},

  {g:2, d:14, esp:"Vender", c1:"sell", c2:"sold", c3:"sold"},
  {g:2, d:14, esp:"Decir", c1:"tell", c2:"told", c3:"told"},
  {g:2, d:14, esp:"Deletrear", c1:"spell", c2:"spelt", c3:"spelt", ex:"En inglés americano es común 'spelled' como pasado/participio (spell–spelled–spelled).", alt2:["spelled"], alt3:["spelled"]},
  {g:2, d:14, esp:"Oler", c1:"smell", c2:"smelt", c3:"smelt", ex:"En inglés americano es común 'smelled' como pasado/participio (smell–smelled–smelled).", alt2:["smelled"], alt3:["smelled"]},

  {g:2, d:15, esp:"Oír", c1:"hear", c2:"heard", c3:"heard"},
  {g:2, d:15, esp:"Guiar", c1:"lead", c2:"led", c3:"led"},

  {g:2, d:16, esp:"Decir", c1:"say", c2:"said", c3:"said"},
  {g:2, d:16, esp:"Pagar", c1:"pay", c2:"paid", c3:"paid"},
  {g:2, d:16, esp:"Apoyar", c1:"lay", c2:"laid", c3:"laid"},
  {g:2, d:16, esp:"Embutir", c1:"inlay", c2:"inlaid", c3:"inlaid"},
  {g:2, d:16, esp:"Quedarse", c1:"stay", c2:"stayed", c3:"stayed"},
  {g:2, d:16, esp:"Jugar", c1:"play", c2:"played", c3:"played"},

  {g:2, d:17, esp:"Apoyarse", c1:"lean", c2:"leant", c3:"leant", ex:"En inglés americano es común 'leaned' como pasado/participio (lean–leaned–leaned).", alt2:["leaned"], alt3:["leaned"]},
  {g:2, d:17, esp:"Aprender", c1:"learn", c2:"learnt", c3:"learnt", ex:"En inglés americano es común 'learned' como pasado/participio (learn–learned–learned).", alt2:["learned"], alt3:["learned"]},
  {g:2, d:17, esp:"Significar", c1:"mean", c2:"meant", c3:"meant"},
  {g:2, d:17, esp:"Soñar", c1:"dream", c2:"dreamt", c3:"dreamt", ex:"En inglés americano es común 'dreamed' como pasado/participio (dream–dreamed–dreamed).", alt2:["dreamed"], alt3:["dreamed"]},
  {g:2, d:17, esp:"Brincar", c1:"leap", c2:"leapt", c3:"leapt", ex:"En inglés americano también se usa 'leaped' (leap–leaped–leaped).", alt2:["leaped"], alt3:["leaped"]},
  {g:2, d:17, esp:"Negociar", c1:"deal", c2:"dealt", c3:"dealt"},

  {g:2, d:18, esp:"Sangrar", c1:"bleed", c2:"bled", c3:"bled"},
  {g:2, d:18, esp:"Criar", c1:"breed", c2:"bred", c3:"bred"},
  {g:2, d:18, esp:"Alimentar", c1:"feed", c2:"fed", c3:"fed"},
  {g:2, d:18, esp:"Acelerar", c1:"speed", c2:"sped", c3:"sped", ex:"En inglés americano también se usa 'speeded' (speed–speeded–speeded).", alt2:["speeded"], alt3:["speeded"]},
  {g:2, d:18, esp:"Huir", c1:"flee", c2:"fled", c3:"fled"},

  {g:2, d:19, esp:"Arrastrarse", c1:"creep", c2:"crept", c3:"crept"},
  {g:2, d:19, esp:"Guardar", c1:"keep", c2:"kept", c3:"kept"},
  {g:2, d:19, esp:"Dormir", c1:"sleep", c2:"slept", c3:"slept"},
  {g:2, d:19, esp:"Barrer", c1:"sweep", c2:"swept", c3:"swept"},
  {g:2, d:19, esp:"Llorar", c1:"weep", c2:"wept", c3:"wept"},

  {g:2, d:20, esp:"Sentir", c1:"feel", c2:"felt", c3:"felt"},
  {g:2, d:20, esp:"Arrodillarse", c1:"kneel", c2:"knelt", c3:"knelt", ex:"También se usa 'kneeled' (kneel–kneeled–kneeled).", alt2:["kneeled"], alt3:["kneeled"]},
  {g:2, d:20, esp:"Encontrar", c1:"meet", c2:"met", c3:"met"},

  {g:2, d:21, esp:"Cavar", c1:"dig", c2:"dug", c3:"dug"},
  {g:2, d:21, esp:"Escabullirse", c1:"slink", c2:"slunk", c3:"slunk"},
  {g:2, d:21, esp:"Pegar", c1:"stick", c2:"stuck", c3:"stuck"},
  {g:2, d:21, esp:"Atacar", c1:"strike", c2:"struck", c3:"struck"},
  {g:2, d:21, esp:"Girar", c1:"spin", c2:"spun", c3:"spun"},
  {g:2, d:21, esp:"Ganar", c1:"win", c2:"won", c3:"won"},
  {g:2, d:21, esp:"Brillar", c1:"shine", c2:"shone", c3:"shone", ex:"En inglés americano también se usa 'shined'.", alt2:["shined"], alt3:["shined"]},

  {g:2, d:22, esp:"Enseñar", c1:"teach", c2:"taught", c3:"taught"},
  {g:2, d:22, esp:"Coger", c1:"catch", c2:"caught", c3:"caught"},

  {g:2, d:23, esp:"Comprar", c1:"buy", c2:"bought", c3:"bought"},
  {g:2, d:23, esp:"Traer", c1:"bring", c2:"brought", c3:"brought"},
  {g:2, d:23, esp:"Pensar", c1:"think", c2:"thought", c3:"thought"},
  {g:2, d:23, esp:"Luchar", c1:"fight", c2:"fought", c3:"fought"},
  {g:2, d:23, esp:"Buscar", c1:"seek", c2:"sought", c3:"sought"},

  {g:2, d:24, esp:"Perder", c1:"lose", c2:"lost", c3:"lost"},
  {g:2, d:24, esp:"Disparar", c1:"shoot", c2:"shot", c3:"shot"},

  {g:2, d:25, esp:"Despertarse", c1:"awake", c2:"awoke", c3:"awoken"},
  {g:2, d:25, esp:"Construir", c1:"build", c2:"built", c3:"built"},
  {g:2, d:25, esp:"Quemar", c1:"burn", c2:"burnt", c3:"burnt", ex:"En inglés americano es común 'burned'.", alt2:["burned"], alt3:["burned"]},
  {g:2, d:25, esp:"Salir", c1:"leave", c2:"left", c3:"left"},
  {g:2, d:25, esp:"Encender", c1:"light", c2:"lit", c3:"lit", ex:"También se usa 'lighted'.", alt2:["lighted"], alt3:["lighted"]},
  {g:2, d:25, esp:"Hacer", c1:"make", c2:"made", c3:"made"},
  {g:2, d:25, esp:"Resbalar", c1:"slide", c2:"slid", c3:"slid"},
  {g:2, d:25, esp:"Derramar", c1:"spill", c2:"spilt", c3:"spilt", ex:"En inglés americano es común 'spilled'.", alt2:["spilled"], alt3:["spilled"]},
  {g:2, d:25, esp:"Estropear", c1:"spoil", c2:"spoilt", c3:"spoilt", ex:"En inglés americano es común 'spoiled'.", alt2:["spoiled"], alt3:["spoiled"]},
  {g:2, d:25, esp:"Coser", c1:"sew", c2:"sewed", c3:"sewed", ex:"El participio también puede ser 'sewn'.", alt3:["sewn"]},
  {g:2, d:25, esp:"Sembrar", c1:"sow", c2:"sowed", c3:"sowed", ex:"El participio también puede ser 'sown'.", alt3:["sown"]},
  {g:2, d:25, esp:"Mostrar", c1:"show", c2:"showed", c3:"shown"},
  {g:2, d:25, esp:"Tener", c1:"have", c2:"had", c3:"had"},

  {g:3, d:26, esp:"Obtener", c1:"get", c2:"got", c3:"gotten", ex:"En inglés británico es común 'got' como participio.", alt3:["got"]},
  {g:3, d:26, esp:"Olvidar", c1:"forget", c2:"forgot", c3:"forgotten"},
  {g:3, d:27, esp:"Dar", c1:"give", c2:"gave", c3:"given"},
  {g:3, d:27, esp:"Perdonar", c1:"forgive", c2:"forgave", c3:"forgiven"},
  {g:3, d:27, esp:"Prohibir", c1:"forbid", c2:"forbade", c3:"forbidden"},
  {g:3, d:28, esp:"Ver", c1:"see", c2:"saw", c3:"seen"},
  {g:3, d:28, esp:"Prever", c1:"foresee", c2:"foresaw", c3:"foreseen"},
  {g:3, d:28, esp:"Supervisar", c1:"oversee", c2:"oversaw", c3:"overseen"},
  {g:3, d:29, esp:"Venir", c1:"come", c2:"came", c3:"come"},
  {g:3, d:29, esp:"Llegar a ser", c1:"become", c2:"became", c3:"become"},
  {g:3, d:29, esp:"Superar", c1:"overcome", c2:"overcame", c3:"overcome"},
  {g:3, d:30, esp:"Tomar", c1:"take", c2:"took", c3:"taken"},
  {g:3, d:30, esp:"Equivocar", c1:"mistake", c2:"mistook", c3:"mistaken"},
  {g:3, d:30, esp:"Emprender", c1:"undertake", c2:"undertook", c3:"undertaken"},
  {g:3, d:30, esp:"Participar", c1:"partake", c2:"partook", c3:"partaken"},
  {g:3, d:30, esp:"Sacudir", c1:"shake", c2:"shook", c3:"shaken"},
  {g:3, d:31, esp:"Sonar", c1:"ring", c2:"rang", c3:"rung"},
  {g:3, d:31, esp:"Cantar", c1:"sing", c2:"sang", c3:"sung"},
  {g:3, d:31, esp:"Saltar", c1:"spring", c2:"sprang", c3:"sprung"},
  {g:3, d:31, esp:"Empezar", c1:"begin", c2:"began", c3:"begun"},
  {g:3, d:32, esp:"Correr", c1:"run", c2:"ran", c3:"run"},
  {g:3, d:32, esp:"Nadar", c1:"swim", c2:"swam", c3:"swum"},
  {g:3, d:33, esp:"Beber", c1:"drink", c2:"drank", c3:"drunk"},
  {g:3, d:33, esp:"Hundir", c1:"sink", c2:"sank", c3:"sunk"},
  {g:3, d:33, esp:"Apestar", c1:"stink", c2:"stank", c3:"stunk", ex:"También existe 'stank/stunk' en algunos listados.", alt2:["stunk"]},
  {g:3, d:33, esp:"Encoger", c1:"shrink", c2:"shrank", c3:"shrunk"},
  {g:3, d:34, esp:"Usar/Llevar puesto", c1:"wear", c2:"wore", c3:"worn"},
  {g:3, d:34, esp:"Jurar", c1:"swear", c2:"swore", c3:"sworn"},
  {g:3, d:34, esp:"Soportar / Dar a luz", c1:"bear", c2:"bore", c3:"born", ex:"Para 'dar a luz' se usa 'born'. En otros sentidos puede ser 'borne'.", alt3:["borne"]},
  {g:3, d:34, esp:"Rasgar", c1:"tear", c2:"tore", c3:"torn"},
  {g:3, d:35, esp:"Romper", c1:"break", c2:"broke", c3:"broken"},
  {g:3, d:35, esp:"Hablar", c1:"speak", c2:"spoke", c3:"spoken"},
  {g:3, d:35, esp:"Robar", c1:"steal", c2:"stole", c3:"stolen"},
  {g:3, d:35, esp:"Despertarse", c1:"wake", c2:"woke", c3:"woken"},
  {g:3, d:35, esp:"Elegir", c1:"choose", c2:"chose", c3:"chosen"},
  {g:3, d:35, esp:"Congelar", c1:"freeze", c2:"froze", c3:"frozen"},
  {g:3, d:36, esp:"Saber/Conocer", c1:"know", c2:"knew", c3:"known"},
  {g:3, d:36, esp:"Soplar", c1:"blow", c2:"blew", c3:"blown"},
  {g:3, d:36, esp:"Crecer", c1:"grow", c2:"grew", c3:"grown"},
  {g:3, d:36, esp:"Arrojar", c1:"throw", c2:"threw", c3:"thrown"},
  {g:3, d:36, esp:"Volar", c1:"fly", c2:"flew", c3:"flown"},
  {g:3, d:37, esp:"Conducir", c1:"drive", c2:"drove", c3:"driven"},
  {g:3, d:37, esp:"Levantarse", c1:"rise", c2:"rose", c3:"risen"},
  {g:3, d:37, esp:"Surgir/Levantarse", c1:"arise", c2:"arose", c3:"arisen"},
  {g:3, d:37, esp:"Esforzarse", c1:"strive", c2:"strove", c3:"striven"},
  {g:3, d:38, esp:"Escribir", c1:"write", c2:"wrote", c3:"written"},
  {g:3, d:38, esp:"Golpear", c1:"smite", c2:"smote", c3:"smitten"},
  {g:3, d:38, esp:"Morder", c1:"bite", c2:"bit", c3:"bitten"},
  {g:3, d:38, esp:"Montar/Cabalgar", c1:"ride", c2:"rode", c3:"ridden"},
  {g:3, d:38, esp:"Zancadas", c1:"stride", c2:"strode", c3:"stridden"},
  {g:3, d:38, esp:"Deslizarse", c1:"slide", c2:"slid", c3:"slidden"},
  {g:3, d:38, esp:"Ocultar", c1:"hide", c2:"hid", c3:"hidden"},
  {g:3, d:39, esp:"Dibujar", c1:"draw", c2:"drew", c3:"drawn"},
  {g:3, d:39, esp:"Sobregirar", c1:"overdraw", c2:"overdrew", c3:"overdrawn"},
  {g:3, d:39, esp:"Retirar", c1:"withdraw", c2:"withdrew", c3:"withdrawn"},
  {g:3, d:40, esp:"Mentir", c1:"lie", c2:"lay", c3:"lain"},
  {g:3, d:40, esp:"Caer", c1:"fall", c2:"fell", c3:"fallen"},
  {g:3, d:40, esp:"Cortar/Trasquilar", c1:"shear", c2:"shore", c3:"shorn"},
  {g:3, d:40, esp:"Hinchar", c1:"swell", c2:"swelled", c3:"swollen"},
  {g:3, d:40, esp:"Pisar/Hollar", c1:"tread", c2:"trod", c3:"trodden"},
  {g:3, d:40, esp:"Tejer", c1:"weave", c2:"wove", c3:"woven"},
  {g:3, d:40, esp:"Ir", c1:"go", c2:"went", c3:"gone"},
  {g:3, d:40, esp:"Sufrir/Someterse", c1:"undergo", c2:"underwent", c3:"undergone"},
  {g:3, d:40, esp:"Hacer", c1:"do", c2:"did", c3:"done"},
  {g:3, d:40, esp:"Deshacer", c1:"undo", c2:"undid", c3:"undone"},
  {g:3, d:40, esp:"Exagerar", c1:"overdo", c2:"overdid", c3:"overdone"},
  {g:3, d:40, esp:"Ser/Estar", c1:"be", c2:"was", c3:"been"}
];

let verbosDB_R1 = verbosDB;
let verbosDB_R2 = verbosDB.map(v => ({...v, d: v.d + 40}));

/* ✅ Complementos (Round 2). En pasiva se usan como SUJETO (objeto del activo). */
const COMPLEMENTS = {
  "beat": { en: "the drum", es: "el tambor" },
  "behold": { en: "the sunrise", es: "el amanecer" },
  "bend": { en: "the wire", es: "el alambre" },
  "bet": { en: "the money", es: "el dinero" },
  "bid": { en: "the item", es: "el artículo" },
  "bind": { en: "the book", es: "el libro" },
  "blend": { en: "the smoothie", es: "el batido" },
  "breed": { en: "the horse", es: "el caballo" },
  "broadcast": { en: "the announcement", es: "el anuncio" },
  "burst": { en: "the balloon", es: "el globo" },
  "cast": { en: "the spell", es: "el hechizo" },
  "choose": { en: "the winner", es: "el ganador" },
  "cling": { en: "the rope", es: "la cuerda" },
  "cost": { en: "the ticket", es: "el tiquete" },
  "cut": { en: "the paper", es: "el papel" },
  "eat": { en: "the cake", es: "el pastel" },
  "feed": { en: "the baby", es: "el bebé" },
  "find": { en: "the treasure", es: "el tesoro" },
  "fit": { en: "the suit", es: "el traje" },
  "flee": { en: "the danger", es: "el peligro" },
  "forecast": { en: "the weather", es: "el clima" },
  "foresee": { en: "the problem", es: "el problema" },
  "get": { en: "the package", es: "el paquete" },
  "grind": { en: "the coffee", es: "el café" },
  "grow": { en: "the crop", es: "el cultivo" },
  "hang": { en: "the picture", es: "el cuadro" },
  "have": { en: "a good time", es: "un buen rato" },
  "hear": { en: "the sound", es: "el sonido" },
  "hit": { en: "the target", es: "el blanco" },
  "hold": { en: "the line", es: "la línea" },
  "hurt": { en: "the body", es: "el cuerpo" },
  "inlay": { en: "the gem", es: "la gema" },
  "knit": { en: "the sweater", es: "el suéter" },
  "know": { en: "the secret", es: "el secreto" },
  "lay": { en: "the egg", es: "el huevo" },
  "lead": { en: "the team", es: "el equipo" },
  "lean": { en: "the ladder", es: "la escalera" },
  "learn": { en: "the topic", es: "el tema" },
  "leave": { en: "the building", es: "el edificio" },
  "lend": { en: "the money", es: "el dinero" },
  "let": { en: "the student", es: "el estudiante" },
  "light": { en: "the fire", es: "el fuego" },
  "mistake": { en: "the name", es: "el nombre" },
  "overstand": { en: "the message", es: "el mensaje" },
  "pay": { en: "the bill", es: "la cuenta" },
  "play": { en: "the game", es: "el juego" },
  "put": { en: "the book", es: "el libro" },
  "quit": { en: "the habit", es: "el hábito" },
  "read": { en: "the book", es: "el libro" },
  "rid": { en: "the problem", es: "el problema" },
  "say": { en: "the sentence", es: "la oración" },
  "sell": { en: "the product", es: "el producto" },
  "send": { en: "the email", es: "el correo" },
  "set": { en: "the timer", es: "el temporizador" },
  "shrink": { en: "the fabric", es: "la tela" },
  "shut": { en: "the door", es: "la puerta" },
  "sink": { en: "the ship", es: "el barco" },
  "sit": { en: "the seat", es: "el asiento" },
  "slit": { en: "the envelope", es: "el sobre" },
  "smell": { en: "the perfume", es: "el perfume" },
  "sow": { en: "the seed", es: "la semilla" },
  "speed": { en: "the car", es: "el carro" },
  "spell": { en: "the word", es: "la palabra" },
  "spend": { en: "the money", es: "el dinero" },
  "spit": { en: "the gum", es: "el chicle" },
  "split": { en: "the log", es: "el tronco" },
  "spread": { en: "the rumor", es: "el rumor" },
  "stand": { en: "the pressure", es: "la presión" },
  "stay": { en: "the night", es: "la noche" },
  "sting": { en: "the arm", es: "el brazo" },
  "stride": { en: "the corridor", es: "el pasillo" },
  "strike": { en: "the deal", es: "el acuerdo" },
  "sweat": { en: "a lot of sweat", es: "mucho sudor" },
  "swell": { en: "the ankle", es: "el tobillo" },
  "swing": { en: "the bat", es: "el bate" },
  "tell": { en: "the joke", es: "el chiste" },
  "thrust": { en: "the knife", es: "el cuchillo" },
  "unbind": { en: "the knot", es: "el nudo" },
  "understand": { en: "the concept", es: "el concepto" },
  "undertake": { en: "the project", es: "el proyecto" },
  "undo": { en: "the change", es: "el cambio" },
  "unwind": { en: "the cable", es: "el cable" },
  "uphold": { en: "the agreement", es: "el acuerdo" },
  "wet": { en: "the floor", es: "el piso" },
  "wind": { en: "the watch", es: "el reloj" },
  "withhold": { en: "the payment", es: "el pago" },
  "withstand": { en: "the heat", es: "el calor" },
  "wring": { en: "the cloth", es: "el paño" },
};
function getComplement(v){
  const key = String(v.c1||"").toLowerCase().trim();
  return COMPLEMENTS[key] || {en:"the task", es:"la tarea"};
}

/* Pronombres (agente en pasiva) */
const PRON = [
  {key:"I",    en:"I",    es:"Yo"},
  {key:"You",  en:"You",  es:"Tú"},
  {key:"He",   en:"He",   es:"Él"},
  {key:"She",  en:"She",  es:"Ella"},
  {key:"It",   en:"It",   es:"Eso"},
  {key:"We",   en:"We",   es:"Nosotros"},
  {key:"YouP", en:"You",  es:"Ustedes"},
  {key:"They", en:"They", es:"Ellos"}
];

const AGENT_OBJ = {
  I:"me", You:"you", He:"him", She:"her", It:"it", We:"us", YouP:"you", They:"them"
};

let streak=0, xp=0, att=0, corr=0;
let idx=0, current=[];
let pendingVerb = null;

let currentRound = 1;

let focusGroupAfterLoad = false; // ✅ para que al cambiar Round el foco vaya a Grupo
let activeDB = verbosDB_R1;

/* ===========================
   ✅ SCROLL CONTROLADO
   - Evita que el usuario se quede en el formulario
   - Lleva a la zona de tablas (VOZ ACTIVA / VOZ PASIVA)
   =========================== */
function scrollToConjugationTables(){
  const msg = document.getElementById('msg');
  const voiceRow = document.querySelector('.voiceRowInTables');
  const master = document.getElementById('master');
  const hud = document.querySelector('.hud');
  const hudH = hud ? Math.ceil(hud.getBoundingClientRect().height) : 0;

  const hasMsg = !!(msg && ((msg.textContent || '').trim().length > 0) && (msg.getBoundingClientRect().height > 0));
  const target = hasMsg ? msg : (voiceRow || master);
  if(!target) return;

  // Queremos que se vea también la fila VOZ ACTIVA / VOZ PASIVA.
  // Si hay mensaje (#msg) lo anclamos arriba; si no, anclamos a la fila de VOZ y subimos más.
  const topGap = (window.innerWidth <= 640) ? 18 : 14; // respiración bajo el HUD
  const pad = hudH + (hasMsg ? topGap : ((window.innerWidth <= 640) ? 170 : 140));

  const y = target.getBoundingClientRect().top + window.pageYOffset - pad;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

// ✅ Evitar que la página haga scroll automático hacia el formulario al recargar.
// Solo hacemos focus/scroll cuando el usuario ya interactuó (click/touch/teclado).
let __userInteracted = false;
try{
  window.addEventListener('pointerdown', ()=>{ __userInteracted = true; }, { once:true, passive:true });
  window.addEventListener('keydown', ()=>{ __userInteracted = true; }, { once:true });
}catch(_){
  // ignore
}

/* ✅ NUEVO: MODO DE VOZ */
let voiceMode = "active"; // "active" | "passive"

const PRACTICE_XP = 10;
let practiceAwarded = new Set();
let connectAwarded = new Set(); // evita farmear XP repitiendo VALIDAR (deletreo)
let spellAwarded = new Set(); // evita farmear XP repitiendo VALIDAR DELETREO (Spelling Yoguis Bee)
let spellingState = null;
let lastSpellPickKey = null; // para evitar repetir el mismo verbo en Spelling Yoguis Bee

let practiceState = null;

/* ===========================
   🎮 GAMIFICACIÓN PRO (sin servidor)
   - Persistencia con localStorage
   - Nivel + Meta diaria + Vidas + Streak Freeze
   - Logros + Dominio por verbo + Review de errores
   =========================== */
const GAME_KEY = "yoguis_neuro_gamification_v1";
const MAX_HEARTS = 5;
const HEART_REGEN_MIN = 10; // 1 corazón cada 10 min
const DAILY_GOAL_DEFAULT = 200;

let hearts = MAX_HEARTS;
let freezeTokens = 0;
let dailyGoal = DAILY_GOAL_DEFAULT;
let dailyXP = 0;
let lastDailyKey = "";
let mastery = {};          // { c1: 0..5 }
let unlocked = {};         // { achievementId: true }
let mistakes = [];         // [{c1,g,d,round,voice,t,misses}...]

function safeLSGet(key){
  try{ return localStorage.getItem(key); }catch(e){ return null; }
}
function safeLSSet(key, val){
  try{ localStorage.setItem(key, val); }catch(e){}
}
function todayKey(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function computeLevel(totalXP){
  // Nivel sencillo y estable: 250 XP por nivel
  const xpPerLevel = 250;
  const lvl = Math.floor((totalXP||0)/xpPerLevel) + 1;
  const into = (totalXP||0) % xpPerLevel;
  const pct = Math.round((into/xpPerLevel)*100);
  return {lvl, into, xpPerLevel, pct};
}
function heartsString(){
  const full = "❤️".repeat(Math.max(0, hearts));
  const empty = "🤍".repeat(Math.max(0, MAX_HEARTS - hearts));
  return (full + empty) || "🤍🤍🤍🤍🤍";
}
function regenHearts(){
  // Regeneración por tiempo, sin servidor (mejor esfuerzo)
  const raw = safeLSGet(GAME_KEY);
  let last = 0;
  if(raw){
    try{
      const st = JSON.parse(raw);
      last = Number(st.lastHeartTs||0);
    }catch(e){}
  }
  const now = Date.now();
  if(!last) last = now;
  const diffMin = (now - last) / 60000;
  if(diffMin >= HEART_REGEN_MIN && hearts < MAX_HEARTS){
    const add = Math.min(MAX_HEARTS - hearts, Math.floor(diffMin/HEART_REGEN_MIN));
    hearts += add;
    const newLast = last + add * HEART_REGEN_MIN * 60000;
    persistState({lastHeartTs:newLast});
  }
}
function persistState(extra={}){
  const state = {
    streak, xp, att, corr,
    hearts, freezeTokens, dailyGoal, dailyXP,
    lastDailyKey,
    mastery, unlocked, mistakes,
    connectAwarded: Array.from(connectAwarded).slice(-2000),
    spellAwarded: Array.from(spellAwarded).slice(-2000),
    lastHeartTs: extra.lastHeartTs ?? undefined
  };

  // Mantener lastHeartTs previo si no viene
  const raw = safeLSGet(GAME_KEY);
  if(raw){
    try{
      const prev = JSON.parse(raw);
      if(state.lastHeartTs === undefined && prev.lastHeartTs) state.lastHeartTs = prev.lastHeartTs;
    }catch(e){}
  }
  if(state.lastHeartTs === undefined) state.lastHeartTs = Date.now();

  safeLSSet(GAME_KEY, JSON.stringify(state));
}
function loadState(){
  const raw = safeLSGet(GAME_KEY);
  lastDailyKey = todayKey();

  if(raw){
    try{
      const st = JSON.parse(raw);
      streak = Number(st.streak||0);
      xp = Number(st.xp||0);
      att = Number(st.att||0);
      corr = Number(st.corr||0);

      hearts = Number(st.hearts ?? MAX_HEARTS);
      freezeTokens = Number(st.freezeTokens||0);
      dailyGoal = Number(st.dailyGoal||DAILY_GOAL_DEFAULT);
      dailyXP = Number(st.dailyXP||0);

      mastery = st.mastery || {};
      unlocked = st.unlocked || {};
      mistakes = Array.isArray(st.mistakes) ? st.mistakes : [];
      connectAwarded = new Set(Array.isArray(st.connectAwarded) ? st.connectAwarded : []);
      spellAwarded = new Set(Array.isArray(st.spellAwarded) ? st.spellAwarded : []);

      // reset meta diaria si cambió el día
      const savedDay = st.lastDailyKey || todayKey();
      if(savedDay !== todayKey()){
        dailyXP = 0;
        lastDailyKey = todayKey();
      }else{
        lastDailyKey = savedDay;
      }
    }catch(e){
      // defaults
    }
  }


  // ✅ XP externo pendiente (ej. Conocimientos previos)
  // Si se sumó XP fuera de esta página, guardamos el delta para sincronizarlo a Sheets
  // cuando haya sesión (idToken). Para que actualizarStats() lo envíe como delta,
  // ajustamos __lastXpSynced por detrás del XP actual.
  try{
    const __pendingKey = "yoguis_xp_pending_delta_v1";
    const __p = Number(safeLSGet(__pendingKey) || 0);
    if(__p > 0 && window.__lastXpSynced === null){
      window.__lastXpSynced = Math.max(0, xp - __p);
    }
  }catch(_){}

  regenHearts();
  actualizarStats();
  updateGamificationUI();
}
function updateMasteryUI(v){
  const el = document.getElementById("masteryStars");
  if(!el) return;
  const key = String(v?.c1||"").toLowerCase().trim();
  const m = Math.max(0, Math.min(5, Number(mastery[key]||0)));
  const stars = "★".repeat(m) + "☆".repeat(5-m);
  el.textContent = stars;
}
function updateGamificationUI(){
  const lvl = computeLevel(xp);
  const lvlEl = document.getElementById("level");
  if(lvlEl) lvlEl.textContent = String(lvl.lvl);

  const hEl = document.getElementById("hearts");
  if(hEl) hEl.textContent = heartsString();

  const fEl = document.getElementById("freeze");
  if(fEl) fEl.textContent = String(freezeTokens);

  const tEl = document.getElementById("dailyGoalText");
  const fill = document.getElementById("dailyGoalFill");
  if(tEl) tEl.textContent = `${Math.min(dailyXP, dailyGoal)}/${dailyGoal}`;
  if(fill){
    const pct = Math.max(0, Math.min(100, Math.round((dailyXP/Math.max(1,dailyGoal))*100)));
    fill.style.width = pct + "%";
  }
}
function toastAchievement(icon, title, desc){
  const wrap = document.getElementById("achieveToast");
  if(!wrap) return;

  document.getElementById("achieveIcon").textContent = icon || "🏆";
  document.getElementById("achieveTitle").textContent = title || "¡Logro desbloqueado!";
  document.getElementById("achieveDesc").textContent = desc || "Sigue así.";

  wrap.style.display = "block";
  clearTimeout(window.__achieveTimer);
  window.__achieveTimer = setTimeout(()=>{ wrap.style.display="none"; }, 2400);
}
function unlock(id, icon, title, desc){
  if(unlocked[id]) return;
  unlocked[id] = true;
  toastAchievement(icon, title, desc);
  persistState();
}
function awardXP(base, reason="xp"){
  const lvlBefore = computeLevel(xp).lvl;
  const fixedTen = (Number(base) === 10);

  // Multiplicadores suaves (no rompe la economía)
  let mult = 1;
  if(!fixedTen && reason==="connect"){
    if(streak>=10) mult += 0.10;
    if(streak>=20) mult += 0.15;
    if(streak>=30) mult += 0.20;
  }
  if(!fixedTen && reason==="practice"){
    if(streak>=10) mult += 0.05;
    if(streak>=20) mult += 0.10;
  }
  let gained;
  if(Number(base) <= 0){
    gained = 0;
  } else if(fixedTen){
    gained = 10; // ✅ Solo 10 XP por verbo correcto
  } else {
    gained = Math.max(1, Math.round(Number(base) * mult));
  }
  xp += gained;
  dailyXP += gained;

  // Bonos por hitos de racha (cada 5 aciertos seguidos)
  if(!fixedTen && reason==="connect" && streak>0 && streak % 5 === 0){
    xp += 10;
    dailyXP += 10;
    toastAchievement("🔥", "Bonus de racha", `+10 XP por racha ${streak}.`);
  }

  // Recompensa: un Streak Freeze cada 15 de racha
  if(reason==="connect" && streak>0 && streak % 15 === 0){
    freezeTokens += 1;
    toastAchievement("🧊", "Streak Freeze", "Ganaste 1 congelación de racha.");
  }

  // Meta diaria
  if(dailyXP >= dailyGoal){
    unlock("daily_goal", "🎯", "Meta diaria lograda", `Completaste ${dailyGoal} XP hoy. ¡Excelente!`);
  }

  // Logros por racha
  if(streak === 1) unlock("first_win", "✨", "Primera conexión", "¡Empezaste fuerte!");
  if(streak === 5) unlock("streak_5", "🔥", "Racha 5", "Consistencia desbloqueada.");
  if(streak === 10) unlock("streak_10", "🔥", "Racha 10", "Tu cerebro ya se está cableando.");
  if(streak === 25) unlock("streak_25", "🔥", "Racha 25", "Modo Yoguis activado.");

  // Logros por nivel
  const lvlAfter = computeLevel(xp).lvl;
  if(lvlAfter > lvlBefore){
    toastAchievement("🆙", `¡Subiste a nivel ${lvlAfter}!`, "Sigue acumulando XP.");
    if(lvlAfter===5) unlock("lvl_5", "🏅", "Nivel 5", "Ya tienes base sólida.");
    if(lvlAfter===10) unlock("lvl_10", "🏆", "Nivel 10", "Esto ya es disciplina real.");
  }

  actualizarStats();
  updateGamificationUI();
  persistState();
  return gained;
}
function spendHeart(){
  regenHearts();
  if(hearts <= 0) return false;
  hearts = Math.max(0, hearts - 1);
  persistState();
  updateGamificationUI();
  return true;
}
function canPlay(){
  regenHearts();
  if(hearts > 0) return true;
  const msg = document.getElementById("msg");
  if(msg){
    msg.innerHTML = `<span style="color:var(--error)">💔 Sin vidas por ahora. Vuelven 1 cada ${HEART_REGEN_MIN} min (sin servidor). Mientras tanto, usa 🔊 para escuchar y repasar.</span>`;
  }
  updateGamificationUI();
  return false;
}
function bumpMastery(c1, inc=1){
  const key = String(c1||"").toLowerCase().trim();
  const cur = Number(mastery[key]||0);
  const nxt = Math.max(0, Math.min(5, cur + inc));
  mastery[key] = nxt;

  if(nxt === 5){
    unlock(`mastery_${key}`, "⭐", "Dominio 5/5", `Dominaste el verbo "${key.toUpperCase()}".`);
  }
  persistState();
}
function recordMistake(v){
  if(!v) return;
  const key = String(v.c1||"").toLowerCase().trim();
  const found = mistakes.find(m => m.c1===key && m.round===currentRound && m.voice===voiceMode);
  if(found){
    found.misses = (found.misses||0) + 1;
    found.t = Date.now();
    found.g = v.g; found.d = v.d;
  } else {
    mistakes.unshift({c1:key, g:v.g, d:v.d, round:currentRound, voice:voiceMode, t:Date.now(), misses:1});
  }
  mistakes = mistakes.slice(0, 30); // tope
  persistState();
}
function formatAgo(ts){
  const diff = Math.max(0, Date.now() - Number(ts||0));
  const min = Math.round(diff/60000);
  if(min < 1) return "ahora";
  if(min < 60) return `hace ${min} min`;
  const h = Math.round(min/60);
  if(h < 24) return `hace ${h} h`;
  const d = Math.round(h/24);
  return `hace ${d} d`;
}
function abrirReview(){
  const overlay = document.getElementById("reviewOverlay");
  const list = document.getElementById("reviewList");
  if(!overlay || !list) return;

  const items = mistakes.slice().sort((a,b)=>(b.t||0)-(a.t||0)).slice(0, 12);

  if(items.length===0){
    list.innerHTML = `<div class="warn" style="margin-top:10px;">✅ No hay errores guardados. ¡Vas muy bien!</div>`;
  } else {
    list.innerHTML = items.map(it=>{
      const labelVoice = (it.voice==="passive") ? "Pasiva" : "Activa";
      return `
        <div class="review-item">
          <div class="review-left">
            <div class="review-verb">${it.c1.toUpperCase()} <span style="color:#64748b;font-weight:900;">• Round ${it.round} • ${labelVoice}</span></div>
            <div class="review-meta">Fallos: <b>${it.misses||1}</b> • ${formatAgo(it.t)}</div>
          </div>
          <button class="review-btn" type="button" onclick="irAMistake('${it.c1}', ${it.g||1}, ${it.d||1}, ${it.round||1}, '${it.voice||"active"}')">IR ✅</button>
        </div>
      `;
    }).join("");
  }

  overlay.style.display="flex";
}
function cerrarReview(){
  const overlay = document.getElementById("reviewOverlay");
  if(overlay) overlay.style.display="none";
}
function limpiarReview(){
  mistakes = [];
  persistState();
  abrirReview();
}
function irAMistake(c1, g, d, round, voice){
  // Ajusta Round/Voz y selecciona grupo/día
  const target = String(c1||"").toLowerCase().trim();

  try{ setRound(round); }catch(e){}
  try{ setVoice(voice); }catch(e){}

  const selG = document.getElementById("sel-grupo");
  const selD = document.getElementById("sel-dia");

  // 1) Cargar el día solicitado
  if(selG){
    selG.value = String(g);
    actualizarDias(); // esto ya llama cargarDia()
  }
  if(selD){
    selD.value = String(d);
    cargarDia();      // vuelve a cargar el día exacto
  }

  // 2) Ir exactamente al verbo que se debe repasar (dentro del día)
  function matchVerb(v){
    const vkey = String(v?.c1||"").toLowerCase().trim();
    if(vkey && vkey === target) return true;
    // por si target coincide con alguna alternativa de C1
    if(Array.isArray(v?.alt1)){
      return v.alt1.some(a => String(a||"").toLowerCase().trim() === target);
    }
    return false;
  }

  if(target && Array.isArray(current) && current.length){
    const i = current.findIndex(matchVerb);
    if(i >= 0){
      idx = i;
      mostrar();
    } else {
      // Fallback: buscar en toda la DB activa y reposicionar si el g/d no coincidía
      const v2 = activeDB.find(matchVerb);
      if(v2){
        try{
          if(selG){ selG.value = String(v2.g); actualizarDias(); }
          if(selD){ selD.value = String(v2.d); cargarDia(); }
          const j = current.findIndex(matchVerb);
          if(j >= 0){ idx = j; mostrar(); }
        }catch(_){}
      }
    }
  }

  cerrarReview();

  // feedback
  const msg = document.getElementById("msg");
  if(msg){
    msg.innerHTML = `<span style="color:var(--success)">🧩 Review listo: vuelve a intentar <b>${String(c1||"").toUpperCase()}</b>.</span>`;
  }
}
/* ===========================
   FIN GAMIFICACIÓN PRO
   =========================== */

/* ===========================
   SPEECH
   =========================== */
function hablar(texto){
  window.speechSynthesis.cancel();
  let vozClara = String(texto)
    .replace(/\bcan't\b/gi,"can not")
    .replace(/\bwon't\b/gi,"will not")
    .replace(/\bdon't\b/gi,"do not")
    .replace(/\bdoesn't\b/gi,"does not")
    .replace(/\bdidn't\b/gi,"did not")
    .replace(/\bhaven't\b/gi,"have not")
    .replace(/\bhasn't\b/gi,"has not")
    .replace(/\bhadn't\b/gi,"had not")
    .replace(/n't\b/gi," not");

  const u = new SpeechSynthesisUtterance(vozClara);
  const voces = window.speechSynthesis.getVoices();
  const vozUS = voces.find(v=>v.lang==="en-US") || voces.find(v=>(v.lang||"").startsWith("en"));
  if(vozUS) u.voice = vozUS;
  u.lang="en-US";
  u.rate=0.85;
  u.pitch=1.0;
  window.speechSynthesis.speak(u);
}
window.speechSynthesis.onvoiceschanged = ()=>window.speechSynthesis.getVoices();

function bindListenButtons(){
  document.querySelectorAll('#tablas .btn-listen, #readingArea .btn-listen').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const say = btn.dataset.say ? decodeURIComponent(btn.dataset.say) : "";
      if(say) hablar(say);
    });
  });
}

/* ===========================
   Normalizers
   =========================== */
function normalizeAns(s){ return String(s||"").trim().toLowerCase(); }
function getOptions(primary, alts){
  const opts = [primary, ...(Array.isArray(alts)?alts:[])].map(normalizeAns).filter(Boolean);
  return [...new Set(opts)];
}
function isMatch(input, primary, alts){
  const r = normalizeAns(input);
  return getOptions(primary, alts).includes(r);
}
function normalizeSentence(s){
  return String(s||"")
    .trim()
    .toLowerCase()
    .replace(/’/g,"'")
    .replace(/\bcan't\b/g,"can not")
    .replace(/\bwon't\b/g,"will not")
    .replace(/\bdon't\b/g,"do not")
    .replace(/\bdoesn't\b/g,"does not")
    .replace(/\bdidn't\b/g,"did not")
    .replace(/\bhaven't\b/g,"have not")
    .replace(/\bhasn't\b/g,"has not")
    .replace(/\bhadn't\b/g,"had not")
    .replace(/[¿?¡!.;,:"()]/g,"")
    .replace(/'/g,"")
    .replace(/\s+/g," ")
    .trim();
}

/* ===========================
   ACTIVE VOICE (igual)
   =========================== */
function isThirdSing(p){ return (p.key==="He" || p.key==="She" || p.key==="It"); }
function subjCap(p){ return p.en; }
function subjLow(p){ return (p.en==="I") ? "I" : p.en.toLowerCase(); }

function thirdPersonS(verb){
  const v = verb.toLowerCase();
  if (v === "have") return "has";
  if (/(s|sh|ch|x|z|o)$/.test(v)) return v + "es";
  if (/[^aeiou]y$/.test(v)) return v.slice(0,-1) + "ies";
  return v + "s";
}
function isBeVerb(v){ return String(v.c1||"").toLowerCase().trim()==="be"; }

/* ===========================
   ✅ COLORES (C1/C2/C3) EN TABLAS
   =========================== */
function escapeRegExp(s){
  return String(s||"").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Split verb variants like "got / gotten" into an array of forms to highlight.
function splitVariants(vform){
  const s = String(vform || "").trim();
  if(!s) return [];
  // Normalize separators: allow '/', '|', commas
  const parts = s.split(/\s*(?:\/|\||,)\s*/).map(x => x.trim()).filter(Boolean);
  // Unique (case-insensitive) while preserving order
  const seen = new Set();
  const out = [];
  for(const part of parts){
    const key = part.toLowerCase();
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out;
}
function wrapWithExp(text, cls){
  const exp = (cls==="v-c1") ? "C1" : (cls==="v-c2") ? "C2" : (cls==="v-c3") ? "C3" : "";
  if(!exp) return `<span class="${cls}">${text}</span>`;
  return `<span class="${cls}">${text}<sup class="v-exp">${exp}</sup></span>`;
}


// ✅ En presente simple afirmativo (3ra persona), pinta SOLO la "s" final en violeta.
function wrapWithExpThirdPersonS(text, cls){
  const exp = (cls==="v-c1") ? "C1" : (cls==="v-c2") ? "C2" : (cls==="v-c3") ? "C3" : "";
  const t = String(text ?? "");
  if(!exp) return `<span class="${cls}">${t}</span>`;
  if(/s$/i.test(t) && t.length>1){
    const main = t.slice(0, -1);
    const last = t.slice(-1);
    return `<span class="${cls}">${main}<span class="v-suffix-s">${last}</span><sup class="v-exp">${exp}</sup></span>`;
  }
  return `<span class="${cls}">${t}<sup class="v-exp">${exp}</sup></span>`;
}

function highlightPhraseThirdPersonS(line, ph, cls){
  if(!line || !ph) return line || "";
  const escaped = escapeRegExp(ph);
  const re = new RegExp(`(^|[^\\w])(${escaped})(?=[^\\w]|$)`, "gi");
  return line.replace(re, (m,g1,g2)=> `${g1}${wrapWithExpThirdPersonS(g2, cls)}`);
}

function highlightPhrase(line, ph, cls){
  if(!line || !ph) return line || "";
  const escaped = escapeRegExp(ph);
  // Token-boundary highlight: start OR a non-word char before, and non-word OR end after.
  const re = new RegExp(`(^|[^\\w])(${escaped})(?=[^\\w]|$)`, "gi");
  return String(line).replace(re, (m, g1, g2) => `${g1}${wrapWithExp(g2, cls)}`);
}

function highlightVariants(line, variants, cls){
  let out = String(line||"");
  const list = (Array.isArray(variants) ? variants : [])
    .map(s => String(s||"").trim())
    .filter(Boolean);

  // Longer first to prevent partial matches (e.g., got vs gotten)
  list.sort((a,b)=>b.length-a.length);

  for(const ph of list){
    out = highlightPhrase(out, ph, cls);
  }
  return out;
}

function colorizeConjugation(enLine, tKind, moodKey, p, v, modeUsed){
  const s = String(enLine||"");

  // ✅ Pasiva: resaltamos el C3 (V3) porque la pasiva siempre usa el participio
  if(modeUsed === "passive"){
    return highlightVariants(s, splitVariants(v && v.c3), "v-c3");
  }

  // ✅ BE especial (am/is/are | was/were | been)
  if(isBeVerb(v)){
    const k = String((p && (p.key || p)) || "");
    if(tKind === "P"){
      const form = (k==="I") ? "am" : (k==="He" || k==="She" || k==="It") ? "is" : "are";
      return highlightPhrase(s, form, "v-c1");
    }
    if(tKind === "S"){
      const plural = (k==="You" || k==="YouP" || k==="We" || k==="They");
      const form = plural ? "were" : "was";
      const neg  = plural ? "weren't" : "wasn't";
      const target = (moodKey==="N") ? neg : form;
      return highlightPhrase(s, target, "v-c2");
    }
    return highlightPhrase(s, "been", "v-c3");
  }

  // ✅ Verbos normales
  if(tKind === "P"){
    const base = (v && v.c1) ? v.c1 : "";
    const is3 = (moodKey === "A" && isThirdSing(p));
    const form = is3 ? thirdPersonS(base) : base;
    return is3 ? highlightPhraseThirdPersonS(s, form, "v-c1") : highlightPhrase(s, form, "v-c1");
  }

  if(tKind === "S"){
    // ✅ Pasado simple (VOZ ACTIVA):
    // - Afirmativa: usa C2 (pasado)     → I **stood**
    // - Negativa / Interrogativa: usa C1 (con DID) → I didn't **stand** / Did I **stand**?
    const isAff = (moodKey === "A");
    const target = isAff ? (v && v.c2 ? v.c2 : "") : (v && v.c1 ? v.c1 : "");
    const cls    = isAff ? "v-c2" : "v-c1";
    return highlightVariants(s, splitVariants(target), cls);
  }

  // Presente perfecto: resaltamos C3 (participio)
  return highlightVariants(s, splitVariants(v && v.c3), "v-c3");
}

function makePresent(p, v){
  if(isBeVerb(v)){
    const k = p.key || p; // allow p object
    if(k==="I") return "I am";
    if(k==="He"||k==="She"||k==="It") return `${subjCap(p)} is`;
    return `${subjCap(p)} are`;
  }
  const base = v.c1;
  const verbForm = isThirdSing(p) ? thirdPersonS(base) : base;
  return `${subjCap(p)} ${verbForm}`;
}
function makePresentNeg(p, v){
  if(isBeVerb(v)){
    const k = p.key || p;
    if(k==="I") return "I am not";
    if(k==="He"||k==="She"||k==="It") return `${subjCap(p)} is not`;
    return `${subjCap(p)} are not`;
  }
  const aux = isThirdSing(p) ? "doesn't" : "don't";
  return `${subjCap(p)} ${aux} ${v.c1}`;
}
function makePresentQ(p, v){
  if(isBeVerb(v)){
    const k = p.key || p;
    if(k==="I") return "Am I?";
    if(k==="He"||k==="She"||k==="It") return `Is ${subjLow(p)}?`;
    return `Are ${subjLow(p)}?`;
  }
  const aux = isThirdSing(p) ? "Does" : "Do";
  return `${aux} ${subjLow(p)} ${v.c1}?`;
}
function makePast(p, v){
  if(isBeVerb(v)){
    const k = p.key || p;
    if(k==="YouP"||k==="You"||k==="We"||k==="They") return `${subjCap(p)} were`;
    return `${subjCap(p)} was`;
  }
  return `${subjCap(p)} ${v.c2}`;
}
function makePastNeg(p, v){
  if(isBeVerb(v)){
    const k = p.key || p;
    if(k==="YouP"||k==="You"||k==="We"||k==="They") return `${subjCap(p)} weren't`;
    return `${subjCap(p)} wasn't`;
  }
  return `${subjCap(p)} didn't ${v.c1}`;
}
function makePastQ(p, v){
  if(isBeVerb(v)){
    const k = p.key || p;
    if(k==="YouP"||k==="You"||k==="We"||k==="They") return `Were ${subjLow(p)}?`;
    return `Was ${subjLow(p)}?`;
  }
  return `Did ${subjLow(p)} ${v.c1}?`;
}

function makePP(p, v){
  if(isBeVerb(v)){
    const aux = isThirdSing(p) ? "has" : "have";
    return `${subjCap(p)} ${aux} been`;
  }
  const aux = isThirdSing(p) ? "has" : "have";
  return `${subjCap(p)} ${aux} ${v.c3}`;
}
function makePPNeg(p, v){
  if(isBeVerb(v)){
    const aux = isThirdSing(p) ? "hasn't" : "haven't";
    return `${subjCap(p)} ${aux} been`;
  }
  const aux = isThirdSing(p) ? "hasn't" : "haven't";
  return `${subjCap(p)} ${aux} ${v.c3}`;
}
function makePPQ(p, v){
  if(isBeVerb(v)){
    const aux = isThirdSing(p) ? "Has" : "Have";
    return `${aux} ${subjLow(p)} been?`;
  }
  const aux = isThirdSing(p) ? "Has" : "Have";
  return `${aux} ${subjLow(p)} ${v.c3}?`;
}

/* Complement in active (Round 2) */
function enWithComplement(enLine, compEN){
  if(currentRound !== 2) return enLine;
  let s = String(enLine||"").trim();
  const isQ = s.endsWith("?");
  if(isQ){
    s = s.slice(0,-1).trim();
    if(!s.toLowerCase().includes(compEN.toLowerCase())){
      s = `${s} ${compEN}`.replace(/\s+/g," ").trim();
    }
    return `${s}?`;
  }else{
    if(!s.toLowerCase().includes(compEN.toLowerCase())){
      s = `${s} ${compEN}`.replace(/\s+/g," ").trim();
    }
    return s;
  }
}
function esWithComplement(esLine, compES){
  if(currentRound !== 2) return esLine;
  let s = String(esLine||"").trim();
  const isQ = s.startsWith("¿") && s.endsWith("?");
  if(isQ){
    s = s.slice(0,-1).trim();
    if(!s.toLowerCase().includes(compES.toLowerCase())){
      s = `${s} ${compES}`.replace(/\s+/g," ").trim();
    }
    return `${s}?`;
  }else{
    s = s.replace(/[.?!]$/,"").trim();
    if(!s.toLowerCase().includes(compES.toLowerCase())){
      s = `${s} ${compES}`.replace(/\s+/g," ").trim();
    }
    return s;
  }
}

/* ===========================
   ✅ PASSIVE VOICE (nuevo)
   =========================== */
function capFirst(s){
  const x = String(s||"").trim();
  if(!x) return x;
  return x.charAt(0).toUpperCase() + x.slice(1);
}
function isProbablyPluralEN(np){
  // heurística simple
  const s = String(np||"").trim().toLowerCase();
  const last = s.split(/\s+/).pop() || "";
  if(["you","we","they"].includes(s)) return true;
  if(last.endsWith("ss")) return false;
  if(last.endsWith("s") && !last.endsWith("us") && !last.endsWith("is")) return true;
  return false;
}
function passiveAllowed(v){
  // pasiva natural requiere verbo transitivo (objeto directo).
  // Lista corta de verbos típicamente intransitivos en este set (se advierte al usuario).
  const no = new Set(["go","come","become","arise","rise","fall","be","cost","have","get","fit","flee","stay","stride"]);
  return !no.has(String(v.c1||"").toLowerCase().trim());
}
function subjForPassive(v){
  // sujeto pasivo = objeto del activo (complemento)
  const comp = getComplement(v);
  return { en: capFirst(comp.en), es: comp.es };
}
function bePresentFor(objPlural){ return objPlural ? "are" : "is"; }
function bePastFor(objPlural){ return objPlural ? "were" : "was"; }
function haveFor(objPlural){ return objPlural ? "have" : "has"; }

function passivePresentA(v, agentP){
  const subj = subjForPassive(v).en;
  const plural = isProbablyPluralEN(subj);
  const be = bePresentFor(plural);
  const by = `by ${AGENT_OBJ[agentP.key] || "them"}`;
  return `${subj} ${be} ${v.c3} ${by}`;
}
function passivePresentN(v, agentP){
  const subj = subjForPassive(v).en;
  const plural = isProbablyPluralEN(subj);
  const be = bePresentFor(plural);
  const neg = (be==="is") ? "isn't" : "aren't";
  const by = `by ${AGENT_OBJ[agentP.key] || "them"}`;
  return `${subj} ${neg} ${v.c3} ${by}`;
}
function passivePresentQ(v, agentP){
  const subj = subjForPassive(v).en;
  const plural = isProbablyPluralEN(subj);
  const be = capFirst(bePresentFor(plural));
  const by = `by ${AGENT_OBJ[agentP.key] || "them"}`;
  return `${be} ${subj.toLowerCase()} ${v.c3} ${by}?`;
}

function passivePastA(v, agentP){
  const subj = subjForPassive(v).en;
  const plural = isProbablyPluralEN(subj);
  const be = bePastFor(plural);
  const by = `by ${AGENT_OBJ[agentP.key] || "them"}`;
  return `${subj} ${be} ${v.c3} ${by}`;
}
function passivePastN(v, agentP){
  const subj = subjForPassive(v).en;
  const plural = isProbablyPluralEN(subj);
  const be = bePastFor(plural);
  const neg = (be==="was") ? "wasn't" : "weren't";
  const by = `by ${AGENT_OBJ[agentP.key] || "them"}`;
  return `${subj} ${neg} ${v.c3} ${by}`;
}
function passivePastQ(v, agentP){
  const subj = subjForPassive(v).en;
  const plural = isProbablyPluralEN(subj);
  const be = capFirst(bePastFor(plural));
  const by = `by ${AGENT_OBJ[agentP.key] || "them"}`;
  return `${be} ${subj.toLowerCase()} ${v.c3} ${by}?`;
}

function passivePPA(v, agentP){
  const subj = subjForPassive(v).en;
  const plural = isProbablyPluralEN(subj);
  const aux = haveFor(plural);
  const by = `by ${AGENT_OBJ[agentP.key] || "them"}`;
  return `${subj} ${aux} been ${v.c3} ${by}`;
}
function passivePPN(v, agentP){
  const subj = subjForPassive(v).en;
  const plural = isProbablyPluralEN(subj);
  const aux = haveFor(plural);
  const neg = (aux==="has") ? "hasn't" : "haven't";
  const by = `by ${AGENT_OBJ[agentP.key] || "them"}`;
  return `${subj} ${neg} been ${v.c3} ${by}`;
}
function passivePPQ(v, agentP){
  const subj = subjForPassive(v).en;
  const plural = isProbablyPluralEN(subj);
  const aux = capFirst(haveFor(plural));
  const by = `by ${AGENT_OBJ[agentP.key] || "them"}`;
  return `${aux} ${subj.toLowerCase()} been ${v.c3} ${by}?`;
}

/* Español: VOZ PASIVA (SER + PARTICIPIO + "por" + agente)
   Objetivo: traducción clara y consistente para principiantes, como:
   "El papel es cortado por mí hoy."
   "El papel fue cortado por mí ayer."
   "El papel ha sido cortado por mí esta semana."
*/
const ES_AGENT_POR = {
  I:   "por mí",
  You: "por ti",
  He:  "por él",
  She: "por ella",
  It:  "por ello",
  We:  "por nosotros",
  YouP:"por ustedes",
  They:"por ellos"
};

// Participios irregulares comunes (infinitivo -> participio masc. sing.)
const ES_PART_IRREG = {
  "abrir":"abierto",
  "cubrir":"cubierto",
  "decir":"dicho",
  "escribir":"escrito",
  "freír":"frito",
  "hacer":"hecho",
  "morir":"muerto",
  "poner":"puesto",
  "resolver":"resuelto",
  "romper":"roto",
  "satisfacer":"satisfecho",
  "ver":"visto",
  "volver":"vuelto"
};

function esVerbInfFromLabel(esLabel){
  let v = String(esLabel||"").trim();
  v = v.split("/")[0].trim();           // primera opción si viene "Guardar / Mantener"
  v = v.replace(/\(.*?\)/g,"").trim(); // quita paréntesis
  v = v.replace(/\s+se$/i,"").trim();   // quita "se" final reflexivo
  v = v.toLowerCase().replace(/\s+/g," ").trim();
  return v;
}

function esParticipleFromInfinitive(esInf){
  const v = esVerbInfFromLabel(esInf);
  if(!v) return "hecho";
  if(ES_PART_IRREG[v]) return ES_PART_IRREG[v];
  if(v.endsWith("ar")) return v.slice(0,-2) + "ado";
  if(v.endsWith("er") || v.endsWith("ir")) return v.slice(0,-2) + "ido";
  return v;
}

function esGuessGenderNumber(np){
  const s = String(np||"").trim().toLowerCase();
  const starts = (w)=>s.startsWith(w+" ");
  const plural = starts("los") || starts("las") || starts("unos") || starts("unas");
  const feminine = starts("la") || starts("una") || starts("las") || starts("unas") || starts("esta") || starts("esa");
  return {plural, feminine};
}

function esAgreeParticiple(partMasSing, feminine, plural){
  let p = String(partMasSing||"").trim().toLowerCase();
  if(!p) p = "hecho";
  if(feminine && p.endsWith("o")) p = p.slice(0,-1) + "a";
  if(plural && !p.endsWith("s")) p = p + "s";
  return p;
}

function esAuxSerPassive(tenseKind, plural){
  if(tenseKind==="P")  return plural ? "son" : "es";
  if(tenseKind==="S")  return plural ? "fueron" : "fue";
  return plural ? "han sido" : "ha sido"; // PP
}

function esSerPassiveLine(v, tenseKind, moodKey, agentP, subjES, tail){
  const subjRaw = String(subjES||"la tarea").replace(/\s+/g," ").trim().replace(/[\.!?]+$/,"");
  const subj = capFirst(subjRaw);
  const {plural, feminine} = esGuessGenderNumber(subjRaw);
  const aux = esAuxSerPassive(tenseKind, plural);
  const part0 = esParticipleFromInfinitive(v?.esp || "");
  const part = esAgreeParticiple(part0, feminine, plural);
  const por = ES_AGENT_POR[agentP?.key] || "por ellos";
  const t = String(tail||"").trim();

  const coreA = `${subj} ${aux} ${part} ${por}`.replace(/\s+/g," ").trim();
  const coreN = `${subj} no ${aux} ${part} ${por}`.replace(/\s+/g," ").trim();

  if(moodKey==="Q"){
    const q = `${coreA}${t ? (" " + t) : ""}`.replace(/\s+/g," ").trim();
    return `¿${q}?`;
  }
  const s = (moodKey==="N") ? coreN : coreA;
  const out = `${s}${t ? (" " + t) : ""}`.replace(/\s+/g," ").trim();
  return out + ".";
}

function esSerPassiveWithTail(v, tenseKind, moodKey, agentP, subjES, tail){
  return esSerPassiveLine(v, tenseKind, moodKey, agentP, subjES, tail);
}

/* ===========================
   ✅ MODO DE VOZ (UI)
   =========================== */
function setVoice(mode){
  voiceMode = (mode==="passive") ? "passive" : "active";
  document.getElementById("btnActive").classList.toggle("active", voiceMode==="active");
  document.getElementById("btnPassive").classList.toggle("active", voiceMode==="passive");

  const label = document.getElementById("voiceModeLabel");
  const hint = document.getElementById("voiceModeMiniHint");
  if(voiceMode==="active"){
    label.textContent = "Voz Activa";
    hint.textContent = (currentRound===2)
      ? "Sujeto → Verbo → Complemento"
      : "Sujeto → Verbo";
  }else{
    label.textContent = "Voz Pasiva";
    hint.textContent = (currentRound===2)
      ? "Objeto → BE → V3 (+ by agente)"
      : "Objeto → BE → V3";
  }

  // si ya estaba abierto el master, regenera para el verbo actual
  if(document.getElementById("master").style.display === "block"){
    const v=current[idx];
    if(v){
      generarTablas(v);
      renderPractice(v);
      renderReading(v);
    }
  }
}

/* ===========================
   ✅ ROUND SELECTOR
   =========================== */
function setRound(n){
  // ✅ Al cambiar Round, NO enfocar BASE; enfocar selector de Grupo
  focusGroupAfterLoad = true;
  currentRound = n===2 ? 2 : 1;
  activeDB = (currentRound===2) ? verbosDB_R2 : verbosDB_R1;

  document.getElementById("btnRound1").classList.toggle("active", currentRound===1);
  document.getElementById("btnRound2").classList.toggle("active", currentRound===2);

  document.getElementById("roundHint").textContent =
    (currentRound===2)
      ? "Round 2: Pronombre + Verbo + Complemento"
      : "Round 1: Pronombre + Verbo";

  actualizarDias();
  setVoice(voiceMode);
}

/* ===========================
   ✅ MODAL DE MOTIVACIÓN
   =========================== */
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function isVisible(el){
  if(!el) return false;
  const d = (el.style && el.style.display) ? el.style.display : '';
  return d && d !== 'none';
}
function syncModalOpen(){
  const any = isVisible(document.getElementById('overlay'))
          || isVisible(document.getElementById('instOverlay'))
          || isVisible(document.getElementById('ebookOverlay'))
          || isVisible(document.getElementById('motivationToast'))
          || isVisible(document.getElementById('motivationBackdrop'));
  document.body.classList.toggle('modal-open', any);
}

function showMotivation(v){
  pendingVerb = v;

  const backdrop = document.getElementById("motivationBackdrop");
  const toast = document.getElementById("motivationToast");
  const enEl = document.getElementById("motivationEN");
  const esEl = document.getElementById("motivationES");

  const verbEN = String(v.c1 || "").trim();
  const verbES = String(v.esp || "").trim().toLowerCase();

  const tag = (voiceMode==="passive") ? "PASSIVE" : "ACTIVE";

  const templatesEN = [
    `Awesome! <span class="motivation-verb">“${verbEN}”</span> mastered (${tag}). Keep going! 🚀`,
    `Neurons connected! <span class="motivation-verb">“${verbEN}”</span> unlocked (${tag}). ✨`,
    `Great job! You leveled up with <span class="motivation-verb">“${verbEN}”</span> (${tag}). 🔥`
  ];
  const templatesES = [
    `¡Excelente! Dominaste <span class="motivation-verb">“${verbES}”</span> (${tag}). 🚀`,
    `¡Neuronas conectadas! <span class="motivation-verb">“${verbES}”</span> (${tag}). ✨`,
    `¡Muy bien! Subiste de nivel con <span class="motivation-verb">“${verbES}”</span> (${tag}). 🔥`
  ];

  enEl.innerHTML = pick(templatesEN);
  esEl.innerHTML = pick(templatesES);

  backdrop.style.display = "block";
  toast.style.display = "flex";
  syncModalOpen();
}

function hideMotivation(){
  document.getElementById("motivationBackdrop").style.display = "none";
  document.getElementById("motivationToast").style.display = "none";
  syncModalOpen();
}

function conjugarDesdeModal(){
  if(!pendingVerb) return;

  generarTablas(pendingVerb);
  document.getElementById('master').style.display="block";

  renderSpelling(pendingVerb);
  renderPractice(pendingVerb);
  renderReading(pendingVerb);

  hideMotivation();
  pendingVerb = null;

  // ✅ Después de conjugar, llevar al usuario a la zona de tablas
  // (evita quedarse en el formulario y mejora la UX en móvil)
  try{
    requestAnimationFrame(()=>requestAnimationFrame(()=>scrollToConjugationTables()));
  }catch(_){
    scrollToConjugationTables();
  }
}

/* ===========================
   ✅ MODAL: INSTRUCCIONES
   =========================== */
function abrirInstrucciones(){
  const o = document.getElementById("instOverlay");
  if(o) o.style.display = "flex";
  // asegura que el modal quede visible arriba
  try{
    const modal = o?.querySelector?.(".modal");
    if(modal) modal.scrollTop = 0;
  }catch(_){}
  syncModalOpen();
}
function cerrarInstrucciones(){
  const o = document.getElementById("instOverlay");
  if(o) o.style.display = "none";
  syncModalOpen();
}

/* ===========================
   ✅ MODAL: E-BOOK
   =========================== */
function abrirEbook(){
  const o = document.getElementById("ebookOverlay");
  if(o) o.style.display = "flex";
  syncModalOpen();
}
function cerrarEbook(){
  const o = document.getElementById("ebookOverlay");
  if(o) o.style.display = "none";
  syncModalOpen();
}

/* ===========================
   ✅ BOTÓN WEB
   =========================== */
function abrirWeb(){
  window.open('https://sites.google.com/iemanueljbetancur.edu.co/smartebook/inicio','_blank');
}

/* ===========================
   INIT / UI
   =========================== */
function init(){
  pinStatsBar();
  loadState();

  const gNames=[
    "GRUPO 1: (Day 1-8) |   C1 = C2 = C3",
    "GRUPO 2: (Day 9-25) |  C1 ≠ C2 = C3",
    "GRUPO 3: (Day 26-40) | C1 ≠ C2 ≠ C3"
  ];
  document.getElementById('sel-grupo').innerHTML =
    gNames.map((n,i)=>`<option value="${i+1}">${n}</option>`).join('');

  renderGroupHint(1);
  actualizarDias();

  const inst = document.getElementById("instOverlay");
  if(inst){
    inst.addEventListener("click", (e)=>{
      if(e.target && e.target.id === "instOverlay") cerrarInstrucciones();
    });
  }

  const eb = document.getElementById("ebookOverlay");
  if(eb){
    eb.addEventListener("click", (e)=>{
      if(e.target && e.target.id === "ebookOverlay") cerrarEbook();
    });
  }
}

/* ESC para cerrar modales */
window.addEventListener("keydown", (e)=>{
  if(e.key === "Escape"){
    try{ cerrarAyuda(); }catch(_){}
    try{ cerrarInstrucciones(); }catch(_){}
    try{ cerrarEbook(); }catch(_){}
    try{ hideMotivation(); }catch(_){}
    try{ syncModalOpen(); }catch(_){}
  }
});

function actualizarDias(){

  // ✅ IMPORTANTE: NO hacer scroll automático al recargar.
  // Solo enfocamos/centramos el selector cuando el usuario ya interactuó.
  if(__userInteracted){
    try{
      const sg = document.getElementById('sel-grupo');
      if(sg){
        // preventScroll evita saltos en navegadores compatibles
        try{ sg.focus({ preventScroll: true }); }catch(_){ sg.focus(); }
        sg.scrollIntoView({behavior:'smooth', block:'center'});
      }
    }catch(_){}
  }

  const g = parseInt(document.getElementById('sel-grupo').value,10);
  renderGroupHint(g);

  const dias = [...new Set(activeDB.filter(v=>v.g===g).map(v=>v.d))].sort((a,b)=>a-b);
  document.getElementById('sel-dia').innerHTML =
    dias.map(d=>`<option value="${d}">Día ${d}</option>`).join('');
  cargarDia();
}

function cargarDia(){
  const d = parseInt(document.getElementById('sel-dia').value,10);
  current = activeDB.filter(v=>v.d===d);
  idx=0;
  mostrar();
}

function mostrar(){
  const v = current[idx];
  if(!v) return;

  // ✅ En el encabezado principal mostramos el verbo en INGLÉS
  const vTop = document.getElementById('verbo-en');
  if(vTop) vTop.innerText = (v.c1 || "").toUpperCase();
  updateMasteryUI(v);
  renderVerbIllustration(v);

  const exBox = document.getElementById("exNote");
  const exText = document.getElementById("exText");
  if(v.ex){
    exText.textContent = v.ex;
    exBox.style.display = "block";
  }else{
    exText.textContent = "";
    exBox.style.display = "none";
  }

  ["c1","c2","c3"].forEach(id=>{
    const el=document.getElementById(id);
    el.value="";
    el.style.borderColor="#e2e8f0";
  });

  const p1 = document.getElementById('progreso');
  if(p1) p1.innerText = `${idx+1} de ${current.length}`;
  const p2 = document.getElementById('progreso2');
  if(p2) p2.innerText = `${idx+1} de ${current.length}`;
  const p2f = document.getElementById('progreso2Footer');
  if(p2f) p2f.innerText = `${idx+1} de ${current.length}`;

  document.getElementById('msg').innerText="";
  document.getElementById('master').style.display="none";
  document.getElementById('spellingArea').innerHTML = "";
  document.getElementById('practiceArea').innerHTML = "";
  document.getElementById('readingArea').innerHTML = "";
  const rn = document.getElementById('readingNav');
  if(rn) rn.style.display = "flex";
  const rnf = document.getElementById('readingNavFooter');
  if(rnf) rnf.style.display = "none";
  spellingState = null;
  practiceState = null;

  // ✅ Evitar saltos de scroll al recargar.
  // Solo hacemos focus/scroll cuando el usuario ya interactuó.
  if(__userInteracted){
    // Si vienes de cambiar Round, ubica el cursor en Grupo
    if(focusGroupAfterLoad){
      focusGroupAfterLoad = false;
      try{
        const sg = document.getElementById('sel-grupo');
        if(sg){
          try{ sg.focus({ preventScroll: true }); }catch(_){ sg.focus(); }
          sg.scrollIntoView({behavior:'smooth', block:'center'});
        }
      }catch(_){ }
    }else{
      // Foco en C1 solo si ya hay interacción
      try{
        const c1 = document.getElementById('c1');
        if(c1){
          try{ c1.focus({ preventScroll: true }); }catch(_){ c1.focus(); }
        }
      }catch(_){ }
    }
  }
}

function cambiar(step){
  if(!current.length) return;
  idx = Math.max(0, Math.min(current.length-1, idx+step));
  mostrar();
}

function hablarC1(){
  const v=current[idx];
  if(!v) return;
  hablar(v.c1);
}
function hablarC2(){
  const v=current[idx];
  if(!v) return;
  hablar(v.c2);
}
function hablarC3(){
  const v=current[idx];
  if(!v) return;
  hablar(v.c3);
}

function deletrear(){
  const v=current[idx];
  hablar(v.c1.split("").join("... "));
}

/* ===========================
   VALIDACIÓN (igual)
   =========================== */
function validar(){
  const v=current[idx];
  if(!v) return;
  if(!canPlay()) return;

  const r1 = document.getElementById('c1').value.trim();
  const r2 = document.getElementById('c2').value.trim();
  const r3 = document.getElementById('c3').value.trim();

  ["c1","c2","c3"].forEach(id=>{
    document.getElementById(id).style.borderColor="#e2e8f0";
  });

  if(!r1 || !r2 || !r3){
    if(!r1) document.getElementById('c1').style.borderColor="var(--error)";
    if(!r2) document.getElementById('c2').style.borderColor="var(--error)";
    if(!r3) document.getElementById('c3').style.borderColor="var(--error)";
    document.getElementById('msg').innerHTML =
      `<span style="color:var(--error)">✍️ Escribe algo en C1, C2 y C3 para validar.</span>`;
    return;
  }

  att++;

  const ok1 = isMatch(r1, v.c1, v.alt1);
  const ok2 = isMatch(r2, v.c2, v.alt2);
  const ok3 = isMatch(r3, v.c3, v.alt3);

  if(ok1 && ok2 && ok3){
    playCorrectSound();
    streak++; corr++;
    const gained = addConnectXP(v);
    if(gained>0) bumpMastery(v.c1, 1);
    document.getElementById('msg').innerHTML = gained
      ? `<span style="color:var(--success)">🔥 ¡CONEXIÓN EXITOSA! +${gained} XP</span>`
      : `<span style="color:var(--success)">✅ Correcto. (XP ya sumado)</span>`;
    document.getElementById('master').style.display="none";

    ["c1","c2","c3"].forEach(id=>{
      const el = document.getElementById(id);
      el.value = "";
      el.style.borderColor = "#e2e8f0";
    });

    showMotivation(v);
  }else{
    playWrongSound();
    recordMistake(v);

    // Vidas + Freeze 
    const spent = spendHeart();
    if(!spent){
      actualizarStats();
      return;
    }

    if(freezeTokens > 0 && streak > 0){
      freezeTokens -= 1;
      toastAchievement("🧊", "Streak protegida", "Usaste 1 Freeze para no perder la racha.");
    }else{
      streak=0;
    }

    document.getElementById('msg').innerHTML =
      `<span style="color:var(--error)">⚡ Revisa las columnas</span>
       <span style="display:inline-block;margin-left:10px;background:rgba(0,0,0,.06);padding:4px 8px;border-radius:999px;font-weight:950;">Vidas: ${hearts}/${MAX_HEARTS}</span>`;
    if(!ok1) document.getElementById('c1').style.borderColor="var(--error)";
    if(!ok2) document.getElementById('c2').style.borderColor="var(--error)";
    if(!ok3) document.getElementById('c3').style.borderColor="var(--error)";
  }
  actualizarStats();
}

function actualizarStats(){
  document.getElementById('streak').innerText = streak;
  document.getElementById('xp').innerText = xp;
  document.getElementById('acc').innerText = (att===0 ? 100 : Math.round((corr/att)*100)) + "%";
  updateGamificationUI();
  const __suppress = !!window.__suppressXpSync;

  // ✅ Sincronizar XP a Sheets (delta) y refrescar ranking
    if(__suppress){ __lastXpSynced = xp; persistState(); return; }

try{
    const idToken = localStorage.getItem("google_id_token");
    if(idToken){
      if(__lastXpSynced === null) __lastXpSynced = xp;
      const delta = xp - __lastXpSynced;
      if(delta > 0){
        __lastXpSynced = xp;
        queueXpDelta(idToken, delta);
        
        // ✅ Consumir (reducir) XP pendiente externo si existe
        try{
          const __pendingKey = "yoguis_xp_pending_delta_v1";
          const __p = Number(safeLSGet(__pendingKey) || 0);
          if(__p > 0){
            const __left = Math.max(0, __p - delta);
            safeLSSet(__pendingKey, String(__left));
          }
        }catch(_){}
if(!window.__lbDebounce){
          window.__lbDebounce = setTimeout(()=>{ window.__lbDebounce=null; cargarLeaderboard(50); }, 1200);
        }
      }
    }
  }catch(_){}

  persistState();
}

/* ===========================
   🇪🇸 CONJUGADOR ESPAÑOL (para traducciones en tablas)
   - Conjugación básica + irregularidades frecuentes
   - Soporta verbos reflexivos (terminan en -se)
   - Soporta glosas con "/" o frases ("llegar a ser", "usar/llevar puesto")
   =========================== */
const PRON_IDX = {I:0, You:1, He:2, She:3, It:4, We:5, YouP:6, They:7};
const ES_REFLEX = {I:"me", You:"te", He:"se", She:"se", It:"se", We:"nos", YouP:"se", They:"se"};
const ES_HABER  = {I:"he", You:"has", He:"ha", She:"ha", It:"ha", We:"hemos", YouP:"han", They:"han"};

function _deaccent(s){
  return (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}
function parseSpanishGloss(gloss){
  let raw = (gloss||"").trim();
  // si hay varias opciones, usamos la primera para conjugar
  raw = raw.split("/")[0].trim();
  raw = raw.replace(/\s+/g," ").toLowerCase();

  // reflexivo
  let reflexive = false;
  if(raw.endsWith("se")){
    reflexive = true;
    raw = raw.slice(0,-2).trim();
  }

  // frases (ej: "llegar a ser", "dar a luz"): conjugamos el 1er verbo y anexamos el resto
  let base = raw, tail = "";
  if(raw.includes(" ")){
    const parts = raw.split(" ");
    base = parts.shift();
    tail = parts.join(" ");
  }
  return { base, tail, reflexive, key:_deaccent(base) };
}

// ✅ Irregularidades (solo las necesarias para el set de 180 verbos)
const IRR_PRESENT_FULL = {
  ser:     ["soy","eres","es","es","es","somos","son","son"],
  estar:   ["estoy","estás","está","está","está","estamos","están","están"],
  ir:      ["voy","vas","va","va","va","vamos","van","van"],
  dar:     ["doy","das","da","da","da","damos","dan","dan"],
  ver:     ["veo","ves","ve","ve","ve","vemos","ven","ven"],
  haber:   ["he","has","ha","ha","ha","hemos","han","han"],
  saber:   ["sé","sabes","sabe","sabe","sabe","sabemos","saben","saben"],
  caber:   ["quepo","cabes","cabe","cabe","cabe","cabemos","caben","caben"],
  caer:    ["caigo","caes","cae","cae","cae","caemos","caen","caen"],
  hacer:   ["hago","haces","hace","hace","hace","hacemos","hacen","hacen"],
  decir:   ["digo","dices","dice","dice","dice","decimos","dicen","dicen"],
  poner:   ["pongo","pones","pone","pone","pone","ponemos","ponen","ponen"],
  traer:   ["traigo","traes","trae","trae","trae","traemos","traen","traen"],
  venir:   ["vengo","vienes","viene","viene","viene","venimos","vienen","vienen"],
  conducir:["conduzco","conduces","conduce","conduce","conduce","conducimos","conducen","conducen"],
  oir:     ["oigo","oyes","oye","oye","oye","oímos","oyen","oyen"], // oír
  tener:   ["tengo","tienes","tiene","tiene","tiene","tenemos","tienen","tienen"],
};

const IRR_PRET = {
  ser:     ["fui","fuiste","fue","fue","fue","fuimos","fueron","fueron"],
  ir:      ["fui","fuiste","fue","fue","fue","fuimos","fueron","fueron"],
  dar:     ["di","diste","dio","dio","dio","dimos","dieron","dieron"],
  ver:     ["vi","viste","vio","vio","vio","vimos","vieron","vieron"],
  caer:    ["caí","caíste","cayó","cayó","cayó","caímos","cayeron","cayeron"],
  oir:     ["oí","oíste","oyó","oyó","oyó","oímos","oyeron","oyeron"],
  caber:   ["cupe","cupiste","cupo","cupo","cupo","cupimos","cupieron","cupieron"],
  hacer:   ["hice","hiciste","hizo","hizo","hizo","hicimos","hicieron","hicieron"],
  poner:   ["puse","pusiste","puso","puso","puso","pusimos","pusieron","pusieron"],
  venir:   ["vine","viniste","vino","vino","vino","vinimos","vinieron","vinieron"],
  traer:   ["traje","trajiste","trajo","trajo","trajo","trajimos","trajeron","trajeron"],
  decir:   ["dije","dijiste","dijo","dijo","dijo","dijimos","dijeron","dijeron"],
  conducir:["conduje","condujiste","condujo","condujo","condujo","condujimos","condujeron","condujeron"],
  tener:   ["tuve","tuviste","tuvo","tuvo","tuvo","tuvimos","tuvieron","tuvieron"],
};

const IRR_PART = {
  abrir:"abierto",
  cubrir:"cubierto",
  decir:"dicho",
  escribir:"escrito",
  hacer:"hecho",
  morir:"muerto",
  poner:"puesto",
  romper:"roto",
  ver:"visto",
  volver:"vuelto",
  resolver:"resuelto",
  oir:"oído",
  tener:"tenido",
};

const STEM_E_IE = new Set(["cerrar","empezar","pensar","sentir","perder","entender","mentir","herir","sentar","despertar"]);
const STEM_O_UE = new Set(["dormir","encontrar","mostrar","sonar","costar","morder","volar","esforzar"]);
const STEM_E_I  = new Set(["sentir","mentir","herir"]);
const PRET_IR_STEM_E_I = new Set(["sentir","mentir","herir"]);
const PRET_IR_STEM_O_U = new Set(["dormir"]);
const UIR_Y = new Set(["construir","huir"]);

function presentStemChanged(key, stem){
  // aplica el cambio al ÚLTIMO núcleo vocálico típico
  const vowels = stem.split("");
  for(let i=vowels.length-1;i>=0;i--){
    const ch=vowels[i];
    if(ch==="e" && STEM_E_IE.has(key)){
      vowels[i] = "ie";
      return vowels.join("").replace(/ie(?=ie)/g,"ie"); // seguro
    }
    if(ch==="o" && STEM_O_UE.has(key)){
      vowels[i] = "ue";
      return vowels.join("");
    }
    if(ch==="e" && STEM_E_I.has(key)){
      vowels[i] = "i";
      return vowels.join("");
    }
  }
  return stem;
}

function esPresent(espGloss, pronKey){
  const {base, tail, reflexive, key} = parseSpanishGloss(espGloss);
  const idx = PRON_IDX[pronKey];
  if(IRR_PRESENT_FULL[key]) return { form: IRR_PRESENT_FULL[key][idx], tail, reflexive, key };

  const baseNorm = _deaccent(base);
  const end = baseNorm.slice(-2);
  const stem = base.slice(0,-2);

  let stemUse = stem;
  // stem-change (no aplica en "nosotros")
  if(idx !== PRON_IDX.We){
    stemUse = presentStemChanged(key, stemUse);
  }

  // -uir (no -guir): construyo, huyes, etc.
  if(baseNorm.endsWith("uir") && !baseNorm.endsWith("guir") && idx !== PRON_IDX.We){
    stemUse = stem + "y";
  }

  const endings = (end==="ar")
    ? ["o","as","a","a","a","amos","an","an"]
    : (end==="er")
      ? ["o","es","e","e","e","emos","en","en"]
      : ["o","es","e","e","e","imos","en","en"];

  return { form: stemUse + endings[idx], tail, reflexive, key };
}

function preteriteStemChanged(key, stem, idx){
  if(idx===PRON_IDX.He || idx===PRON_IDX.She || idx===PRON_IDX.It || idx===PRON_IDX.YouP || idx===PRON_IDX.They){
    if(PRET_IR_STEM_O_U.has(key)){
      return stem.replace(/o(?!.*o)/,"u"); // último "o" -> "u"
    }
    if(PRET_IR_STEM_E_I.has(key)){
      return stem.replace(/e(?!.*e)/,"i"); // último "e" -> "i"
    }
  }
  return stem;
}

function esPreterite(espGloss, pronKey){
  const {base, tail, reflexive, key} = parseSpanishGloss(espGloss);
  const idx = PRON_IDX[pronKey];
  if(IRR_PRET[key]) return { form: IRR_PRET[key][idx], tail, reflexive, key };

  const baseNorm = _deaccent(base);
  const end = baseNorm.slice(-2);
  let stem = base.slice(0,-2);

  // cambios ortográficos en "yo": -car/-gar/-zar
  if(idx===PRON_IDX.I){
    if(baseNorm.endsWith("car")) stem = stem.slice(0,-1) + "qu";
    if(baseNorm.endsWith("gar")) stem = stem.slice(0,-1) + "gu";
    if(baseNorm.endsWith("zar")) stem = stem.slice(0,-1) + "c";
  }

  // -uir (3a persona) -> yó/yeron
  if(UIR_Y.has(key) && (idx===PRON_IDX.He || idx===PRON_IDX.She || idx===PRON_IDX.It || idx===PRON_IDX.YouP || idx===PRON_IDX.They)){
    const endings = ["í","iste","yó","yó","yó","imos","yeron","yeron"];
    return { form: stem + endings[idx], tail, reflexive, key };
  }

  // stem-change pretérito solo en 3as personas (-ir)
  stem = preteriteStemChanged(key, stem, idx);

  const endings = (end==="ar")
    ? ["é","aste","ó","ó","ó","amos","aron","aron"]
    : ["í","iste","ió","ió","ió","imos","ieron","ieron"];

  return { form: stem + endings[idx], tail, reflexive, key };
}

function esParticiple(espGloss){
  const {base, tail, reflexive, key} = parseSpanishGloss(espGloss);
  if(IRR_PART[key]) return { part: IRR_PART[key], tail, reflexive, key };

  const baseNorm = _deaccent(base);
  const end = baseNorm.slice(-2);
  const stem = base.slice(0,-2);
  const part = (end==="ar") ? (stem + "ado") : (stem + "ido");
  return { part, tail, reflexive, key };
}

function buildSpanishActiveLine(tKind, modeKey, p, v, comp){
  // ✅ Round 1: SOLO pronombre + verbo (sin complemento)
  // ✅ Round 2: pronombre + verbo + complemento
  const useComp = (currentRound===2); // Round 2: con complemento en todas las conjugaciones/tiempos (incluye "be")
  const compEs = (useComp && comp && comp.es) ? (" " + comp.es) : "";
  const pronEs = p.es;

  // ✅ Preferir traducción exacta desde verbs.html (si existe)
  const __fromDb = lookupSpanishLineFromVerbsHtml(tKind, modeKey, p, v);
  if(__fromDb){
    if(!compEs) return __fromDb;
    // Insertar complemento respetando signos de pregunta y alternativas " / "
    return String(__fromDb).split(" / ").map(part=>{
      part = String(part||"").trim();
      if(!part) return part;
      if(part.endsWith("?")){
        return (part.slice(0,-1).trim() + compEs + "?").replace(/\s+/g," ").trim();
      }
      return (part + compEs).replace(/\s+/g," ").trim();
    }).join(" / ");
  }

  // ✅ Caso especial: TO BE (Ser/Estar) - Grupo 3 Día 40
  if(isBeVerb(v)){
    const k = p.key;

    // ✅ Round 2: agregar complemento también a "to be" (incluye preguntas)
    const beAddComp = (s)=>{
      if(!compEs) return s;
      return String(s).split(" / ").map(part=>{
        part = String(part||"").trim();
        if(!part) return part;
        if(part.endsWith("?")){
          return (part.slice(0,-1).trim() + compEs + "?").replace(/\s+/g," ").trim();
        }
        return (part + compEs).replace(/\s+/g," ").trim();
      }).join(" / ");
    };

    // helpers por pronombre
    const es_pres_A = {
      I:"Yo soy / Yo estoy",
      You:"Tú eres / Tú estás",
      He:"Él es / Él está",
      She:"Ella es / Ella está",
      It:"Eso es / Eso está",
      We:"Nosotros somos / estamos",
      YouP:"Ustedes son / están",
      They:"Ellos son / están"
    };
    const es_pres_N = {
      I:"Yo no soy / estoy",
      You:"Tú no eres / estás",
      He:"Él no es / está",
      She:"Ella no es / está",
      It:"Eso no es / está",
      We:"Nosotros no somos / estamos",
      YouP:"Ustedes no son / están",
      They:"Ellos no son / están"
    };
    const es_pres_Q = {
      I:"¿Soy yo? / ¿Estoy yo?",
      You:"¿Eres tú? / ¿Estás tú?",
      He:"¿Es él? / ¿Está él?",
      She:"¿Es ella? / ¿Está ella?",
      It:"¿Es eso? / ¿Está eso?",
      We:"¿Somos nosotros? / ¿Estamos?",
      YouP:"¿Son ustedes? / ¿Están ustedes?",
      They:"¿Son ellos? / ¿Están ellos?"
    };

    const es_past_A = {
      I:"Yo fui / estuve",
      You:"Tú fuiste / estuviste",
      He:"Él fue / estuvo",
      She:"Ella fue / estuvo",
      It:"Eso fue / estuvo",
      We:"Nosotros fuimos / estuvimos",
      YouP:"Ustedes fueron / estuvieron",
      They:"Ellos fueron / estuvieron"
    };
    const es_past_N = {
      I:"Yo no fui / estuve",
      You:"Tú no fuiste / estuviste",
      He:"Él no fue / estuvo",
      She:"Ella no fue / estuvo",
      It:"Eso no fue / estuvo",
      We:"Nosotros no fuimos / estuvimos",
      YouP:"Ustedes no fueron / estuvieron",
      They:"Ellos no fueron / estuvieron"
    };
    const es_past_Q = {
      I:"¿Fui yo? / ¿Estuve yo?",
      You:"¿Fuiste tú? / ¿Estuviste?",
      He:"¿Fue él? / ¿Estuvo él?",
      She:"¿Fue ella? / ¿Estuvo ella?",
      It:"¿Fue eso? / ¿Estuvo eso?",
      We:"¿Fuimos nosotros? / ¿Estuvimos?",
      YouP:"¿Fueron ustedes? / ¿Estuvieron?",
      They:"¿Fueron ellos? / ¿Estuvieron?"
    };

    const es_pp_A = {
      I:"Yo he sido / estado",
      You:"Tú has sido / estado",
      He:"Él ha sido / estado",
      She:"Ella ha sido / estado",
      It:"Eso ha sido / estado",
      We:"Nosotros hemos sido / estado",
      YouP:"Ustedes han sido / estado",
      They:"Ellos han sido / estado"
    };
    const es_pp_N = {
      I:"Yo no he sido / estado",
      You:"Tú no has sido / estado",
      He:"Él no ha sido / estado",
      She:"Ella no ha sido / estado",
      It:"Eso no ha sido / estado",
      We:"Nosotros no hemos sido / estado",
      YouP:"Ustedes no han sido / estado",
      They:"Ellos no han sido / estado"
    };
    const es_pp_Q = {
      I:"¿He sido / estado yo?",
      You:"¿Has sido / estado tú?",
      He:"¿Ha sido / estado él?",
      She:"¿Ha sido / estado ella?",
      It:"¿Ha sido / estado eso?",
      We:"¿Hemos sido / estado nosotros?",
      YouP:"¿Han sido / estado ustedes?",
      They:"¿Han sido / estado ellos?"
    };

    if(tKind==="P"){
      if(modeKey==="A") return beAddComp(es_pres_A[k] || `${pronEs} soy / estoy`);
      if(modeKey==="N") return beAddComp(es_pres_N[k] || `${pronEs} no soy / estoy`);
      return beAddComp(es_pres_Q[k] || `¿${pronEs} soy / estoy?`);
    }
    if(tKind==="S"){
      if(modeKey==="A") return beAddComp(es_past_A[k] || `${pronEs} fui / estuve`);
      if(modeKey==="N") return beAddComp(es_past_N[k] || `${pronEs} no fui / estuve`);
      return beAddComp(es_past_Q[k] || `¿${pronEs} fui / estuve?`);
    }
    // PP
    if(modeKey==="A") return beAddComp(es_pp_A[k] || `${pronEs} he sido / estado`);
    if(modeKey==="N") return beAddComp(es_pp_N[k] || `${pronEs} no he sido / estado`);
    return beAddComp(es_pp_Q[k] || `¿He sido / estado ${pronEs.toLowerCase()}?`);
  }

  if(tKind==="P"){ // presente simple
    const {form, tail, reflexive} = esPresent(v.esp, p.key);
    const tailTxt = tail ? (" " + tail) : "";
    const ref = reflexive ? (ES_REFLEX[p.key] + " ") : "";
    if(modeKey==="A") return `${pronEs} ${ref}${form}${tailTxt}${compEs}`.replace(/\s+/g," ").trim();
    if(modeKey==="N") return `${pronEs} no ${ref}${form}${tailTxt}${compEs}`.replace(/\s+/g," ").trim();
    return `¿${capFirst(`${ref}${form}${tailTxt}`.replace(/\s+/g," " ).trim())} ${pronEs.toLowerCase()}${compEs}?`.replace(/\s+/g," " ).trim();
  }

  if(tKind==="S"){ // pasado simple (pretérito)
    const {form, tail, reflexive} = esPreterite(v.esp, p.key);
    const tailTxt = tail ? (" " + tail) : "";
    const ref = reflexive ? (ES_REFLEX[p.key] + " ") : "";
    if(modeKey==="A") return `${pronEs} ${ref}${form}${tailTxt}${compEs}`.replace(/\s+/g," ").trim();
    if(modeKey==="N") return `${pronEs} no ${ref}${form}${tailTxt}${compEs}`.replace(/\s+/g," ").trim();
    return `¿${capFirst(`${ref}${form}${tailTxt}`.replace(/\s+/g," " ).trim())} ${pronEs.toLowerCase()}${compEs}?`.replace(/\s+/g," " ).trim();
  }

  // Presente perfecto: haber + participio
  const aux = ES_HABER[p.key];
  const {part, tail, reflexive} = esParticiple(v.esp);
  const tailTxt = tail ? (" " + tail) : "";
  const ref = reflexive ? (ES_REFLEX[p.key] + " ") : "";

  if(modeKey==="A") return `${pronEs} ${ref}${aux} ${part}${tailTxt}${compEs}`.replace(/\s+/g," ").trim();
  if(modeKey==="N") return `${pronEs} no ${ref}${aux} ${part}${tailTxt}${compEs}`.replace(/\s+/g," ").trim();

  // En preguntas de perfecto (para verbos normales) se mantiene el estilo sin sujeto:
  return `¿${aux} ${ref}${part}${tailTxt}${compEs}?`.replace(/\s+/g," ").trim();
}

/* ===========================
   ✅ TABLAS (ACTIVA / PASIVA)
   =========================== */
function generarTablas(v){
  const tiempos = [
    {titulo:"📘 Tiempo 1: Presente Simple", kind:"P"},
    {titulo:"📘 Tiempo 2: Pasado Simple",   kind:"S"},
    {titulo:"📘 Tiempo 3: Presente Perfecto", kind:"PP"}
  ];
  const modos = [
    {titulo:"✅ Afirmativa",  key:"A"},
    {titulo:"❌ Negativa",    key:"N"},
    {titulo:"❓ Interrogativa", key:"Q"}
  ];

  const comp = getComplement(v);
  const subjPas = subjForPassive(v);

  // ✅ advertencia si pasiva no aplica
  const passiveOk = passiveAllowed(v);

  let html = "";

  if(voiceMode==="passive" && !passiveOk){
    html += `
      <div class="warn">
        ⚠️ <b>Voz pasiva:</b> este verbo suele ser <b>intransitivo</b> (no tiene objeto directo), por eso la pasiva no se usa de forma natural.
        <br/>✅ Recomendación: cambia a <b>VOZ ACTIVA</b> para este verbo, o usa un verbo transitivo equivalente (p.ej. “be taken / be brought”).
      </div>
    `;
  }

  tiempos.forEach(t=>{
    const head = (voiceMode==="passive")
      ? `${t.titulo} (VOZ PASIVA — BE + V3)`
      : `${t.titulo} (VOZ ACTIVA)`;

    html += `<div class="time-head">${head}</div><div class="grid">`;

    modos.forEach(m=>{
      html += `<div class="card"><strong>${m.titulo}</strong><table class="conj-table"><thead><tr><th>Oración</th></tr></thead><tbody>`;

      PRON.forEach(p=>{
        let en="";

        if(voiceMode==="active" || (voiceMode==="passive" && !passiveOk)){
          // ACTIVA
          if(t.kind==="P" && m.key==="A") en = makePresent(p,v);
          if(t.kind==="P" && m.key==="N") en = makePresentNeg(p,v);
          if(t.kind==="P" && m.key==="Q") en = makePresentQ(p,v);

          if(t.kind==="S" && m.key==="A") en = makePast(p,v);
          if(t.kind==="S" && m.key==="N") en = makePastNeg(p,v);
          if(t.kind==="S" && m.key==="Q") en = makePastQ(p,v);

          if(t.kind==="PP" && m.key==="A") en = makePP(p,v);
          if(t.kind==="PP" && m.key==="N") en = makePPNeg(p,v);
          if(t.kind==="PP" && m.key==="Q") en = makePPQ(p,v);

          en = enWithComplement(en, comp.en);

          // 🇪🇸 Traducción (activa) con conjugación real
          const esLine = buildSpanishActiveLine(t.kind, m.key, p, v, comp);
          const enHTML = colorizeConjugation(en, t.kind, m.key, p, v, "active");

          html += `
            <tr>
              <td class="en-col">
                <button class="btn-listen" type="button" data-say="${encodeURIComponent(en)}">🔊</button>
                <span class="en">${enHTML}</span>
                <div class="es">${esLine}</div>
              </td>
            </tr>`;
          return;
        }

        // PASIVA
        if(t.kind==="P" && m.key==="A") en = passivePresentA(v,p);
        if(t.kind==="P" && m.key==="N") en = passivePresentN(v,p);
        if(t.kind==="P" && m.key==="Q") en = passivePresentQ(v,p);

        if(t.kind==="S" && m.key==="A") en = passivePastA(v,p);
        if(t.kind==="S" && m.key==="N") en = passivePastN(v,p);
        if(t.kind==="S" && m.key==="Q") en = passivePastQ(v,p);

        if(t.kind==="PP" && m.key==="A") en = passivePPA(v,p);
        if(t.kind==="PP" && m.key==="N") en = passivePPN(v,p);
        if(t.kind==="PP" && m.key==="Q") en = passivePPQ(v,p);

        // Español: estructura correcta tipo "Se ha hecho la tarea."
        const tailES = (t.kind==="P") ? "hoy" : (t.kind==="S") ? "ayer" : "esta semana";
        const esLine = esSerPassiveWithTail(v, t.kind, m.key, p, subjPas.es, tailES);
        const enHTML = colorizeConjugation(en, t.kind, m.key, p, v, "passive");

        html += `
          <tr>
            <td class="en-col">
              <button class="btn-listen" type="button" data-say="${encodeURIComponent(en)}">🔊</button>
              <span class="en">${enHTML}</span>
              <div class="es">${esLine}</div>
            </td>
          </tr>`;
      });

      html += `</tbody></table>
      </div>`;
    });

    html += `</div>`;
  });

  // ✅ Tips de pasiva
  if(voiceMode==="passive" && passiveOk){
    html += `
      <div class="warn" style="margin-top:12px;">
        ✅ Tip pasiva: si el sujeto pasivo es plural, usa <b>are / were / have been</b>. Si es singular, usa <b>is / was / has been</b>.
        <br/>Objeto usado como sujeto: <b>${subjPas.en}</b>.
      </div>
    `;
  }

  document.getElementById('tablas').innerHTML = html;
  bindListenButtons();
}

/* ===========================
   PRACTICE + READING (ACTIVE / PASSIVE)
   =========================== */
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function pickDistractors(field, avoidSet, n=3){
  const pool = activeDB
    .map(v=>String(v[field]||"").trim())
    .filter(x=>x && !avoidSet.has(normalizeAns(x)));
  const uniq = [...new Set(pool.map(normalizeAns))];
  const sample = shuffle(uniq).slice(0,n);
  return sample;
}
function practiceKeyFor(v, qid){
  return `${voiceMode}|${currentRound}|${v.g}|${v.d}|${v.c1}|${qid}`;
}

function connectKeyFor(v){
  // Clave única por verbo/round/voz/grupo/día para evitar sumar XP repetidamente en el mismo reto
  const c1 = String(v?.c1||"").toLowerCase().trim();
  return `${voiceMode}|${currentRound}|${v.g}|${v.d}|${c1}`;
}
function addConnectXP(v){
  // ✅ Solo 10 XP por verbo correcto
  return awardXP(10, "connect");
}

function addSpellingXP(v){
  // ✅ Solo 10 XP por verbo correcto
  return awardXP(10, "spelling");
}

function spellKeyFor(v){
  const c1 = String(v?.c1||"").toLowerCase().trim();
  return `${voiceMode}|${currentRound}|${v.g}|${v.d}|${c1}|SPELL`;
}
function addPracticeXP(v, qid){
  // ✅ Repetible: cada respuesta correcta suma XP (sin límite por pregunta)
  awardXP(PRACTICE_XP, "practice");
  bumpMastery(v.c1, 1); // práctica también sube dominio
  return true;
}
function setPracticeMsg(qid, html, ok){
  const el = document.getElementById(`pmsg-${qid}`);
  if(!el) return;
  el.innerHTML = html;
  if(ok===true) el.style.color = "var(--success)";
  else if(ok===false) el.style.color = "var(--error)";
  else el.style.color = "#0f172a";
}
function replaceWordOnce(sentence, from, to){
  const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  return sentence.replace(re, to);
}
function variantsByReplacingWord(sentence, primary, alts){
  const all = [primary, ...(Array.isArray(alts)?alts:[])].map(x=>String(x||"").trim()).filter(Boolean);
  const uniq = [...new Set(all)];
  return uniq.map(form => replaceWordOnce(sentence, primary, form));
}
function makeExpectedSet(sentences){
  const set = new Set();
  sentences.forEach(s=>set.add(normalizeSentence(s)));
  return set;
}

function renderPractice(v){
  const passiveOk = passiveAllowed(v);
  const subjPas = subjForPassive(v);

  // opciones C2/C3
  const correctPast = getOptions(v.c2, v.alt2);
  const correctPart = getOptions(v.c3, v.alt3);

  const avoidPast = new Set(correctPast);
  const distractPast = pickDistractors("c2", avoidPast, 3);
  const q1Options = shuffle([...correctPast.slice(0,1), ...distractPast]);

  const agentP = PRON[0]; // I
  const agentKey = agentP.key;

  // MODELOS (EN)
  let modelEN = {};
  if(voiceMode==="active" || (voiceMode==="passive" && !passiveOk)){
    const comp = getComplement(v);
    const pI = PRON[0];
    const pShe = PRON[3];
    const pThey = PRON[7];
    const pWe = PRON[5];
    const pHe = PRON[2];
    const pYou = PRON[1];

    const en4Base = (currentRound===2)
      ? `${enWithComplement(makePast(pI,v), comp.en)} yesterday.`
      : `${makePast(pI,v)} yesterday.`;

    const en5Base = (currentRound===2)
      ? `${enWithComplement(makePresentNeg(pShe,v), comp.en)} every day.`
      : `${makePresentNeg(pShe,v)} every day.`;

    const en6Base = (currentRound===2)
      ? enWithComplement(makePresentQ(pThey,v), comp.en)
      : makePresentQ(pThey,v);

    const en7Base = (currentRound===2)
      ? `${enWithComplement(makePP(pWe,v), comp.en)} already.`
      : `${makePP(pWe,v)} already.`;

    const en8Base = (currentRound===2)
      ? `${enWithComplement(makePPNeg(pHe,v), comp.en)}.`
      : `${makePPNeg(pHe,v)}.`;

    const en9Base = (currentRound===2)
      ? enWithComplement(makePastQ(pYou,v).replace("?", " last night?"), comp.en)
      : makePastQ(pYou,v).replace("?", " last night?");

    const en4Variants = variantsByReplacingWord(en4Base, v.c2, v.alt2);
    const en7Variants = variantsByReplacingWord(en7Base, v.c3, v.alt3);
    const en8Variants = variantsByReplacingWord(en8Base, v.c3, v.alt3);

    modelEN = {
      q4Expected: makeExpectedSet([en4Base, ...en4Variants]),
      q5Expected: makeExpectedSet([en5Base]),
      q6Expected: makeExpectedSet([en6Base]),
      q7Expected: makeExpectedSet([en7Base, ...en7Variants]),
      q8Expected: makeExpectedSet([en8Base, ...en8Variants]),
      q9Expected: makeExpectedSet([en9Base]),
      es: (function(){
        const comp = getComplement(v);
        const pI = PRON[0];
        const pShe = PRON[3];
        const pThey = PRON[7];
        const pWe = PRON[5];
        const pHe = PRON[2];
        const pYou = PRON[1];

        const addTailEs = (line, tail)=>{
          line = String(line||"").replace(/\s+/g," ").trim();
          tail = String(tail||"").trim();
          if(!tail) return line;
          // insertar antes de '?'
          if(line.endsWith("?")){
            const base = line.slice(0,-1).trim();
            tail = tail.replace(/[?]+$/,"").trim();
            return (base + " " + tail + "?").replace(/\s+/g," ").trim();
          }
          return (line + " " + tail).replace(/\s+/g," ").trim();
        };
        const ensurePeriodEs = (line)=>{
          line = String(line||"").trim();
          if(!line) return line;
          if(/[\.!?]$/.test(line)) return line;
          return line + ".";
        };

        return {
          4: ensurePeriodEs(addTailEs(buildSpanishActiveLine("S","A", pI,   v, comp), "ayer")),
          5: ensurePeriodEs(addTailEs(buildSpanishActiveLine("P","N", pShe, v, comp), "todos los días")),
          6: addTailEs(buildSpanishActiveLine("P","Q", pThey, v, comp), ""), // sin cola
          7: ensurePeriodEs(addTailEs(buildSpanishActiveLine("PP","A", pWe, v, comp), "ya")),
          8: ensurePeriodEs(addTailEs(buildSpanishActiveLine("PP","N", pHe, v, comp), "")),
          9: addTailEs(buildSpanishActiveLine("S","Q", pYou, v, comp), "anoche")
        };
      })()
    };
  } else {
    // PASIVA
    const sEN = subjPas.en;
    const plural = isProbablyPluralEN(sEN);
    const beP = bePresentFor(plural);
    const beS = bePastFor(plural);
    const have = haveFor(plural);

    const byMe = "by me";

    const en4Base = `${sEN} ${beS} ${v.c3} ${byMe} yesterday.`;
    const en5Base = `${sEN} ${(beP==="is"?"isn't":"aren't")} ${v.c3} ${byMe} every day.`;
    const en6Base = `${capFirst(beP)} ${sEN.toLowerCase()} ${v.c3} ${byMe}?`;
    const en7Base = `${sEN} ${have} been ${v.c3} ${byMe} already.`;
    const en8Base = `${sEN} ${(have==="has"?"hasn't":"haven't")} been ${v.c3} ${byMe}.`;
    const en9Base = `${capFirst(beS)} ${sEN.toLowerCase()} ${v.c3} ${byMe} last night?`;

    const en4Variants = variantsByReplacingWord(en4Base, v.c3, v.alt3);
    const en7Variants = variantsByReplacingWord(en7Base, v.c3, v.alt3);
    const en8Variants = variantsByReplacingWord(en8Base, v.c3, v.alt3);

    modelEN = {
      q4Expected: makeExpectedSet([en4Base, ...en4Variants]),
      q5Expected: makeExpectedSet([en5Base]),
      q6Expected: makeExpectedSet([en6Base]),
      q7Expected: makeExpectedSet([en7Base, ...en7Variants]),
      q8Expected: makeExpectedSet([en8Base, ...en8Variants]),
      q9Expected: makeExpectedSet([en9Base]),
      es: {
        4: esSerPassiveWithTail(v, "S",  "A", PRON[0], subjPas.es, "ayer"),
        5: esSerPassiveWithTail(v, "P",  "N", PRON[0], subjPas.es, "todos los días"),
        6: esSerPassiveWithTail(v, "P",  "Q", PRON[0], subjPas.es, ""),
        7: esSerPassiveWithTail(v, "PP", "A", PRON[0], subjPas.es, "ya"),
        8: esSerPassiveWithTail(v, "PP", "N", PRON[0], subjPas.es, ""),
        9: esSerPassiveWithTail(v, "S",  "Q", PRON[0], subjPas.es, "anoche")
      }
    };
  }

  practiceState = {
    v,
    passiveOk,
    q1: { correct: new Set(correctPast), options: q1Options },
    q2: { correct: new Set(correctPart) }, // C3
    q3: { correct: (voiceMode==="passive" && passiveOk) ? new Set(correctPart) : new Set(correctPast) }, // en pasiva: C3; en activa: C2
    q4: { expected: modelEN.q4Expected },
    q5: { expected: modelEN.q5Expected },
    q6: { expected: modelEN.q6Expected },
    q7: { expected: modelEN.q7Expected },
    q8: { expected: modelEN.q8Expected },
    q9: { expected: modelEN.q9Expected },
    es: modelEN.es,
    subjPas
  };

  const verbName = `${v.c1.toUpperCase()} (${v.esp})`;
  const badgeText = (voiceMode==="passive" && passiveOk) ? "PASIVA" : "ACTIVA";

  // Enunciados de fill blanks (2 y 3)
  let q2Line = "";
  let q3Line = "";

  if(voiceMode==="passive" && passiveOk){
    const sEN = subjPas.en;
    const plural = isProbablyPluralEN(sEN);
    const have = haveFor(plural);
    const beS = bePastFor(plural);
    q2Line = `${sEN} ${have} been <span style="color:var(--primary);font-weight:950;">____</span> by me.`;
    q3Line = `${sEN} ${beS} <span style="color:var(--primary);font-weight:950;">____</span> by me yesterday.`;
  } else {
    const comp = getComplement(v);
    q2Line = `I have <span style="color:var(--primary);font-weight:950;">____</span> ${currentRound===2 ? comp.en : "this verb"}.`;
    q3Line = `I <span style="color:var(--primary);font-weight:950;">____</span> ${currentRound===2 ? comp.en : ""} yesterday.`;
  }

  const notePassive = (voiceMode==="passive" && !passiveOk)
    ? `<div class="warn" style="margin:0 0 10px;">⚠️ Este verbo no se usa naturalmente en pasiva. En PRACTICE se trabajará en VOZ ACTIVA para no romper la gramática.</div>`
    : "";

  const html = `
    ${notePassive}
    <div class="practice-head">
      <div class="practice-title">🎯 PRACTICE (${badgeText}) — verbo <b>${verbName}</b></div>
      <div class="practice-badge">+${PRACTICE_XP} XP por acierto</div>
    </div>

    <div class="practice-grid">
      <div class="p-card">
        <div class="p-q">1) Selecciona la forma correcta (C2) de: <b>${v.c1}</b></div>
        <select class="p-select" id="p1">
          <option value="">— Elige una opción —</option>
          ${q1Options.map(o=>`<option value="${o}">${o}</option>`).join("")}
        </select>
        <div class="p-actions">
          <button class="p-btn" type="button" onclick="checkPractice(1)">REVISAR ✅</button>
          <div class="p-msg" id="pmsg-1"></div>
        </div>
        <div class="p-sub">Si hay alternativa aceptada, también cuenta.</div>
      </div>

      <div class="p-card">
        <div class="p-q">2) Completa la oración:</div>
        <div class="p-q" style="background:#fff;border:2px dashed #e2e8f0;border-radius:14px;padding:12px;">
          ${q2Line}
        </div>
        <input class="p-input" id="p2" placeholder="Escribe la palabra que falta" autocomplete="off" />
        <div class="p-actions">
          <button class="p-btn" type="button" onclick="checkPractice(2)">REVISAR ✅</button>
          <div class="p-msg" id="pmsg-2"></div>
        </div>
        <div class="p-sub">${(voiceMode==="passive" && passiveOk) ? "En pasiva se usa V3 (C3)." : "Acepta alternativas cuando existan."}</div>
      </div>

      <div class="p-card">
        <div class="p-q">3) Completa la oración:</div>
        <div class="p-q" style="background:#fff;border:2px dashed #e2e8f0;border-radius:14px;padding:12px;">
          ${q3Line}
        </div>
        <input class="p-input" id="p3" placeholder="Escribe la palabra que falta" autocomplete="off" />
        <div class="p-actions">
          <button class="p-btn" type="button" onclick="checkPractice(3)">REVISAR ✅</button>
          <div class="p-msg" id="pmsg-3"></div>
        </div>
        <div class="p-sub">Objetivo: automatizar en contexto.</div>
      </div>
    </div>

    <div class="p-divider">🟣 6 ejercicios extra: Español ➜ Escríbelas en Inglés (${badgeText})</div>

    <div class="practice-grid">
      ${[4,5,6,7,8,9].map(n=>`
        <div class="p-card">
          <div class="p-q">${n}) Traduce al inglés:</div>
          <div class="p-q" style="background:#fff;border:2px dashed #e2e8f0;border-radius:14px;padding:12px;">
            ${practiceState.es[n]}
          </div>
          <input class="p-input" id="p${n}" placeholder="Escribe la oración en inglés" autocomplete="off" />
          <div class="p-actions">
            <button class="p-btn" type="button" onclick="checkPractice(${n})">REVISAR ✅</button>
            <div class="p-msg" id="pmsg-${n}"></div>
          </div>
          <div class="p-sub">Tip: no importa si pones punto o no (se normaliza).</div>
        </div>
      `).join("")}
    </div>
  `;

  document.getElementById("practiceArea").innerHTML = html;
  [1,2,3,4,5,6,7,8,9].forEach(q=>setPracticeMsg(q,"",null));
}

function checkPractice(qid){
  if(!practiceState || !practiceState.v) return;
  const v = practiceState.v;

  if(qid===1){
    const val = normalizeAns(document.getElementById("p1").value);
    if(!val){
      setPracticeMsg(1, "⚠️ Elige una opción.", false);
      playWrongSound();
      return;
    }
    const ok = practiceState.q1.correct.has(val);
    if(ok){
      const gained = addPracticeXP(v, 1);
      playCorrectSound();
      setPracticeMsg(1, gained ? `✅ Correcto. +${PRACTICE_XP} XP` : `✅ Correcto. (XP ya sumado)`, true);
    }else{
      playWrongSound();
      setPracticeMsg(1, `❌ Incorrecto. Respuesta: <b>${[...practiceState.q1.correct][0]}</b>`, false);
    }
    return;
  }

  if(qid===2){
    const val = normalizeAns(document.getElementById("p2").value);
    if(!val){
      setPracticeMsg(2, "⚠️ Escribe la palabra que falta.", false);
      playWrongSound();
      return;
    }
    const ok = practiceState.q2.correct.has(val);
    if(ok){
      const gained = addPracticeXP(v, 2);
      playCorrectSound();
      setPracticeMsg(2, gained ? `✅ Perfect! +${PRACTICE_XP} XP` : `✅ Perfect! (XP ya sumado)`, true);
    }else{
      playWrongSound();
      setPracticeMsg(2, `❌ No. Aceptado: <b>${[...practiceState.q2.correct].join(" / ")}</b>`, false);
    }
    return;
  }

  if(qid===3){
    const val = normalizeAns(document.getElementById("p3").value);
    if(!val){
      setPracticeMsg(3, "⚠️ Escribe la palabra que falta.", false);
      playWrongSound();
      return;
    }
    const ok = practiceState.q3.correct.has(val);
    if(ok){
      const gained = addPracticeXP(v, 3);
      playCorrectSound();
      setPracticeMsg(3, gained ? `✅ Bien. +${PRACTICE_XP} XP` : `✅ Bien. (XP ya sumado)`, true);
    }else{
      playWrongSound();
      setPracticeMsg(3, `❌ Incorrecto. Aceptado: <b>${[...practiceState.q3.correct].join(" / ")}</b>`, false);
    }
    return;
  }

  if(qid>=4 && qid<=9){
    const raw = document.getElementById(`p${qid}`).value;
    const val = normalizeSentence(raw);
    if(!val){
      setPracticeMsg(qid, "⚠️ Escribe la oración en inglés.", false);
      playWrongSound();
      return;
    }
    const expected = practiceState[`q${qid}`].expected;
    const ok = expected.has(val);

    if(ok){
      const gained = addPracticeXP(v, qid);
      playCorrectSound();
      setPracticeMsg(qid, gained ? `✅ Correcto. +${PRACTICE_XP} XP` : `✅ Correcto. (XP ya sumado)`, true);
    }else{
      playWrongSound();
      setPracticeMsg(qid, `❌ No coincide. Revisa estructura (modelo).`, false);
    }
    return;
  }
}

/* ===========================
   📚 READING STORY (ACTIVE / PASSIVE) + TRANSLATE
   - Solo para la sección Reading (debajo de la tabla Reading)
   =========================== */
let readingStoryTranslationVisible = false;

function hashStr(s){
  s = String(s||"");
  let h = 0;
  for(let i=0;i<s.length;i++){
    h = (h*31 + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

function wrapTense(word, tense){
  // tense: "present" | "past" | "perfect"
  const colorVar = (tense==="past") ? "--c2" : (tense==="perfect") ? "--c3" : "--c1";
  return `<span style="color:var(${colorVar}); font-weight:950;">${String(word||"")}</span>`;
}

function pickStoryContext(key){
  const contexts = [
    {
      en:{place:"in the classroom", when:"before the bell rings", twist:"a timer is running", closing:"the ranking moves up"},
      es:{place:"en el salón", when:"antes de que suene el timbre", twist:"hay un cronómetro corriendo", closing:"el ranking sube"}
    },
    {
      en:{place:"at home", when:"after dinner", twist:"a small mistake happens", closing:"I try again with calm"},
      es:{place:"en casa", when:"después de la cena", twist:"pasa un pequeño error", closing:"lo intento otra vez con calma"}
    },
    {
      en:{place:"in the library", when:"during a quiet break", twist:"a friend asks for help", closing:"we learn together"},
      es:{place:"en la biblioteca", when:"durante un descanso tranquilo", twist:"un amigo pide ayuda", closing:"aprendemos juntos"}
    },
    {
      en:{place:"in the playground", when:"between classes", twist:"the phone battery is low", closing:"I stay focused anyway"},
      es:{place:"en el patio", when:"entre clases", twist:"la batería del celular está baja", closing:"me mantengo enfocado de todos modos"}
    },
    {
      en:{place:"in the computer lab", when:"during practice time", twist:"the internet is slow", closing:"I keep practicing offline"},
      es:{place:"en la sala de informática", when:"durante el tiempo de práctica", twist:"el internet está lento", closing:"sigo practicando sin internet"}
    }
  ];
  const i = hashStr(key) % contexts.length;
  return contexts[i];
}

// --- Mini helpers de español (aprox. regular) para la traducción de la historia ---
function esInfFrom(v){
  // intenta tomar el infinitivo principal (primera palabra)
  const raw = String((v && v.esp) ? v.esp : "").trim();
  if(!raw) return "hacer";
  return raw.split(/[;,/]/)[0].trim().split(/\s+/)[0].toLowerCase();
}
function esStem(inf){ return inf.slice(0, -2); }
function esPresentYo(inf){
  inf = String(inf||"").toLowerCase().trim();

  // Irregulares frecuentes (yo)
  const irregular = {
    "ser":"soy",
    "ir":"voy",
    "estar":"estoy",
    "tener":"tengo",
    "venir":"vengo",
    "poner":"pongo",
    "hacer":"hago",
    "salir":"salgo",
    "traer":"traigo",
    "ver":"veo",
    "dar":"doy",
    "saber":"sé",
    "conocer":"conozco",
    "decir":"digo",
    "oír":"oigo",
    "seguir":"sigo",
    "pedir":"pido",
    "servir":"sirvo",
    "repetir":"repito",
    "conducir":"conduzco",
    "traducir":"traduzco",
    "producir":"produzco"
  };
  if(irregular[inf]) return irregular[inf];

  // Regulares
  if(inf.endsWith("ar")||inf.endsWith("er")||inf.endsWith("ir")) return esStem(inf)+"o";
  return inf;
}
function esPreteriteYo(inf){
  inf = String(inf||"").toLowerCase().trim();

  // Irregulares frecuentes (yo) en pretérito perfecto simple
  const irregular = {
    "ser":"fui",
    "ir":"fui",
    "estar":"estuve",
    "tener":"tuve",
    "poder":"pude",
    "poner":"puse",
    "venir":"vine",
    "decir":"dije",
    "hacer":"hice",
    "ver":"vi",
    "dar":"di",
    "saber":"supe",
    "querer":"quise",
    "traer":"traje",
    "conducir":"conduje",
    "traducir":"traduje",
    "producir":"produje",
    "andar":"anduve",
    "caber":"cupe",
    "haber":"hube",
    "leer":"leí",
    "oír":"oí",
    "caer":"caí",
    "reír":"reí",
    "creer":"creí"
  };
  if(irregular[inf]) return irregular[inf];

  // Cambios ortográficos en -car/-gar/-zar (yo)
  if(inf.endsWith("car")) return inf.slice(0,-3)+"qué";
  if(inf.endsWith("gar")) return inf.slice(0,-3)+"gué";
  if(inf.endsWith("zar")) return inf.slice(0,-3)+"cé";

  // Regulares
  if(inf.endsWith("ar")) return esStem(inf)+"é";
  if(inf.endsWith("er")||inf.endsWith("ir")) return esStem(inf)+"í";
  return inf;
}
function esParticipleInf(inf){
  inf = String(inf||"").toLowerCase().trim();

  // Participios irregulares (Colombia/Español estándar)
  const irregular = {
    "abrir":"abierto",
    "cubrir":"cubierto",
    "descubrir":"descubierto",
    "decir":"dicho",
    "escribir":"escrito",
    "freir":"frito",
    "freír":"frito",
    "hacer":"hecho",
    "morir":"muerto",
    "poner":"puesto",
    "resolver":"resuelto",
    "romper":"roto",
    "ver":"visto",
    "volver":"vuelto",
    "satisfacer":"satisfecho",
    "imprimir":"impreso",
    "proveer":"provisto",
    "prever":"previsto",
    "reponer":"repuesto"
  };
  if(irregular[inf]) return irregular[inf];

  // Participios con tilde (hiato)
  const accented = {
    "leer":"leído",
    "creer":"creído",
    "caer":"caído",
    "oír":"oído",
    "reír":"reído",
    "traer":"traído"
  };
  if(accented[inf]) return accented[inf];

  if(inf.endsWith("ar")) return esStem(inf)+"ado";
  if(inf.endsWith("er")||inf.endsWith("ir")) return esStem(inf)+"ido";
  return inf;
}
function capFirstSafe(s){
  s = String(s||"").trim();
  if(!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function getReadingStory(mode, v){
  // mode: "active" | "passive"
  // v: verbo actual {c1,c2,c3,esp}
  v = v || (window.current && window.current[window.idx]) || (typeof current!=="undefined" ? current[idx] : null) || {c1:"do",c2:"did",c3:"done",esp:"hacer"};
  const comp = getComplement(v);
  const subjPas = subjForPassive(v);
  const ctx = pickStoryContext(v.c1);

  // Protagonista (EN) con colores por columna (C1/C2/C3) y exponente.
  // En la historia: Past Simple negativa/interrogativa usa base verb (C1).
  const pickStoryForm = (txt) => {
    if(txt == null) return "";
    const s = String(txt).trim();
    // Si hay variantes tipo "got / gotten", usa la primera para que suene natural.
    if(s.includes("/")) return s.split("/")[0].trim();
    return s;
  };

  const c1 = pickStoryForm(v.c1);
  const c2 = pickStoryForm(v.c2);
  const c3 = pickStoryForm(v.c3);

  const vC1 = wrapWithExp(c1, "v-c1", "C1");
  const vC2 = wrapWithExp(c2, "v-c2", "C2");
  const vC3 = wrapWithExp(c3, "v-c3", "C3");

  const vPres  = vC1;
  const vPast  = vC2;
  const vPastB = vC1;  // did/didn't + base
  const vPerf  = vC3;  // have/has + V3

  // En pasiva (EN): siempre V3 (C3)
  const vP_pres = vC3;
  const vP_past = vC3;
  const vP_perf = vC3;

  // Protagonista (ES) en 1ra persona singular (yo)
  const inf = String(v.esp||"hacer").toLowerCase().trim();
  const esPres = wrapTense(esPresentYo(inf), "present");
  const esPast = wrapTense(esPreteriteYo(inf), "past");
  const esPart = esParticipleInf(inf);
  const esPerf = wrapTense(esPart, "perfect");

  // Verbos "secundarios" para darle coherencia (no se colorean)
  const sideSets = [
    {en:["review","underline","compare"], es:["repaso","subrayo","comparo"]},
    {en:["focus","breathe","try again"], es:["me enfoco","respiro","lo intento de nuevo"]},
    {en:["take notes","ask for help","share"], es:["tomo apuntes","pido ayuda","comparto"]},
    {en:["listen","repeat","check"], es:["escucho","repito","verifico"]},
    {en:["connect ideas","reflect","improve"], es:["conecto ideas","reflexiono","mejoro"]}
  ];
  const side = sideSets[hashStr(v.c1) % sideSets.length];

  // Helpers ES para pasiva (simple)
  const isProbablyPluralES = (s)=>{
    s = String(s||"").toLowerCase().trim();
    return s.startsWith("los ") || s.startsWith("las ") || s.startsWith("unos ") || s.startsWith("unas ") || /\b(s|es)\b$/.test(s);
  };
  const beESPresentFor = (plural)=> plural ? "son" : "es";
  const beESPastFor    = (plural)=> plural ? "fueron" : "fue";
  const haberESFor     = (plural)=> plural ? "han" : "ha";

  if(mode === "passive"){
    const sEN = subjPas.en; // p.ej. "The homework"
    const pluralEN = isProbablyPluralEN(sEN);
    const beP = bePresentFor(pluralEN);
    const beS = bePastFor(pluralEN);
    const have = haveFor(pluralEN);

    const pluralES = isProbablyPluralES(subjPas.es);
    const esBeP = beESPresentFor(pluralES);
    const esBeS = beESPastFor(pluralES);
    const esH = haberESFor(pluralES);

    return {
      en: [
        `In the morning ${ctx.en.place}, practice is started and the verb <b>${vP_pres}</b> becomes the protagonist. ${sEN} ${beP} ${vP_pres} by me ${ctx.en.when}.`,
        `${capFirst(beP)} ${sEN.toLowerCase()} ${vP_pres} by me with purpose? Yes. But ${sEN.toLowerCase()} ${beP==="is"?"isn't":"aren't"} ${vP_pres} by me while I’m distracted—I ${side.en[0]}, I ${side.en[1]}, and I stay focused.`,
        `Yesterday, a mini challenge happened and ${ctx.en.twist}. ${sEN} ${beS} ${vP_past} by me, and the mistake was turned into a lesson.`,
        `${capFirst(beS)} ${sEN.toLowerCase()} ${vP_past} by me perfectly? Not always. But was ${sEN.toLowerCase()} ${vP_past} by me again with calm? Yes—and XP was earned.`,
        `This week, a stronger habit has grown: ${sEN} ${have} been ${vP_perf} by me many times. It ${have==="has"?"hasn't":"haven't"} been ${vP_perf} in a rush.`,
        `${capFirst(have)} ${sEN.toLowerCase()} been ${vP_perf} by me with real focus? Yes. The story closes: ${ctx.en.closing}.`
      ],
      es: [
        `En la mañana ${ctx.es.place}, se inicia la práctica y el verbo <b>${wrapTense(esPart, "perfect")}</b> se vuelve el protagonista. ${capFirstSafe(subjPas.es)} ${esBeP} ${wrapTense(esPart, "perfect")} por mí ${ctx.es.when}.`,
        `¿${capFirstSafe(subjPas.es)} ${esBeP} ${wrapTense(esPart, "perfect")} por mí con intención? Sí. Pero ${subjPas.es} no ${esBeP} ${wrapTense(esPart, "perfect")} por mí cuando me distraigo: ${side.es[0]}, ${side.es[1]} y sigo enfocado.`,
        `Ayer pasó un mini reto y ${ctx.es.twist}. ${capFirstSafe(subjPas.es)} ${esBeS} ${wrapTense(esPart, "perfect")} por mí, y el error se convirtió en aprendizaje.`,
        `¿${capFirstSafe(subjPas.es)} ${esBeS} ${wrapTense(esPart, "perfect")} por mí perfecto? No siempre. Pero ¿${capFirstSafe(subjPas.es)} ${esBeS} ${wrapTense(esPart, "perfect")} por mí otra vez con calma? Sí, y gané XP.`,
        `Esta semana ha crecido un hábito más fuerte: ${capFirstSafe(subjPas.es)} ${esH} sido ${wrapTense(esPart, "perfect")} por mí muchas veces. No ${esH} sido ${wrapTense(esPart, "perfect")} a la carrera.`,
        `¿${capFirstSafe(subjPas.es)} ${esH} sido ${wrapTense(esPart, "perfect")} por mí con verdadera concentración? Sí. La historia cierra: ${ctx.es.closing}.`
      ]
    };
  }

  // --- Voz activa ---
  return {
    en: [
      `In the morning ${ctx.en.place}, the verb <b>${vPres}</b> becomes the protagonist of my practice. I ${vPres} ${comp.en} ${ctx.en.when}.`,
      `I do not ${vPres} ${comp.en} while I’m distracted. Do I ${vPres} ${comp.en} with purpose? Yes—I ${side.en[0]}, I ${side.en[1]}, and I stay on task.`,
      `Yesterday, a mini challenge happened and ${ctx.en.twist}. I ${vPast} ${comp.en} carefully, and I ${side.en[2]}.`,
      `I didn't ${vPastB} ${comp.en} perfectly at first. Did I ${vPastB} ${comp.en} again with calm? Yes—and the mistake became a lesson.`,
      `This week, I have ${vPerf} ${comp.en} many times. I haven't ${vPerf} ${comp.en} in a rush.`,
      `Have I ${vPerf} ${comp.en} with real focus? Yes. Now the story closes: ${ctx.en.closing}.`
    ],
    es: [
      `En la mañana ${ctx.es.place}, el verbo <b>${esPres}</b> se vuelve el protagonista de mi práctica. Yo ${esPres} ${comp.es} ${ctx.es.when}.`,
      `Yo no ${esPres} ${comp.es} cuando estoy distraído. ¿${esPres} ${comp.es} con intención? Sí: ${side.es[0]}, ${side.es[1]} y me mantengo en lo mío.`,
      `Ayer pasó un mini reto y ${ctx.es.twist}. Yo ${esPast} ${comp.es} con cuidado, y ${side.es[2]}.`,
      `Al principio no ${esPast} ${comp.es} perfecto. ¿${esPast} ${comp.es} otra vez con calma? Sí, y el error se volvió aprendizaje.`,
      `Esta semana he ${esPerf} ${comp.es} muchas veces. No he ${esPerf} ${comp.es} a la carrera.`,
      `¿He ${esPerf} ${comp.es} con verdadera concentración? Sí. Ahora la historia cierra: ${ctx.es.closing}.`
    ]
  };
}

let _readingStoryUtterance = null;
let _readingStoryRate = 0.85; // Default story audio speed

function updateReadingStoryRateLabel(){
  const el = document.getElementById("readingStoryRateLabel");
  if(!el) return;
  const r = Math.round(_readingStoryRate * 100) / 100;
  el.textContent = `${r}x`;
}

function changeReadingStoryRate(delta){
  const r = Math.round((_readingStoryRate + delta) * 100) / 100;
  _readingStoryRate = Math.max(0.55, Math.min(1.2, r));
  updateReadingStoryRateLabel();
  // If it's currently speaking, restart with the new speed.
  try{
    if(typeof speechSynthesis !== "undefined" && (speechSynthesis.speaking || speechSynthesis.pending)){
      speakReadingStory();
    }
  }catch(_e){}
}

function resetReadingStoryRate(){
  _readingStoryRate = 0.85;
  updateReadingStoryRateLabel();
  try{
    if(typeof speechSynthesis !== "undefined" && (speechSynthesis.speaking || speechSynthesis.pending)){
      speakReadingStory();
    }
  }catch(_e){}
}
function _pickEnglishVoice(){
  if(typeof speechSynthesis === "undefined") return null;
  const voices = speechSynthesis.getVoices ? speechSynthesis.getVoices() : [];
  if(!voices || !voices.length) return null;
  const pref = [
    v => /^en-US/i.test(v.lang),
    v => /^en-GB/i.test(v.lang),
    v => /^en/i.test(v.lang),
  ];
  for(const f of pref){
    const found = voices.find(f);
    if(found) return found;
  }
  return voices[0] || null;
}
function speakReadingStory(){
  try{
    if(typeof speechSynthesis === "undefined") return;
    stopReadingStory();
    const el = document.getElementById("readingStoryEnglish");
    if(!el) return;
    let text = (el.textContent || "").replace(/\s+/g," ").trim();
    // Avoid speaking the visual C1/C2/C3 exponents.
    text = text.replace(/C[123]/gi, "").replace(/\s+/g, " ").trim();
    if(!text) return;

    const u = new SpeechSynthesisUtterance(text);
    const voice = _pickEnglishVoice();
    if(voice) u.voice = voice;
    u.lang = (voice && voice.lang) ? voice.lang : "en-US";
    // ✅ Beginner-friendly speed (slower, clearer)
    // Keep punctuation intact so the browser can pause naturally.
    u.rate = _readingStoryRate;
    u.pitch = 1;

    _readingStoryUtterance = u;

    const playBtn = document.getElementById("btnReadingAudio");
    const pauseBtn = document.getElementById("btnReadingAudioPause");
    const stopBtn = document.getElementById("btnReadingAudioStop");
    if(playBtn) playBtn.disabled = true;
    if(pauseBtn){ pauseBtn.disabled = false; pauseBtn.textContent = "⏸ Pause"; }
    if(stopBtn) stopBtn.disabled = false;

    u.onend = () => {
      const pb = document.getElementById("btnReadingAudio");
      const pab = document.getElementById("btnReadingAudioPause");
      const sb = document.getElementById("btnReadingAudioStop");
      if(pb) pb.disabled = false;
      if(sb) sb.disabled = true;
      if(pab){ pab.disabled = true; pab.textContent = "⏸ Pause"; }
      _readingStoryUtterance = null;
    };
    u.onerror = () => {
      const pb = document.getElementById("btnReadingAudio");
      const pab = document.getElementById("btnReadingAudioPause");
      const sb = document.getElementById("btnReadingAudioStop");
      if(pb) pb.disabled = false;
      if(sb) sb.disabled = true;
      if(pab){ pab.disabled = true; pab.textContent = "⏸ Pause"; }
      _readingStoryUtterance = null;
    };

    speechSynthesis.speak(u);
  }catch(e){}
}
function stopReadingStory(){
  try{
    if(typeof speechSynthesis === "undefined") return;
    if(speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  }catch(e){}
  const playBtn = document.getElementById("btnReadingAudio");
  const pauseBtn = document.getElementById("btnReadingAudioPause");
  const stopBtn = document.getElementById("btnReadingAudioStop");
  if(playBtn) playBtn.disabled = false;
  if(pauseBtn){ pauseBtn.disabled = true; pauseBtn.textContent = "⏸ Pause"; }
  if(stopBtn) stopBtn.disabled = true;
  _readingStoryPaused = false;
  _readingStoryUtterance = null;
}


function togglePauseReadingStory(){
  try{
    if(typeof speechSynthesis === "undefined") return;
    const pauseBtn = document.getElementById("btnReadingAudioPause");
    if(!_readingStoryUtterance) return;
    if(!(speechSynthesis.speaking || speechSynthesis.paused)) return;
    if(speechSynthesis.paused){
      speechSynthesis.resume();
      _readingStoryPaused = false;
      if(pauseBtn) pauseBtn.textContent = "⏸ Pause";
    }else{
      speechSynthesis.pause();
      _readingStoryPaused = true;
      if(pauseBtn) pauseBtn.textContent = "▶ Resume";
    }
  }catch(e){}
}

// Make sure voices are loaded on some browsers
try{
  if(typeof speechSynthesis !== "undefined"){
    speechSynthesis.onvoiceschanged = () => {};
  }
}catch(e){}

function toggleReadingStoryTranslation(){
  readingStoryTranslationVisible = !readingStoryTranslationVisible;
  const box = document.getElementById("readingStoryTranslation");
  if(box) box.style.display = readingStoryTranslationVisible ? "block" : "none";
  const btn = document.getElementById("btnReadingTranslate");
  if(btn) btn.textContent = readingStoryTranslationVisible ? "Hide Translation" : "Translate";
}

function renderReading(v){
  try{ stopReadingStory(); }catch(e){}
  const passiveOk = passiveAllowed(v);
  const verbName = `${v.c1.toUpperCase()} (${v.esp})`;
  const comp = getComplement(v);
  const subjPas = subjForPassive(v);

  const addTailEs = (line, tail)=>{
    line = String(line||"").replace(/\s+/g," ").trim();
    tail = String(tail||"").trim();
    if(!tail) return line;
    if(line.endsWith("?")){
      const base = line.slice(0,-1).trim();
      tail = tail.replace(/[?]+$/,"").trim();
      return (base + " " + tail + "?").replace(/\s+/g," ").trim();
    }
    return (line + " " + tail).replace(/\s+/g," ").trim();
  };
  const ensurePeriodEs = (line)=>{
    line = String(line||"").trim();
    if(!line) return line;
    if(/[\.!?]$/.test(line)) return line;
    return line + ".";
  };

  let en = [];
  let es = [];
  let meta = [];

  // 🔎 Control: en "READING" de VOZ PASIVA (cuando aplica), ocultamos traducción al español.
  const isPassiveReading = (voiceMode==="passive" && passiveOk);
  const showReadingSpanish = true;
if(voiceMode==="passive" && passiveOk){
    const sEN = subjPas.en;
    const plural = isProbablyPluralEN(sEN);
    const beP = bePresentFor(plural);
    const beS = bePastFor(plural);
    const have = haveFor(plural);

    const byMe = "by me";

    en = [
      `${sEN} ${beP} ${v.c3} ${byMe} today.`,
      `${sEN} ${(beP==="is"?"isn't":"aren't")} ${v.c3} ${byMe} today.`,
      `${capFirst(beP)} ${sEN.toLowerCase()} ${v.c3} ${byMe} today?`,

      `${sEN} ${beS} ${v.c3} ${byMe} yesterday.`,
      `${sEN} ${(beS==="was"?"wasn't":"weren't")} ${v.c3} ${byMe} yesterday.`,
      `${capFirst(beS)} ${sEN.toLowerCase()} ${v.c3} ${byMe} yesterday?`,

      `${sEN} ${have} been ${v.c3} ${byMe} this week.`,
      `${sEN} ${have} not been ${v.c3} ${byMe} this week.`,
      `${capFirst(have)} ${sEN.toLowerCase()} been ${v.c3} ${byMe} this week?`
    ];

    es = [
      esSerPassiveWithTail(v, "P",  "A", PRON[0], subjPas.es, "hoy"),
      esSerPassiveWithTail(v, "P",  "N", PRON[0], subjPas.es, "hoy"),
      esSerPassiveWithTail(v, "P",  "Q", PRON[0], subjPas.es, "hoy"),

      esSerPassiveWithTail(v, "S",  "A", PRON[0], subjPas.es, "ayer"),
      esSerPassiveWithTail(v, "S",  "N", PRON[0], subjPas.es, "ayer"),
      esSerPassiveWithTail(v, "S",  "Q", PRON[0], subjPas.es, "ayer"),

      esSerPassiveWithTail(v, "PP", "A", PRON[0], subjPas.es, "esta semana"),
      esSerPassiveWithTail(v, "PP", "N", PRON[0], subjPas.es, "esta semana"),
      esSerPassiveWithTail(v, "PP", "Q", PRON[0], subjPas.es, "esta semana")
    ].map(x=>x.replace(/\s+/g," ").trim());

    // meta (tKind/mood) para colorear C3 en pasiva
    meta = [
      {t:"P", m:"A", p:PRON[0]},
      {t:"P", m:"N", p:PRON[0]},
      {t:"P", m:"Q", p:PRON[0]},
      {t:"S", m:"A", p:PRON[0]},
      {t:"S", m:"N", p:PRON[0]},
      {t:"S", m:"Q", p:PRON[0]},
      {t:"PP", m:"A", p:PRON[0]},
      {t:"PP", m:"N", p:PRON[0]},
      {t:"PP", m:"Q", p:PRON[0]}
    ];

  } else {
    // Activa (o pasiva no aplicable)
    const pI = PRON[0];
    const pYou = PRON[1];

    const enRaw = [
      `${makePresent(pI,v)} today.`,
      `${makePresentNeg(pI,v)} today.`,
      makePresentQ(pYou,v).replace(/\?$/," today?"),

      `${makePast(pI,v)} yesterday.`,
      `${makePastNeg(pI,v)} yesterday.`,
      makePastQ(pYou,v).replace(/\?$/," yesterday?"),

      `${makePP(pI,v)} this week.`,
      `${makePPNeg(pI,v)} this week.`,
      makePPQ(pYou,v).replace(/\?$/," this week?")
    ];

    // ✅ Round 2: insertar complemento manteniendo el tiempo (today/yesterday/this week)
    en = (currentRound===2)
      ? enRaw.map(line => {
          const m = line.match(/\s(today|yesterday|this week)\.?$/i);
          if(m){
            const time = m[1];
            let core = line.replace(/\s(today|yesterday|this week)\.?$/i,"").trim();
            const isQ = core.endsWith("?");
            core = enWithComplement(core, comp.en);
            core = core.replace(/\?$/,"").trim();
            const tail = (time.toLowerCase()==="this week") ? " this week" : ` ${time.toLowerCase()}`;
            return isQ ? `${core}${tail}?` : `${core}${tail}.`.replace(/\.\./g,".");
          }
          return enWithComplement(line, comp.en);
        })
      : enRaw;

    // ✅ Español con conjugación real (misma lógica que Tablas)
    es = [
      ensurePeriodEs(addTailEs(buildSpanishActiveLine("P","A", pI, v, comp), "hoy")),
      ensurePeriodEs(addTailEs(buildSpanishActiveLine("P","N", pI, v, comp), "hoy")),
      addTailEs(buildSpanishActiveLine("P","Q", pYou, v, comp), "hoy"),

      ensurePeriodEs(addTailEs(buildSpanishActiveLine("S","A", pI, v, comp), "ayer")),
      ensurePeriodEs(addTailEs(buildSpanishActiveLine("S","N", pI, v, comp), "ayer")),
      addTailEs(buildSpanishActiveLine("S","Q", pYou, v, comp), "ayer"),

      ensurePeriodEs(addTailEs(buildSpanishActiveLine("PP","A", pI, v, comp), "esta semana")),
      ensurePeriodEs(addTailEs(buildSpanishActiveLine("PP","N", pI, v, comp), "esta semana")),
      addTailEs(buildSpanishActiveLine("PP","Q", pYou, v, comp), "esta semana")
    ].map(x=>x.replace(/\s+/g," ").trim());

    meta = [
      {t:"P", m:"A", p:pI},
      {t:"P", m:"N", p:pI},
      {t:"P", m:"Q", p:pYou},
      {t:"S", m:"A", p:pI},
      {t:"S", m:"N", p:pI},
      {t:"S", m:"Q", p:pYou},
      {t:"PP", m:"A", p:pI},
      {t:"PP", m:"N", p:pI},
      {t:"PP", m:"Q", p:pYou}
    ];
  }

  const modeUsed = (voiceMode==="passive" && passiveOk) ? "passive" : "active";
  const enHTML = en.map((line,i)=> colorizeConjugation(line, meta[i].t, meta[i].m, meta[i].p, v, modeUsed));

  const badgeText = (voiceMode==="passive" && passiveOk) ? "PASIVA" : "ACTIVA";

  const warnPassive = (voiceMode==="passive" && !passiveOk)
    ? `<div class="warn" style="margin-top:12px;">⚠️ Este verbo no se usa naturalmente en pasiva; READING se muestra en activa para mantener la gramática correcta.</div>`
    : "";

  // ✅ Historia para lectura contextual (se muestra según VOZ ACTIVA / PASIVA)
  const storyMode = (voiceMode === "passive") ? "passive" : "active";
  const story = getReadingStory(storyMode, v);
  const storyLabel = (storyMode === "passive") ? "Passive Voice" : "Active Voice";
  const translateBtnText = readingStoryTranslationVisible ? "Hide Translation" : "Translate";
  const translateDisplay = readingStoryTranslationVisible ? "block" : "none";
  const storyEN = (story?.en || []).map(p=>`<p style="margin:0 0 10px 0;">${p}</p>`).join("");
  const storyES = (story?.es || []).map(p=>`<p style="margin:0 0 10px 0;">${p}</p>`).join("");

  const html = `
    <div class="practice-head" style="margin-top:18px;">
      <div class="practice-title">📖 READING (${badgeText}) — práctica completa con <b>${verbName}</b></div>
      <div class="practice-badge">EN ➜ ES</div>
    </div>

    ${warnPassive}

    <div class="grid" style="grid-template-columns: 1fr;">
      <div class="card">
        <strong>🇺🇸 English (Primero)</strong>
        <table>
          ${en.map((line,i)=>`
            <tr>
              <td>
                <button class="btn-listen" type="button" data-say="${encodeURIComponent(line)}">🔊</button>
                <span class="en">${enHTML[i]}</span>
                ${showReadingSpanish ? `<span class="es">${es[i]}</span>` : ""}
              </td>
            </tr>
          `).join("")}
        </tbody></table>
        <div class="legend">${
          (voiceMode==="passive" && passiveOk)
            ? `Voz pasiva con sujeto-objeto: <b>${subjForPassive(v).en}</b>.<br/>Equivalencia recomendada en español: construcción con <b>“se”</b> (correcta y natural).`
            : `Incluye Presente, Pasado y Presente Perfecto (A/N/Q).<br/>Traducción debajo de cada oración (EN → ES).`
        }</div>
      </div>

      <!-- ✅ Lectura/HistorIa (mismo sentido en Active/Passive) + Translate -->
      <div class="card" style="margin-top:16px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
          <div style="font-weight:950; color:#0f172a;">📚 STORY (${storyLabel})</div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">${showReadingSpanish ? '<button class="roundbtn" id="btnReadingTranslate" type="button" onclick="toggleReadingStoryTranslation()" style="text-transform:none;">' + translateBtnText + '</button>' : ""}
            <button class="roundbtn" id="btnReadingRateDown" type="button" onclick="changeReadingStoryRate(-0.1)" title="Slower" style="text-transform:none;">🐢 −</button>
            <span id="readingStoryRateLabel" style="min-width:62px; text-align:center; font-weight:950; color:#fff; background:#1d4ed8; border:1px solid rgba(255,255,255,.25); padding:6px 10px; border-radius:12px; box-shadow:0 10px 20px rgba(0,0,0,.18);">${Math.round(_readingStoryRate*100)/100}x</span>
            <button class="roundbtn" id="btnReadingRateUp" type="button" onclick="changeReadingStoryRate(0.1)" title="Faster" style="text-transform:none;">🐇 +</button>
            <button class="roundbtn" id="btnReadingRateReset" type="button" onclick="resetReadingStoryRate()" title="Reset speed" style="text-transform:none;">↺</button>
            <button class="roundbtn" id="btnReadingAudio" type="button" onclick="speakReadingStory()" style="text-transform:none;">🔊 Play Audio</button>
            <button class="roundbtn" id="btnReadingAudioPause" type="button" disabled onclick="togglePauseReadingStory()" style="text-transform:none;">⏸ Pause</button>
            <button class="roundbtn" id="btnReadingAudioStop" type="button" disabled onclick="stopReadingStory()" style="text-transform:none;">⏹ Stop</button>
          </div>
        </div>

        <div id="readingStoryEnglish" style="margin-top:10px; color:#0f172a; line-height:1.6; font-weight:850;">
          ${storyEN}
        </div>
        ${showReadingSpanish ? `

        <div id="readingStoryTranslation" style="display:${translateDisplay}; margin-top:10px; padding-top:12px; border-top:1px dashed #cbd5e1;">
          <div style="font-weight:950; color:#334155; margin-bottom:8px;">🇪🇸 Español</div>
          <div style="color:#334155; line-height:1.6; font-weight:850;">${storyES}</div>
        </div>
` : ``}

        <div class="legend">
          Mismo contenido en <b>Active</b> y <b>Passive</b> (Presente Simple / Pasado Simple / Presente Perfecto).
          Incluye ejemplos <b>afirmativos</b>, <b>negativos</b> e <b>interrogativos</b> integrados en la historia.
        </div>
      </div>
    </div>
  `;

  document.getElementById("readingArea").innerHTML = html;
  bindListenButtons();
  const rn = document.getElementById("readingNav");
  if(rn) rn.style.display = "flex";
  const rnf = document.getElementById("readingNavFooter");
  if(rnf) rnf.style.display = "flex";
  const p2 = document.getElementById("progreso2");
  if(p2) p2.innerText = `${idx+1} de ${current.length}`;
  const p2f = document.getElementById("progreso2Footer");
  if(p2f) p2f.innerText = `${idx+1} de ${current.length}`;
}

/* ===========================
   RED NEURONAL (igual)
   =========================== */
function abrirAyuda(){
  const lista = current.map((v,i)=>`
    <div style="padding:8px 0; border-bottom:1px solid #e2e8f0;">
      <b>${String(i+1).padStart(2,"0")}.</b>
      <b>${v.c1.toUpperCase()}</b> — ${v.c1} / ${v.c2} / ${v.c3}
      <span style="color:#64748b">(${v.esp})</span>
      ${v.ex ? `<div style="margin-top:6px; color:#b91c1c; font-weight:900;">⚠ EXCEPCIÓN: ${v.ex}</div>` : ``}
      ${(v.alt2||v.alt3) ? `<div style="margin-top:6px; color:#0f172a; font-weight:900;">✅ Alternativas aceptadas: ${[
        ...(v.alt2?getOptions("",v.alt2).filter(Boolean):[]),
        ...(v.alt3?getOptions("",v.alt3).filter(Boolean):[])
      ].filter(Boolean).join(", ")}</div>` : ``}
      ${(currentRound===2) ? `<div style="margin-top:6px; color:#0b1220; font-weight:950;">🟣 Complemento: <span style="color:#0b1220; background:#fde68a; padding:2px 8px; border-radius:999px;">${getComplement(v).en}</span></div>` : ``}
      ${(voiceMode==="passive") ? `<div style="margin-top:6px; color:#0b1220; font-weight:950;">🟠 Pasiva: ${passiveAllowed(v) ? "BE + V3 (+ by agente)" : "No aplica natural (intransitivo)"}</div>` : ``}
    </div>
  `).join("");

  document.getElementById('ayuda').innerHTML = lista || "No hay verbos en este día.";
  document.getElementById('overlay').style.display="flex";
  syncModalOpen();
}
function cerrarAyuda(){
  document.getElementById('overlay').style.display="none";
  syncModalOpen();
}

window.addEventListener("load", async () => {
  // Sincroniza la base de verbos antes de iniciar la UI (Grupo/Día + Active/Passive)
  try { await ensureActiveDbFromVerbsHtml(); } catch (e) {}
  init();
  updateHudSafe();
});
window.addEventListener("resize", pinStatsBar);
window.addEventListener("scroll", pinStatsBar);

/* ===========================
   🐝 SPELLING YOGUS BEE (DELETREO C1/C2/C3)
   =========================== */
function uniqueList(arr){
  const seen = new Set();
  const out = [];
  (arr||[]).forEach(x=>{
    const s = String(x||"").trim();
    if(!s) return;
    const k = s.toLowerCase();
    if(seen.has(k)) return;
    seen.add(k);
    out.push(s);
  });
  return out;
}
function getSpellingPool(){
  // Pool preferido: verbos del día (current). Fallback: base activa.
  if(Array.isArray(current) && current.length) return current;
  return activeDB || [];
}

function pickRandomVerbForSpelling(){
  const pool = getSpellingPool();
  if(!Array.isArray(pool) || !pool.length) return null;
  if(pool.length === 1) {
    lastSpellPickKey = spellKeyFor(pool[0]);
    return pool[0];
  }
  // intenta evitar repetir el mismo verbo consecutivo
  for(let t=0; t<12; t++){
    const v = pool[Math.floor(Math.random()*pool.length)];
    const k = spellKeyFor(v);
    if(k && k !== lastSpellPickKey){
      lastSpellPickKey = k;
      return v;
    }
  }
  const v = pool[Math.floor(Math.random()*pool.length)];
  lastSpellPickKey = spellKeyFor(v);
  return v;
}

function initSpellingState(v){
  const pool = getSpellingPool();
  const c1Opts = shuffle(uniqueList(pool.map(x=>x.c1)));
  const c2Opts = shuffle(uniqueList(pool.map(x=>x.c2)));
  const c3Opts = shuffle(uniqueList(pool.map(x=>x.c3)));

  // Garantiza que el correcto esté dentro
  const must1 = String(v?.c1||"").trim();
  const must2 = String(v?.c2||"").trim();
  const must3 = String(v?.c3||"").trim();

  if(must1 && !c1Opts.some(x=>String(x).toLowerCase()===must1.toLowerCase())) c1Opts.unshift(must1);
  if(must2 && !c2Opts.some(x=>String(x).toLowerCase()===must2.toLowerCase())) c2Opts.unshift(must2);
  if(must3 && !c3Opts.some(x=>String(x).toLowerCase()===must3.toLowerCase())) c3Opts.unshift(must3);

  const randIndex = (n)=> Math.max(0, Math.min(n-1, Math.floor(Math.random()*n)));

  spellingState = {
    key: spellKeyFor(v),
    c1Opts, c2Opts, c3Opts,
    i1: randIndex(c1Opts.length),
    i2: randIndex(c2Opts.length),
    i3: randIndex(c3Opts.length)
  };
}
function renderSpelling(v){
  const area = document.getElementById("spellingArea");
  if(!area) return;

  // ✅ Aleatorio: al llegar a esta sección, el verbo se elige al azar (del pool del día)
  const target = pickRandomVerbForSpelling() || v || (Array.isArray(current) ? current[idx] : null);
  if(!target) return;

  initSpellingState(target);
  // guardamos el verbo objetivo dentro del estado para validación correcta
  spellingState.target = target;

  const esp = String(target.esp||"").trim().toUpperCase();
  const work = String(target.c1||"").trim().toUpperCase();

  area.innerHTML = `
    <div class="spellWrap">
      <div class="spellHead">
        <div>
          <h3 class="spellTitle">🐝 Spelling Yoguis Bee</h3>
          <div class="spellSub">Deletrea las 3 formas (C1/C2/C3) del verbo actual. Verbo aleatorio del día (para repasar más).</div>
        </div>
      </div>

      <div class="spellTopRow">
        <div class="spellESPBlock">
          <div class="spellESP">${esp || "VERBO"}</div>
          
        </div>
        <div class="spellWork">Trabajando: <b>${work}</b> • Selecciona C1, C2 y C3 con las flechas y valida.</div>
      </div>

      <div class="spellGrid">
        <div class="spellCard">
          <div class="spellLabel">PRESENT (C1)</div>
          <div class="spellPicker">
            <button class="spellArrow" type="button" onclick="spellMove(1,-1)">‹</button>
            <div class="spellVal" id="spellC1Val">—</div>
            <button class="spellArrow" type="button" onclick="spellMove(1,1)">›</button>
          </div>
          <button class="spellSpeak" type="button" onclick="spellSpeak(1)">🎙️ Deletrear</button>
        </div>

        <div class="spellCard">
          <div class="spellLabel">PAST (C2)</div>
          <div class="spellPicker">
            <button class="spellArrow" type="button" onclick="spellMove(2,-1)">‹</button>
            <div class="spellVal" id="spellC2Val">—</div>
            <button class="spellArrow" type="button" onclick="spellMove(2,1)">›</button>
          </div>
          <button class="spellSpeak" type="button" onclick="spellSpeak(2)">🎙️ Deletrear</button>
        </div>

        <div class="spellCard">
          <div class="spellLabel">PARTICIPLE (C3)</div>
          <div class="spellPicker">
            <button class="spellArrow" type="button" onclick="spellMove(3,-1)">‹</button>
            <div class="spellVal" id="spellC3Val">—</div>
            <button class="spellArrow" type="button" onclick="spellMove(3,1)">›</button>
          </div>
          <button class="spellSpeak" type="button" onclick="spellSpeak(3)">🎙️ Deletrear</button>
        </div>
      </div>

      <div class="spellActions">
        <div class="spellFeedback" id="spellFeedback"></div>
        <button class="spellValidate" type="button" onclick="validateSpelling()">VALIDAR DELETREO ✅</button>
      </div>
    </div>
  `;

  spellSyncUI();
}

function getSpellIllustrationSVG(v){
  const c1 = String(v?.c1||"").trim().toLowerCase();
  const esp = String(v?.esp||"").trim().toLowerCase();
  const espLabel = String(v?.esp||"").trim() || String(v?.c1||"").trim() || "verb";

  const pick = (emoji, label)=> {
    const safeLabel = String(label||"").replace(/[<>]/g,"").slice(0,40);
    return `
      <svg viewBox="0 0 240 130" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${safeLabel}">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="rgba(242,139,22,.35)"/>
            <stop offset="1" stop-color="rgba(101,17,107,.35)"/>
          </linearGradient>
        </defs>
        <rect x="8" y="8" width="224" height="114" rx="18" fill="url(#bg)" stroke="rgba(242,139,22,.35)"/>
        <text x="120" y="70" text-anchor="middle" dominant-baseline="middle" font-size="66"> ${emoji} </text>
        <text x="120" y="112" text-anchor="middle" font-size="14" fill="rgba(255,255,255,.9)" font-weight="900" letter-spacing=".08em">${safeLabel.toUpperCase()}</text>
      </svg>
    `;
  };

  // 🔥 Mapeo rápido (puedes ampliar esta lista si quieres)
  // ✅ La etiqueta inferior debe ser el ESPAÑOL (como en el ejemplo: CUT arriba / CORTAR abajo)
  if(c1==="cut" || esp.includes("cortar") || esp.includes("recortar")) return pick("✂️", espLabel);
  if(c1==="get" || esp.includes("obtener") || esp.includes("conseguir") || esp.includes("recibir")) return pick("📥", espLabel);
  if(c1==="put" || esp.includes("poner") || esp.includes("colocar") || esp.includes("meter")) return pick("📦", espLabel);
  if(c1==="go" || esp.includes("ir")) return pick("➡️", espLabel);
  if(c1==="come" || esp.includes("venir")) return pick("🚶‍♂️", espLabel);
  if(c1==="eat" || esp.includes("comer")) return pick("🍽️", espLabel);
  if(c1==="drink" || esp.includes("beber") || esp.includes("tomar")) return pick("🥤", espLabel);
  if(c1==="read" || esp.includes("leer")) return pick("📖", espLabel);
  if(c1==="write" || esp.includes("escribir")) return pick("✍️", espLabel);
  if(c1==="see" || esp.includes("ver")) return pick("👀", espLabel);
  if(c1==="say" || esp.includes("decir")) return pick("💬", espLabel);
  if(c1==="tell" || esp.includes("contar") || esp.includes("decir")) return pick("🗣️", espLabel);
  if(c1==="take" || esp.includes("tomar") || esp.includes("llevar")) return pick("🤲", espLabel);
  if(c1==="give" || esp.includes("dar")) return pick("🎁", espLabel);
  if(c1==="make" || esp.includes("hacer") || esp.includes("fabricar")) return pick("🛠️", espLabel);
  if(c1==="think" || esp.includes("pensar")) return pick("💭", espLabel);
  if(c1==="know" || esp.includes("saber") || esp.includes("conocer")) return pick("💡", espLabel);
  if(c1==="choose" || esp.includes("elegir") || esp.includes("escoger")) return pick("🗳️", espLabel);
  if(c1==="grow" || esp.includes("crecer") || esp.includes("cultivar")) return pick("🌱", espLabel);
  if(c1==="foresee" || esp.includes("prever") || esp.includes("anticipar")) return pick("🔮", espLabel);
  if(c1==="mistake" || esp.includes("equivoc") || esp.includes("confundir")) return pick("🤦", espLabel);
  if(c1==="undertake" || esp.includes("emprender") || esp.includes("asumir")) return pick("🚀", espLabel);
  if(c1==="sink" || esp.includes("hund") || esp.includes("sumerg")) return pick("🚢", espLabel);
  if(c1==="shrink" || esp.includes("encog") || esp.includes("reduc")) return pick("📉", espLabel);
  if(c1==="stride" || esp.includes("zanc") || esp.includes("paso largo")) return pick("👣", espLabel);
  if(c1==="swell" || esp.includes("hinch") || esp.includes("infl")) return pick("🎈", espLabel);
  if(c1==="undo" || esp.includes("deshacer") || esp.includes("revert")) return pick("↩️", espLabel);
  if(c1==="run" || esp.includes("correr")) return pick("🏃", espLabel);
  if(c1==="buy" || esp.includes("comprar")) return pick("🛒", espLabel);
  if(c1==="sell" || esp.includes("vender")) return pick("💰", espLabel);
  if(c1==="sleep" || esp.includes("dormir")) return pick("😴", espLabel);
  if(c1==="sing" || esp.includes("cantar")) return pick("🎤", espLabel);
  if(c1==="swim" || esp.includes("nadar")) return pick("🏊", espLabel);
  if(c1==="drive" || esp.includes("conduc")) return pick("🚗", espLabel);
  if(c1==="fly" || esp.includes("volar")) return pick("✈️", espLabel);
  if(c1==="teach" || esp.includes("enseñar")) return pick("👨‍🏫", espLabel);
  if(c1==="learn" || esp.includes("aprender")) return pick("📚", espLabel);

  // Default (si no hay mapeo): icono genérico "brain"
  return pick("🧩", espLabel);
}

/* ===========================
   ✅ Imagen impactante por verbo (bajo el título principal)
   - Sin servidor
   - Funciona embebido en Google Sites
   - Usa fotos dinámicas (Unsplash Source) + fallback SVG
   =========================== */

// Mapeo curado (mejores resultados visuales). Para verbos no listados,
// se genera un query automático con el español + inglés.
const VERB_PHOTO_QUERIES = {
  cut: "scissors cutting paper",
  put: "placing box on table",
  beat: "drumsticks playing drums",
  sweat: "sweating athlete workout",
  sit: "person sitting chair",
  eat: "healthy meal eating",
  bet: "casino bet chips",
  let: "open door letting in light",
  set: "setting table dinner",
  wet: "rain drops wet street",
  hurt: "injured hand bandage",
  shut: "closing door shut",
  burst: "balloon burst pop",
  thrust: "pushing forward thrust",
  cost: "price tag cost",
  cast: "casting fishing rod",
  broadcast: "tv studio broadcast",
  forecast: "weather forecast map",
  fit: "fitting clothes measuring tape",
  hit: "boxing punch hit",
  slit: "paper slit cutter",
  spit: "spitting water splash",
  split: "splitting wood axe",
  quit: "quit smoking broken cigarette",
  knit: "knitting yarn needles",
  bid: "auction bid paddle",
  rid: "cleaning rid of dirt",
  read: "reading book library",
  spread: "spreading butter bread",
  lead: "leader leading team",

  stand: "standing person silhouette",
  understand: "understanding idea lightbulb",
  withstand: "storm withstand strong wind",
  bend: "bending metal bar",
  blend: "blending smoothie blender",
  lend: "lending money hand",
  send: "sending mail envelope",
  spend: "spending money wallet",

  bind: "binding rope knots",
  unbind: "untying rope unbind",
  find: "finding keys search",
  grind: "coffee grinding beans",
  wind: "winding clock mechanism",
  unwind: "relax unwind hammock",

  cling: "cling to cliff rock climbing",
  sting: "bee sting macro",
  swing: "swing playground",
  wring: "wringing towel water",
  hang: "hanging clothesline",

  hold: "holding hands closeup"
};

function _normalizeQuery(s){
  return String(s||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function _hash32(str){
  // hash simple y estable (para "sig" y cache)
  let h = 2166136261;
  const s = String(str||"");
  for(let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

function getVerbPhotoQuery(v){
  const c1 = String(v?.c1||"").toLowerCase();
  const esp = String(v?.esp||"").toLowerCase();
  const curated = VERB_PHOTO_QUERIES[c1];
  if(curated) return curated;

  // Fallback automático (cada verbo tiene su propio query)
  const auto = `${_normalizeQuery(esp)} action ${_normalizeQuery(c1)}`.trim();
  return auto || "english verb action";
}

function getVerbPhotoUrl(v){
  // 🖼️ Imagen local por verbo (evita depender de internet)
  const key = String(v?.key || v?.c1 || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if(!key) return "assets/brain.png";
  return `assets/verbs/${key}.svg`;
}

function renderVerbIllustration(v){
  const el = document.getElementById("verbIllustration");
  if(!el) return;

  const c1 = String(v?.c1||"").toUpperCase();
  const esp = String(v?.esp||"").toUpperCase();
  const src = getVerbPhotoUrl(v);

  // ✅ Arriba (fuera de la imagen) va el verbo en INGLÉS (verbo-en)
  // ✅ Debajo/en la imagen mostramos el verbo en ESPAÑOL (como en el ejemplo: CUT arriba / CORTAR abajo)
  el.innerHTML = `
    <div class="verbIllustrationInner">
      <img id="verbPhoto" alt="Imagen del verbo ${c1}" loading="lazy" referrerpolicy="no-referrer" src="${src}" />
      <div class="verbCaption center" aria-hidden="true">
        <span class="verbTag verbTagEsp">${esp}</span>
      </div>
    </div>
  `;

  // Fallback: si la foto no carga (conexión, bloqueo, etc.), mostramos el SVG con emoji
  const img = document.getElementById("verbPhoto");
  if(img){
    img.onerror = () => {
      // Si la imagen local no existe, usamos el ícono  como respaldo.
      img.onerror = null;
      img.src = "assets/brain.png";
      img.style.objectFit = "contain";
    };
  }
}

function spellGet(col){
  if(!spellingState) return "";
  if(col===1) return spellingState.c1Opts[spellingState.i1] || "";
  if(col===2) return spellingState.c2Opts[spellingState.i2] || "";
  return spellingState.c3Opts[spellingState.i3] || "";
}
function spellSyncUI(){
  const a = document.getElementById("spellC1Val");
  const b = document.getElementById("spellC2Val");
  const c = document.getElementById("spellC3Val");
  if(a) a.textContent = spellGet(1) || "—";
  if(b) b.textContent = spellGet(2) || "—";
  if(c) c.textContent = spellGet(3) || "—";

  const fb = document.getElementById("spellFeedback");
  if(fb) fb.innerHTML = "";
}
function spellMove(col, delta){
  if(!spellingState) return;
  const wrap = (i, n) => (n ? (i+n)%n : 0);

  if(col===1){
    spellingState.i1 = wrap(spellingState.i1 + delta, spellingState.c1Opts.length);
  }else if(col===2){
    spellingState.i2 = wrap(spellingState.i2 + delta, spellingState.c2Opts.length);
  }else{
    spellingState.i3 = wrap(spellingState.i3 + delta, spellingState.c3Opts.length);
  }
  spellSyncUI();
}
function spellSpeak(col){
  const w = spellGet(col);
  if(!w) return;
  // Deletreo (letras)
  hablar(String(w).split("").join("... "));
}
function validateSpelling(){
  const v = (spellingState && spellingState.target) ? spellingState.target : (pendingVerb || current[idx]);
  if(!v) return;
  if(!canPlay()) return;

  if(!spellingState || spellingState.key !== spellKeyFor(v)){
    initSpellingState(v);
    spellingState.target = v;
    spellSyncUI();
  }

  const pick1 = String(spellGet(1)||"").trim().toLowerCase();
  const pick2 = String(spellGet(2)||"").trim().toLowerCase();
  const pick3 = String(spellGet(3)||"").trim().toLowerCase();

  const t1 = String(v.c1||"").trim().toLowerCase();
  const t2 = String(v.c2||"").trim().toLowerCase();
  const t3 = String(v.c3||"").trim().toLowerCase();

  att++;

  const ok = (pick1===t1) && (pick2===t2) && (pick3===t3);

  const fb = document.getElementById("spellFeedback");
  if(ok){
    playCorrectSound();
    streak++; corr++;

    const gained = addSpellingXP(v);
    if(gained>0) bumpMastery(v.c1, 1);

    if(fb){
      fb.innerHTML = gained
        ? `<span style="color:var(--success)">✅ ¡Perfecto! +${gained} XP</span>`
        : `<span style="color:var(--success)">✅ Correcto. (XP ya sumado)</span>`;
    }
  } else {
    playWrongSound();
    recordMistake(v);

    // vidas + freeze (misma lógica que validar)
    const spent = spendHeart();
    if(!spent){
      if(fb){
        fb.innerHTML = `<span style="color:var(--error)">💔 Sin vidas por ahora. Espera regeneración.</span>`;
      }
      actualizarStats();
      return;
    }
    if(freezeTokens>0 && streak>0){
      freezeTokens -= 1;
      toastAchievement("🧊", "Streak protegida", "Usaste 1 Freeze para no perder la racha.");
    }else{
      streak = 0;
    }

    if(fb){
      fb.innerHTML = `<span style="color:var(--error)">⚡ No coincide. Revisa C1, C2 y C3. (Vidas: ${hearts}/${MAX_HEARTS})</span>`;
    }
  }

  actualizarStats();
}

  /* ========= Tooltip global (NO se recorta) ========= */
  window.addEventListener('DOMContentLoaded', ()=>{ (function initGlobalTooltip(){
    const tip = document.getElementById('globalTooltip');
    if(!tip) return;
    const gtText = document.getElementById('gtText');
    const gtArrow = document.getElementById('gtArrow');

    // Promueve title -> data-help para evitar tooltip nativo
    document.querySelectorAll('[title]').forEach(el=>{
      const t = el.getAttribute('title');
      if(t && !el.dataset.help){
        el.dataset.help = t;
      }
      if(t) el.removeAttribute('title');
    });

    // ✅ Desde TABLET hacia arriba (>=768px) habilitamos ayudas.
    const mqHelp = window.matchMedia('(min-width: 768px)');

    // Promueve data-tip -> data-help (para la barra de puntuación)
    document.querySelectorAll('[data-tip]').forEach(el=>{
      const t = el.getAttribute('data-tip');
      if(t && !el.dataset.help){
        el.dataset.help = t;
      }
      // Remueve data-tip para evitar tooltips duplicados y el cursor de ayuda
      try{ el.removeAttribute('data-tip'); }catch(_){ }
    });

    

    // ✅ Ayuda para TODOS los botones desde TABLET (>=768px).
    // En móvil (<768px) NO se muestra porque los listeners se cortan con mqHelp.matches.
    const __btnHelpMap = new Map([
      ['motivation-x', 'Cerrar este mensaje.'],
      ['btn-conjugar', 'Genera la conjugación según el modo y el verbo seleccionado.'],
      ['btn-mini|RED NEURONAL', 'Abre el reto “Red Neuronal”.'],
      ['btn-associar', 'Asociar, repetir y conectar neuronas para ganar XP.'],
      ['lbPrevBtn', 'Ir a la página anterior del ranking.'],
      ['lbNextBtn', 'Ir a la página siguiente del ranking.'],
      ['lbBtn|Actualizar', 'Actualizar el ranking y recargar los puntajes.'],
      ['roundbtn web', 'Abrir el sitio “Neuroaprendizaje del Inglés”.'],
      ['btn-main|LIMPIAR', 'Borrar el contenido actual del ejercicio.'],
      ['btn-main|CERRAR', 'Cerrar esta ventana o modal.'],
      ['btn-main|ENTENDIDO', 'Cerrar y continuar con la práctica.'],
      ['btn-main|ASOCIAR', 'Confirmar y continuar con la asociación.'],
      ['aria|Anterior', 'Ir al elemento anterior.'],
      ['aria|Siguiente', 'Ir al elemento siguiente.'],
      ['roundbtn|INSTRUCCIONES', '📌 Abre las instrucciones y recomendaciones para usar la app.'],
      ['roundbtn ebook|E-BOOK', '📚 Abre el e‑book para estudiar la teoría y ejemplos antes de practicar.'],
      ['btnRound1', '🎯 Inicia Round 1: practica solo PRONOMBRE + VERBO (sin complemento).'],
      ['btnRound2', '🚀 Inicia Round 2: practica PRONOMBRE + VERBO + COMPLEMENTO.'],
      ['btnActive', '✅ Cambia al modo Voz Activa para practicar oraciones en activa.'],
      ['btnPassive', '🔁 Cambia al modo Voz Pasiva para practicar oraciones en pasiva.'],
      ['btn-mini|REVIEW', '🧩 Abre REVIEW: repasa errores y refuerza los verbos que más fallas.'],
      ['btn-audio btn-a', '🔊 Escucha la pronunciación del verbo en C1 (Present).'],
      ['btn-audio btn-b', '🔊 Escucha la pronunciación del verbo en C2 (Past).'],
      ['btn-audio btn-c', '🔊 Escucha la pronunciación del verbo en C3 (Participle).'],
      ['roundbtn web|Neuroaprendizaje del Inglés', '🌐 Abre el sitio web con recursos del proyecto.'],
      ['a|www.losyoguis.com', '🌐 Visita el portal de Los Yoguis.'],
      ['arrow|⬅️', '⬅️ Ir al elemento anterior (día/verbo/anterior pregunta).'],
      ['arrow|➡️', '➡️ Ir al siguiente elemento (día/verbo/siguiente pregunta).'],
    ]);

    function __inferHelpFor(el){
      // Prioridad 1: por id
      if(el.id && __btnHelpMap.has(el.id)) return __btnHelpMap.get(el.id);

      // Prioridad 2: por aria-label (flechas / paginación)
      const aria = (el.getAttribute('aria-label') || '').trim();
      if(aria){
        const key = 'aria|' + aria;
        if(__btnHelpMap.has(key)) return __btnHelpMap.get(key);
      }

      // Prioridad 3: por clase + texto
      const cls = (el.className || '').toString().trim().replace(/\s+/g,' ');
      const txt = (el.textContent || '').trim().replace(/\s+/g,' ');

      // Ayudas directas por texto (links/botones sin id)
      if(txt === 'www.losyoguis.com') return __btnHelpMap.get('a|www.losyoguis.com') || 'Visitar www.losyoguis.com';
      if(txt === '⬅️') return __btnHelpMap.get('arrow|⬅️') || 'Ir atrás';
      if(txt === '➡️') return __btnHelpMap.get('arrow|➡️') || 'Ir adelante';

      // matching por clase exacta registrada
      if(cls && __btnHelpMap.has(cls)) return __btnHelpMap.get(cls);

      // matching por (clase contiene + texto contiene)
      for(const [k,v] of __btnHelpMap.entries()){
        if(!k.includes('|')) continue;
        const [kCls, kTxt] = k.split('|');
        if(kCls && cls.includes(kCls) && kTxt && txt.toUpperCase().includes(kTxt.toUpperCase())) return v;
      }

      // Fallback: ayuda genérica basada en el texto
      if(txt){
        const short = txt.length > 44 ? (txt.slice(0,44) + '…') : txt;
        return 'Acción: ' + short;
      }
      return '';
    }

    function __applyHelps(){
      // Incluye <button>, <a>, y elementos con role="button"
      const candidates = document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]');
      candidates.forEach(el=>{
        if(el.dataset && el.dataset.help) return;

        // Si ya tiene title, lo migramos (ya lo hacemos arriba, pero por si llega tarde)
        const t = el.getAttribute && el.getAttribute('title');
        if(t && !el.dataset.help){
          el.dataset.help = t;
          el.removeAttribute('title');
          return;
        }

        // Solo crea ayudas automáticas si parece un botón clickeable
        const tag = (el.tagName || '').toLowerCase();
        const isClickable =
          tag === 'button' ||
          (tag === 'a' && el.getAttribute('href')) ||
          el.getAttribute('role') === 'button' ||
          tag === 'input';

        if(!isClickable) return;

        const msg = __inferHelpFor(el);
        if(msg) el.dataset.help = msg;
      });
    }

    // Aplica al cargar y cuando cambie el breakpoint
    __applyHelps();
    try{
      mqHelp.addEventListener('change', ()=>{ if(mqHelp.matches) __applyHelps(); hide(); });
    }catch(e){
      // Safari viejo: ignora
    }

let activeEl = null;
    let hideTimer = null;

    function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

    function showFor(el){
      const msg = (el && el.dataset && el.dataset.help) ? el.dataset.help.trim() : '';
      if(!msg) return;
      activeEl = el;
      if(hideTimer){ clearTimeout(hideTimer); hideTimer=null; }

      gtText.textContent = msg;
      tip.classList.add('show');
      // Primero posiciona fuera y mide
      tip.style.transform = 'translate(-9999px,-9999px)';
      tip.style.left = '0px';
      tip.style.top = '0px';

      requestAnimationFrame(()=>{
        if(!activeEl) return;
        const r = activeEl.getBoundingClientRect();
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;

        const margin = 10;
        let left = r.left + (r.width/2) - (tw/2);
        left = clamp(left, margin, window.innerWidth - tw - margin);

        // Preferimos mostrar ABAJO (se ve mejor). Si no cabe, lo pasamos ARRIBA.
        let top = r.bottom + 12;
        let arrowAtTop = true;

        // Si abajo se sale de la pantalla, intentamos arriba
        if (top + th + margin > window.innerHeight) {
          top = r.top - th - 12;
          arrowAtTop = false;
        }

        // Ajuste final para que nunca quede fuera del viewport
        top = clamp(top, margin, window.innerHeight - th - margin);

        tip.style.left = left + 'px';
        tip.style.top  = top + 'px';
        tip.style.transform = 'translate(0,0)';

        // Flecha
        if(gtArrow){
          if(arrowAtTop){
            gtArrow.style.top = '-6px';
            gtArrow.style.bottom = 'auto';
            gtArrow.style.transform = 'rotate(225deg)';
          }else{
            gtArrow.style.bottom = '-6px';
            gtArrow.style.top = 'auto';
            gtArrow.style.transform = 'rotate(45deg)';
          }
          const center = r.left + r.width/2;
          const arrowLeft = clamp(center - left, 18, tw - 18);
          gtArrow.style.left = (arrowLeft - 5) + 'px';
        }
      });
    }

    function hide(){
      activeEl = null;
      tip.classList.remove('show');
      // mueve fuera para evitar capturas raras
      tip.style.transform = 'translate(-9999px,-9999px)';
    }

    // Delegación
    document.addEventListener('mouseover', (e)=>{
      if(!mqHelp.matches) return;
      const el = e.target.closest('[data-help]');
      if(!el) return;
      showFor(el);
    });
    document.addEventListener('mouseout', (e)=>{
      if(!mqHelp.matches) return;
      // si sales del elemento con data-help, oculta
      const el = e.target.closest('[data-help]');
      if(!el) return;
      hideTimer = setTimeout(hide, 80);
    });
    document.addEventListener('focusin', (e)=>{
      if(!mqHelp.matches) return;
      const el = e.target.closest('[data-help]');
      if(el) showFor(el);
    });
    document.addEventListener('focusout', (e)=>{
      if(!mqHelp.matches) return;
      const el = e.target.closest('[data-help]');
      if(el) hide();
    });

    // En scroll/resize, reubica
    window.addEventListener('scroll', ()=>{ if(!mqHelp.matches) return; if(activeEl) showFor(activeEl); }, {passive:true});
    window.addEventListener('resize', ()=>{ if(!mqHelp.matches) return; if(activeEl) showFor(activeEl); });

    // Touch: mantener pulsado (long‑press) para mostrar ayuda sin interferir con swipe
    let tHold = null;
    let startX = 0, startY = 0;

    function clearHold(){
      if(tHold){ clearTimeout(tHold); tHold = null; }
    }

    document.addEventListener('touchstart', (e)=>{
      if(!mqHelp.matches) return;
      const el = e.target.closest('[data-help]');
      if(!el) return;

      const touch = e.touches && e.touches[0];
      startX = touch ? touch.clientX : 0;
      startY = touch ? touch.clientY : 0;

      clearHold();
      tHold = setTimeout(()=>{
        showFor(el);
        if(hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 1600);
      }, 420);
    }, {passive:true});

    document.addEventListener('touchmove', (e)=>{
      if(!mqHelp.matches) return;
      if(!tHold) return;
      const touch = e.touches && e.touches[0];
      if(!touch) return;
      const dx = Math.abs(touch.clientX - startX);
      const dy = Math.abs(touch.clientY - startY);
      if(dx > 8 || dy > 8){
        clearHold(); // usuario está haciendo swipe/scroll
      }
    }, {passive:true});

    document.addEventListener('touchend', ()=>{
      if(!mqHelp.matches) return;
      clearHold();
    }, {passive:true});

    document.addEventListener('touchcancel', ()=>{
      if(!mqHelp.matches) return;
      clearHold();
      hide();
    }, {passive:true});
  })(); });

