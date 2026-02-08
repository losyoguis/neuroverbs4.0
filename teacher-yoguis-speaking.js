// Auto-generated: moved inline scripts from teacher-yoguis-speaking.html into external file to avoid inline-script blocking
(function(){
"use strict";

const $ = (s)=>document.querySelector(s);

  const STORE_KEY = "ty_speaking_convos";

  function loadConvos(){
    try{ return JSON.parse(localStorage.getItem(STORE_KEY)||"[]") }catch(e){ return [] }
  }
  function saveConvos(arr){
    localStorage.setItem(STORE_KEY, JSON.stringify(arr.slice(0, 50)));
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

  function render(){
    const wrap = $("#convWrap");
    const arr = loadConvos();

    const open = arr.filter(x => (x.status||"open")==="open");
    const done = arr.filter(x => (x.status||"open")==="done");

    const openHtml = open.length
      ? open.map(x => `
          <div class="item" data-id="${x.id}">
            <div>
              <b>${escapeHtml(x.topic||"")}</b>
              <small>${timeAgo(x.updatedAt||x.createdAt)}</small>
            </div>
            <div class="go">›</div>
          </div>
        `).join("")
      : `<div class="empty">Aún no tienes conversaciones abiertas.</div>`;

    const doneHtml = done.length
      ? done.map(x => `
          <div class="item" data-id="${x.id}">
            <div>
              <b>${escapeHtml(x.topic||"")}</b>
              <small>${timeAgo(x.updatedAt||x.createdAt)}</small>
            </div>
            <div class="go">›</div>
          </div>
        `).join("")
      : `<div class="empty">Aún no has concluido ninguna conversación.</div>`;

    wrap.innerHTML = `
      <div class="histTitle"><span class="tyDot tyDotOpen"></span> ABIERTAS</div>
      ${openHtml}
      <div class="histTitle" style="margin-top:14px"><span class="tyDot tyDotDone"></span> CONCLUIDAS</div>
      ${doneHtml}
    `;

    wrap.querySelectorAll(".item").forEach(el=>{
      el.addEventListener("click", ()=>{
        const id = el.dataset.id;
        if(!id) return;
        location.href = `teacher-yoguis-speaking-chat.html?id=${encodeURIComponent(id)}`;
      });
    });
  }

  function escapeHtml(s){
    return String(s||"").replace(/[&<>"']/g, (m)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  }

  function newId(){
    return "s_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }

  function start(){
    const topic = ($("#topic").value||"").trim();
    if(!topic){
      $("#topic").focus();
      $("#topic").style.borderColor = "rgba(217,70,239,.75)";
      setTimeout(()=>$("#topic").style.borderColor="", 900);
      return;
    }

    const now = new Date().toISOString();
    const arr = loadConvos();

    const id = newId();
    arr.unshift({
      id,
      topic,
      status:"open",
      createdAt: now,
      updatedAt: now,
      messages: [
        { role:"system", text:"Habla o escribe. Te responderé con correcciones y una pregunta para continuar." },
        { role:"assistant", text:`¡Listo! Tema: "${topic}".\n\nPulsa “Escuchar” para dictar (si tu navegador lo permite) o escribe tu primera frase.` }
      ]
    });

    saveConvos(arr);
    location.href = `teacher-yoguis-speaking-chat.html?id=${encodeURIComponent(id)}`;
  }

  $("#btnStart").addEventListener("click", start);
  $("#topic").addEventListener("keydown", (e)=>{ if(e.key==="Enter") start(); });
  $("#btnTestIA").addEventListener("click", testIA);


async function testIA(){
  const pill = $("#iaStatus");
  const btn  = $("#btnTestIA");
  if(btn) btn.disabled = true;
  if(pill){ pill.textContent = "IA: probando…"; pill.className = "tyIaPill"; }
  try{
    if(!window.IA || typeof IA.chat !== "function"){
      throw new Error("IA no disponible. Revisa ai-config.js / ai-client.js y NEUROVERBS_API_BASE.");
    }
    const data = await IA.chat({ mode: "speaking", messages: [{ role:"user", content:"Responde solo con: OK" }] });
    const reply = (data && data.reply) ? String(data.reply).trim() : "";
    const ok = /\bOK\b/i.test(reply);
    if(pill){
      pill.textContent = ok ? "IA: OK" : ("IA: " + (reply || "respuesta vacía").slice(0, 60));
      pill.className = "tyIaPill " + (ok ? "ok" : "");
    }
    alert("Respuesta IA:\n" + (reply || "(vacío)"));
  }catch(e){
    const msg = (e && e.message) ? e.message : String(e);
    if(pill){ pill.textContent = "IA: error"; pill.className = "tyIaPill bad"; }
    alert("Error IA:\n" + msg);
  }finally{
    if(btn) btn.disabled = false;
  }
}

  render();

})();
