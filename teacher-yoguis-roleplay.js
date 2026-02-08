// Auto-generated: moved inline scripts from teacher-yoguis-roleplay.html into external file to avoid inline-script blocking
(function(){
"use strict";

const $ = (s)=>document.querySelector(s);

  const STORE_KEY = "ty_roleplay_convos";

  const SCENARIOS = [
    { cat:"Business", title:"Conducting a Multinational Meeting" },
    { cat:"Business", title:"Job Interview" },
    { cat:"Business", title:"Networking Event" },

    { cat:"Offer Solutions", title:"Pitching an Idea" },
    { cat:"Offer Solutions", title:"Performance Review: Asking for a Raise" },
    { cat:"Offer Solutions", title:"Project Presentation" },

    { cat:"Travel", title:"Hotel Check-in" },
    { cat:"Travel", title:"Planning a Trip" },
    { cat:"Travel", title:"Restaurant" },

    { cat:"Shopping", title:"Shopping" },
    { cat:"Shopping", title:"Talking to a Barber or Stylist" },
    { cat:"Shopping", title:"Traveling" },

    { cat:"Everyday Life", title:"Visiting a Doctor" },
    { cat:"Everyday Life", title:"Customer Service" },
    { cat:"Everyday Life", title:"Fitness 101" }
  ];

  function loadConvos(){
    try{ return JSON.parse(localStorage.getItem(STORE_KEY)||"[]") }catch(e){ return [] }
  }
  function saveConvos(arr){
    localStorage.setItem(STORE_KEY, JSON.stringify(arr.slice(0, 60)));
  }

  function escapeHtml(s){
    return String(s||"").replace(/[&<>"']/g, (m)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  }
  function timeAgo(iso){
    try{
      const d = new Date(iso);
      const diffMs = Date.now() - d.getTime();
      const days = Math.floor(diffMs / (1000*60*60*24));
      if(days <= 0) return "Hoy";
      if(days === 1) return "Hace 1 día";
      if(days < 7) return `Hace ${days} días`;
      const weeks = Math.floor(days/7);
      if(weeks === 1) return "Hace 1 semana";
      if(weeks < 5) return `Hace ${weeks} semanas`;
      return d.toLocaleDateString();
    }catch(e){ return ""; }
  }

  function bgClass(cat){
    const c = (cat||"").toLowerCase();
    if(c.includes("business")) return "tyRoleBgBusiness";
    if(c.includes("offer")) return "tyRoleBgOffer";
    if(c.includes("travel")) return "tyRoleBgTravel";
    if(c.includes("shopping")) return "tyRoleBgShopping";
    return "tyRoleBgLife";
  }

  function renderScenarios(){
    const wrap = $("#roleWrap");
    const cats = Array.from(new Set(SCENARIOS.map(s=>s.cat)));

    wrap.innerHTML = cats.map(cat=>{
      const items = SCENARIOS.filter(s=>s.cat===cat);
      return `
        <div class="tyRoleSection">
          <div class="tyRoleSectionTitle">${escapeHtml(cat)}</div>
          <div class="tyRoleGrid">
            ${items.map(s=>`
              <button class="tyRoleCard ${bgClass(cat)}" type="button" data-title="${escapeHtml(s.title)}" data-cat="${escapeHtml(cat)}" title="${escapeHtml(s.title)}">
                <div class="tyRoleOverlay">
                  <div class="tyRoleTitle">${escapeHtml(s.title)}</div>
                </div>
              </button>
            `).join("")}
          </div>
        </div>
      `;
    }).join("");

    wrap.querySelectorAll(".tyRoleCard").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const title = btn.dataset.title || "";
        const cat = btn.dataset.cat || "";
        startScenario(title, cat);
      });
    });
  }

  function renderActivities(){
    const wrap = $("#actWrap");
    const arr = loadConvos();
    const open = arr.filter(x => (x.status||"open")==="open");
    const done = arr.filter(x => (x.status||"open")==="done");

    const itemHtml = (x)=>`
      <div class="item" data-id="${x.id}">
        <div>
          <b>${escapeHtml(x.title||"")}</b>
          <small>${timeAgo(x.updatedAt||x.createdAt)}</small>
        </div>
        <div class="go">›</div>
      </div>
    `;

    wrap.innerHTML = `
      <div class="histTitle"><span class="tyDot tyDotOpen"></span> ACTIVAS</div>
      ${open.length ? open.map(itemHtml).join("") : `<div class="empty">Aún no tienes role plays activos.</div>`}
      <div class="histTitle" style="margin-top:14px"><span class="tyDot tyDotDone"></span> CONCLUIDAS</div>
      ${done.length ? done.map(itemHtml).join("") : `<div class="empty">Aún no has concluido ninguna actividad.</div>`}
    `;

    wrap.querySelectorAll(".item").forEach(el=>{
      el.addEventListener("click", ()=>{
        const id = el.dataset.id;
        if(!id) return;
        location.href = `teacher-yoguis-roleplay-chat.html?id=${encodeURIComponent(id)}`;
      });
    });
  }

  function newId(){
    return "r_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }

  function startScenario(title, cat){
    const now = new Date().toISOString();
    const arr = loadConvos();

    const id = newId();
    const opener = `🎭 Role Play: ${title}\n\nObjetivo: mantén una conversación natural y usa frases útiles.\nRegla: responde con 1–3 frases.`;

    arr.unshift({
      id,
      title,
      cat,
      status:"open",
      createdAt: now,
      updatedAt: now,
      messages: [
        { role:"assistant", text: opener, ts: now },
        { role:"assistant", text: `Yo seré el otro personaje. Tú empiezas.\n\nPrimera pregunta: ¿Cómo iniciarías esta situación?`, ts: now }
      ]
    });

    saveConvos(arr);
    location.href = `teacher-yoguis-roleplay-chat.html?id=${encodeURIComponent(id)}`;
  }

  renderScenarios();
  renderActivities();

})();
