// Auto-generated: moved inline scripts from teacher-yoguis-input.html into external file to avoid inline-script blocking
(function(){
"use strict";

const $ = (s)=>document.querySelector(s);

  const DIFF = [
    {key:'easy',  label:'Fácil'},
    {key:'medium',label:'Intermedio'},
    {key:'hard',  label:'Difícil'}
  ];

  function loadHistory(){
    try{ return JSON.parse(localStorage.getItem('ty_history')||'[]') }catch(e){ return [] }
  }
  function saveHistory(arr){
    localStorage.setItem('ty_history', JSON.stringify(arr.slice(0, 20)));
  }
  function addHistory(topic, levelKey){
    const now = new Date();
    const arr = loadHistory();
    const clean = (topic||'').trim();
    const prev = arr.filter(x => (x.topic||'').toLowerCase() !== clean.toLowerCase());
    prev.unshift({topic: clean, level: levelKey, ts: now.toISOString(), status:'open'});
    saveHistory(prev);
  }

  function renderHistory(){
    const tab = document.querySelector('.sideTab.active')?.dataset.tab || 'open';
    const wrap = $('#history');
    const arr = loadHistory().filter(x => (x.status||'open') === tab);
    if(!arr.length){
      wrap.innerHTML = '<div class="empty">Sin contenidos aún. Crea tu primer tema arriba 👆</div>';
      return;
    }
    wrap.innerHTML = '<div class="histTitle">Últimos 7 días</div>' + arr.slice(0,10).map(x=>{
      const d = new Date(x.ts);
      const diff = DIFF.find(d=>d.key===x.level)?.label || 'Intermedio';
      return `
        <div class="item" data-topic="${encodeURIComponent(x.topic)}" data-level="${x.level}">
          <div>
            <b>${x.topic}</b>
            <small>${diff} • ${d.toLocaleDateString()}</small>
          </div>
          <div class="go">Explorar</div>
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('.item').forEach(el=>{
      el.addEventListener('click', ()=>{
        const topic = decodeURIComponent(el.dataset.topic || '');
        const level = el.dataset.level || 'medium';
        location.href = `teacher-yoguis-content.html?topic=${encodeURIComponent(topic)}&level=${encodeURIComponent(level)}`;
      });
    });
  }

  function setDiff(val){
    const obj = DIFF[Number(val)] || DIFF[1];
return obj.key;
  }

  // events
  $('#diffRange').addEventListener('input', (e)=>setDiff(e.target.value));
  setDiff($('#diffRange').value);

  document.querySelectorAll('.sideTab').forEach(t=>{
    t.addEventListener('click', ()=>{
      document.querySelectorAll('.sideTab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      renderHistory();
    });
  });

  $('#btnClear').addEventListener('click', ()=>{
    localStorage.removeItem('ty_history');
    renderHistory();
  });

  const SUGGESTIONS = [
    'Energía solar', 'Transición energética', 'Medellín', 'Amazonía', 'Inteligencia artificial',
    'Historia del inglés', 'Verbos irregulares', 'Fútbol', 'Emprendimiento', 'Cambio climático'
  ];
  $('#btnSuggestions').addEventListener('click', ()=>{
    const topic = SUGGESTIONS[Math.floor(Math.random()*SUGGESTIONS.length)];
    $('#topic').value = topic;
    $('#topic').focus();
  });

  function start(){
    const topic = ($('#topic').value||'').trim();
    if(!topic){
      $('#topic').focus();
      $('#topic').style.borderColor = 'rgba(239,68,68,.65)';
      setTimeout(()=>$('#topic').style.borderColor='', 900);
      return;
    }
    const level = setDiff($('#diffRange').value);
    addHistory(topic, level);
    location.href = `teacher-yoguis-content.html?topic=${encodeURIComponent(topic)}&level=${encodeURIComponent(level)}`;
  }

  $('#btnStart').addEventListener('click', start);
  $('#topic').addEventListener('keydown', (e)=>{ if(e.key==='Enter') start(); });

  renderHistory();

})();
