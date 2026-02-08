// Auto-generated: moved inline scripts from teacher-yoguis-writing-chat.html into external file to avoid inline-script blocking
(function(){
"use strict";

const $ = (s)=>document.querySelector(s);
  const STORE_KEY = "ty_writing_convos";

  function loadConvos(){
    try{ return JSON.parse(localStorage.getItem(STORE_KEY)||"[]") }catch(e){ return [] }
  }
  function saveConvos(arr){
    localStorage.setItem(STORE_KEY, JSON.stringify(arr.slice(0, 50)));
  }
  function qs(name){
    const u = new URL(location.href);
    return u.searchParams.get(name) || "";
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

  function renderSidebar(currentId){
    const wrap = $("#convWrap");
    const arr = loadConvos();
    const open = arr.filter(x => (x.status||"open")==="open");
    const done = arr.filter(x => (x.status||"open")==="done");

    const itemHtml = (x)=>`
      <div class="item ${x.id===currentId ? "tyItemActive" : ""}" data-id="${x.id}">
        <div>
          <b>${escapeHtml(x.topic||"")}</b>
          <small>${timeAgo(x.updatedAt||x.createdAt)}</small>
        </div>
        <div class="go">›</div>
      </div>
    `;

    wrap.innerHTML = `
      <div class="histTitle"><span class="tyDot tyDotOpen"></span> ABIERTAS</div>
      ${open.length ? open.map(itemHtml).join("") : `<div class="empty">Aún no tienes conversaciones abiertas.</div>`}
      <div class="histTitle" style="margin-top:14px"><span class="tyDot tyDotDone"></span> CONCLUIDAS</div>
      ${done.length ? done.map(itemHtml).join("") : `<div class="empty">Aún no has concluido ninguna conversación.</div>`}
    `;

    wrap.querySelectorAll(".item").forEach(el=>{
      el.addEventListener("click", ()=>{
        const id = el.dataset.id;
        if(!id) return;
        location.href = `teacher-yoguis-writing-chat.html?id=${encodeURIComponent(id)}`;
      });
    });
  }

  function renderChat(convo){
    $("#chatTopic").textContent = convo.topic || "Conversación";
    $("#chatMeta").textContent = (convo.status==="done" ? "Concluida" : "Abierta") + " • " + timeAgo(convo.updatedAt||convo.createdAt);

    const log = $("#chatLog");
    log.innerHTML = (convo.messages||[]).filter(m=>m.role!=="system").map(m=>{
      const cls = m.role==="user" ? "tyMsg tyMsgUser" : "tyMsg tyMsgBot";
      const label = m.role==="user" ? "Tú" : "Teacher Yoguis";
      return `
        <div class="${cls}">
          <div class="tyMsgLabel">${label}</div>
          <div class="tyMsgBubble">${escapeHtml(m.text||"").replace(/\n/g,"<br>")}</div>
        </div>
      `;
    }).join("");

    // auto-scroll
    log.scrollTop = log.scrollHeight;
  }

  
  // ===== IA (Cloudflare Worker / OpenAI) =====
  let sending = false;

  function setSending(on){
    const btn = $("#btnSend");
    const ta  = $("#chatText");
    if(btn) btn.disabled = !!on;
    if(ta)  ta.disabled = !!on;
    if(btn) btn.textContent = on ? "Enviando…" : "Enviar";
  }

  function buildApiMessages(convo){
    const msgs = (convo.messages||[])
      .filter(m => m && m.role && m.role !== "system" && !m._typing)
      .map(m => ({
        role: (m.role === "assistant") ? "assistant" : "user",
        content: String(m.text || "")
      }))
      .slice(-18);

    const topic = (convo.topic || "").trim();
    const ctx = topic
      ? `Tema: "${topic}". Ayúdame a escribir en inglés: corrige errores, sugiere mejoras y haz una pregunta para continuar.`
      : "Ayúdame a escribir en inglés: corrige errores, sugiere mejoras y haz una pregunta para continuar.";

    return [{ role:"user", content: ctx }, ...msgs];
  }

  function addTyping(convo){
    convo.messages = convo.messages || [];
    convo.messages.push({ role:"assistant", text:"Escribiendo…", ts: new Date().toISOString(), _typing:true });
  }

  function replaceTyping(convo, text){
    convo.messages = convo.messages || [];
    const i = convo.messages.findIndex(m => m && m._typing);
    if(i >= 0){
      convo.messages[i].text = text;
      delete convo.messages[i]._typing;
      convo.messages[i].ts = new Date().toISOString();
      return;
    }
    convo.messages.push({ role:"assistant", text, ts: new Date().toISOString() });
  }

  async function send(){
    if(sending) return;

    const id = qs("id");
    if(!id) return;
    const text = ($("#chatText").value||"").trim();
    if(!text) return;

    const arr = loadConvos();
    const idx = arr.findIndex(x=>x.id===id);
    if(idx<0) return;

    const convo = arr[idx];
    if((convo.status||"open")==="done"){
      alert("Esta conversación ya está concluida. Puedes crear una nueva desde Writing.");
      return;
    }

    sending = true;
    setSending(true);

    convo.messages = convo.messages || [];
    convo.messages.push({ role:"user", text, ts: new Date().toISOString() });

    addTyping(convo);
    convo.updatedAt = new Date().toISOString();
    arr[idx] = convo;
    saveConvos(arr);

    $("#chatText").value = "";
    renderChat(convo);
    renderSidebar(id);

    try{
      if(!window.IA || typeof IA.chat !== "function"){
        throw new Error("IA no disponible. Revisa ai-config.js / ai-client.js y NEUROVERBS_API_BASE.");
      }
      const data = await IA.chat({ mode:"writing", messages: buildApiMessages(convo) });
      const reply = (data && data.reply) ? String(data.reply) : "No recibí respuesta del servidor.";
      replaceTyping(convo, reply);
    }catch(err){
      const msg = (err && err.message) ? err.message : String(err);
      replaceTyping(convo, `⚠️ No pude responder.\n${msg}`);
    }

    convo.updatedAt = new Date().toISOString();
    arr[idx] = convo;
    saveConvos(arr);

    renderChat(convo);
    renderSidebar(id);

    sending = false;
    setSending(false);
  }

function markDone(){
    const id = qs("id");
    if(!id) return;
    const arr = loadConvos();
    const idx = arr.findIndex(x=>x.id===id);
    if(idx<0) return;

    arr[idx].status = "done";
    arr[idx].updatedAt = new Date().toISOString();
    saveConvos(arr);

    renderSidebar(id);
    renderChat(arr[idx]);
  }

  // Init
  (function init(){
    const id = qs("id");
    if(!id){ location.href = "teacher-yoguis-writing.html"; return; }

    const arr = loadConvos();
    const convo = arr.find(x=>x.id===id);
    if(!convo){ location.href = "teacher-yoguis-writing.html"; return; }

    renderSidebar(id);
    renderChat(convo);

    $("#btnSend").addEventListener("click", send);
    $("#chatText").addEventListener("keydown", (e)=>{
      if(e.key==="Enter" && !e.shiftKey){
        e.preventDefault();
        send();
      }
    });

    $("#btnDone").addEventListener("click", markDone);
  $("#btnTestIA").addEventListener("click", testIAChat);
  })();

async function testIAChat(){
  try{
    const data = await IA.chat({ mode: "writing", messages: [{ role:"user", content:"Responde solo con: OK" }] });
    const reply = (data && data.reply) ? String(data.reply).trim() : "";
    alert("Respuesta IA:\n" + (reply || "(vacío)"));
  }catch(e){
    const msg = (e && e.message) ? e.message : String(e);
    alert("Error IA:\n" + msg);
  }
}

})();
