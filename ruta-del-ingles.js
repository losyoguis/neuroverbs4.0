(() => {
  'use strict';

  const DATA_URL = 'assets/ruta_del_ingles.json';
  const LS_KEY = 'nv_ruta_ingles_v1'; // local por dispositivo
  const LS_CUSTOM_KEY = 'nv_ruta_ingles_custom_words_v1';

  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

  const state = {
    data: null,
    checks: {},          // id -> boolean
    customWords: {},     // catId -> [word]
    activeSec: 'pronouns'
  };

  function safeSlug(s){
    return String(s).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  }

  function loadSaved(){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if(raw){
        const obj = JSON.parse(raw);
        if(obj && typeof obj === 'object' && obj.checks && typeof obj.checks === 'object'){
          state.checks = obj.checks;
        }
      }
    }catch(e){}
    try{
      const raw = localStorage.getItem(LS_CUSTOM_KEY);
      if(raw){
        const obj = JSON.parse(raw);
        if(obj && typeof obj === 'object'){
          state.customWords = obj;
        }
      }
    }catch(e){}
  }

  function save(){
    try{
      localStorage.setItem(LS_KEY, JSON.stringify({ checks: state.checks, updatedAt: Date.now() }));
    }catch(e){}
    try{
      localStorage.setItem(LS_CUSTOM_KEY, JSON.stringify(state.customWords));
    }catch(e){}
  }

  function setCheck(id, val){
    state.checks[id] = !!val;
    save();
    updateProgress();
  }

  function getCheck(id, defaultVal=false){
    if(Object.prototype.hasOwnProperty.call(state.checks, id)) return !!state.checks[id];
    return !!defaultVal;
  }

  function buildDefaultsFromData(data){
    const defaults = {};

    // Pronouns + Verbs
    for(const item of (data.sections.pronouns.items || [])){
      defaults[item.id] = false;
    }
    for(const item of (data.sections.verbs.items || [])){
      defaults[item.id] = false;
    }

    // Linking mastery + suggested words
    const sugg = (data.defaults && data.defaults.linkingWordsSuggested) ? data.defaults.linkingWordsSuggested : {};
    for(const cat of (data.sections.linking_words.categories || [])){
      defaults[cat.masteryItemId] = false;
      const words = sugg[cat.id] || [];
      for(const w of words){
        const wid = `lw_word_${cat.id}_${safeSlug(w)}`;
        defaults[wid] = false;
      }
      // custom words defaults handled at runtime (created on add)
    }

    // Tenses cells
    for(const t of (data.sections.tenses.tenses || [])){
      const tId = t.id;
      const blocks = [
        {key:'regular', obj:t.regular},
        {key:'irregular', obj:t.irregular}
      ];
      for(const b of blocks){
        for(const voice of ['active','passive']){
          const cellObj = (b.obj && b.obj[voice]) ? b.obj[voice] : {};
          for(const form of ['+','-','?']){
            const cell = cellObj[form];
            const isNA = cell && cell.na;
            const def = cell && cell.default;
            const cid = `t_${tId}_${b.key}_${voice}_${form === '+' ? 'plus' : (form === '-' ? 'minus' : 'q')}`;
            if(!isNA){
              defaults[cid] = !!def;
            }
          }
        }
      }
    }

    // Apply defaults only for keys not already saved
    for(const [k,v] of Object.entries(defaults)){
      if(!Object.prototype.hasOwnProperty.call(state.checks, k)){
        state.checks[k] = v;
      }
    }
  }

  function el(tag, attrs={}, children=[]){
    const e = document.createElement(tag);
    for(const [k,v] of Object.entries(attrs)){
      if(k === 'class') e.className = v;
      else if(k === 'html') e.innerHTML = v;
      else if(k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if(v === false || v === null || v === undefined) {}
      else e.setAttribute(k, String(v));
    }
    for(const ch of children){
      if(ch === null || ch === undefined) continue;
      if(typeof ch === 'string') e.appendChild(document.createTextNode(ch));
      else e.appendChild(ch);
    }
    return e;
  }

  function renderChecklist(sectionKey, containerId, title, items){
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    container.appendChild(el('div',{class:'rutaCard'},[
      el('h2',{},[title]),
      el('p',{},['Marca lo que ya dominas. Se guarda automáticamente en este dispositivo.']),
      el('div',{class:'rutaChecklist'}, items.map(item => {
        const id = item.id;
        const cb = el('input',{type:'checkbox'});
        cb.checked = getCheck(id, false);
        cb.addEventListener('change', () => setCheck(id, cb.checked));
        return el('label',{class:'rutaItem'},[
          cb,
          el('div',{class:'rutaItemLabel'},[item.label])
        ]);
      }))
    ]));
  }

  function renderTenses(containerId, data){
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const card = el('div',{class:'rutaCard'},[
      el('h2',{},['Tenses (Active / Passive)']),
      el('p',{},['Chulea cada forma (+ / − / ?) en voz activa y pasiva. Las casillas N/A están bloqueadas.'])
    ]);

    const wrap = el('div',{class:'rutaTableWrap'});
    const table = el('table',{class:'rutaTable'});
    const thead = el('thead');
    const tr1 = el('tr');
    tr1.appendChild(el('th',{class:'tcol',rowspan:'2'},['Tense']));
    tr1.appendChild(el('th',{colspan:'6'},['Regular verbs']));
    tr1.appendChild(el('th',{colspan:'6'},['Irregular verbs']));
    const tr2 = el('tr');
    const mk = (label) => el('th',{colspan:'3'},[label]);
    tr2.appendChild(mk('Active'));
    tr2.appendChild(mk('Passive'));
    tr2.appendChild(mk('Active'));
    tr2.appendChild(mk('Passive'));

    thead.appendChild(tr1);
    thead.appendChild(tr2);

    const tr3 = el('tr');
    tr3.appendChild(el('th',{class:'tcol'},['']));
    const forms = ['+','-','?','+','-','?','+','-','?','+','-','?'];
    for(const f of forms){
      tr3.appendChild(el('th',{},[f]));
    }
    thead.appendChild(tr3);

    const tbody = el('tbody');

    for(const t of data.sections.tenses.tenses){
      const tr = el('tr');
      tr.appendChild(el('td',{class:'tcol'},[t.label]));
      // helper render cell
      function renderCell(isNA, defaultVal, id){
        const td = el('td',{class:'rutaCell'});
        if(isNA){
          td.appendChild(el('span',{class:'rutaNA'},['N/A']));
          return td;
        }
        const cb = el('input',{type:'checkbox'});
        cb.checked = getCheck(id, defaultVal);
        cb.addEventListener('change', () => setCheck(id, cb.checked));
        td.appendChild(cb);
        return td;
      }

      // order: reg active + - ?; reg passive + - ?; irr active + - ?; irr passive + - ?
      const blocks = [
        {key:'regular', obj:t.regular},
        {key:'regular', obj:t.regular},
        {key:'irregular', obj:t.irregular},
        {key:'irregular', obj:t.irregular},
      ];
      const voices = ['active','passive','active','passive'];
      const forms2 = ['+','-','?'];

      for(let bi=0; bi<blocks.length; bi++){
        const b = blocks[bi];
        const voice = voices[bi];
        for(const form of forms2){
          const cell = b.obj && b.obj[voice] ? b.obj[voice][form] : null;
          const isNA = cell && cell.na;
          const def = cell && cell.default;
          const cid = `t_${t.id}_${b.key}_${voice}_${form === '+' ? 'plus' : (form === '-' ? 'minus' : 'q')}`;
          tr.appendChild(renderCell(!!isNA, !!def, cid));
        }
      }

      tbody.appendChild(tr);
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);

    card.appendChild(wrap);
    container.appendChild(card);
  }

  function renderLinking(containerId, data){
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const sugg = (data.defaults && data.defaults.linkingWordsSuggested) ? data.defaults.linkingWordsSuggested : {};

    const card = el('div',{class:'rutaCard'},[
      el('h2',{},['Linking Words by type']),
      el('p',{},['Marca las categorías y los conectores que ya usas con confianza. Puedes agregar tus propios conectores por tipo.'])
    ]);

    const grid = el('div',{class:'lwGrid'});
    for(const cat of data.sections.linking_words.categories){
      const masteryId = cat.masteryItemId;
      const masteryCb = el('input',{type:'checkbox'});
      masteryCb.checked = getCheck(masteryId, false);
      masteryCb.addEventListener('change', () => setCheck(masteryId, masteryCb.checked));

      const header = el('div',{class:'lwHeader'},[
        el('div',{class:'lwPill'},[
          masteryCb,
          el('span',{},[`${cat.title}`]),
          el('span',{style:'opacity:.7;font-weight:800;'},[`(${cat.desc_es})`])
        ])
      ]);

      const wordsWrap = el('div',{class:'lwWords'});
      const words = (sugg[cat.id] || []).slice();
      const custom = Array.isArray(state.customWords[cat.id]) ? state.customWords[cat.id] : [];
      for(const w of custom){
        if(!words.includes(w)) words.push(w);
      }
      for(const w of words){
        const wid = `lw_word_${cat.id}_${safeSlug(w)}`;
        const cb = el('input',{type:'checkbox'});
        cb.checked = getCheck(wid, false);
        cb.addEventListener('change', () => setCheck(wid, cb.checked));
        wordsWrap.appendChild(el('label',{class:'lwWord'},[
          cb,
          el('span',{},[w])
        ]));
      }

      const inp = el('input',{type:'text', placeholder:'Add a new connector (English)…', maxlength:'40'});
      const btn = el('button',{type:'button'},['Add']);
      btn.addEventListener('click', () => {
        const w = inp.value.trim();
        if(!w) return;
        if(!state.customWords[cat.id]) state.customWords[cat.id] = [];
        if(!state.customWords[cat.id].includes(w)){
          state.customWords[cat.id].push(w);
          // default unchecked
          const wid = `lw_word_${cat.id}_${safeSlug(w)}`;
          if(!Object.prototype.hasOwnProperty.call(state.checks, wid)) state.checks[wid] = false;
          save();
          renderLinking(containerId, data);
          updateProgress();
        }
        inp.value = '';
        inp.focus();
      });

      const addRow = el('div',{class:'lwAdd'},[inp, btn]);

      grid.appendChild(el('div',{class:'rutaCard'},[
        header,
        el('div',{style:'height:8px;'}),
        wordsWrap,
        addRow
      ]));
    }

    card.appendChild(grid);
    container.appendChild(card);
  }

  function updateProgress(){
    const data = state.data;
    if(!data) return;

    // Build list of all measurable checkbox IDs
    const ids = new Set();

    // Pronouns + Verbs
    for(const item of data.sections.pronouns.items) ids.add(item.id);
    for(const item of data.sections.verbs.items) ids.add(item.id);

    // Linking mastery + suggested words + custom
    const sugg = (data.defaults && data.defaults.linkingWordsSuggested) ? data.defaults.linkingWordsSuggested : {};
    for(const cat of data.sections.linking_words.categories){
      ids.add(cat.masteryItemId);
      for(const w of (sugg[cat.id] || [])){
        ids.add(`lw_word_${cat.id}_${safeSlug(w)}`);
      }
      for(const w of (Array.isArray(state.customWords[cat.id]) ? state.customWords[cat.id] : [])){
        ids.add(`lw_word_${cat.id}_${safeSlug(w)}`);
      }
    }

    // Tenses
    for(const t of data.sections.tenses.tenses){
      const blocks = [
        {key:'regular', obj:t.regular},
        {key:'irregular', obj:t.irregular}
      ];
      for(const b of blocks){
        for(const voice of ['active','passive']){
          const cellObj = (b.obj && b.obj[voice]) ? b.obj[voice] : {};
          for(const form of ['+','-','?']){
            const cell = cellObj[form];
            const isNA = cell && cell.na;
            if(isNA) continue;
            const cid = `t_${t.id}_${b.key}_${voice}_${form === '+' ? 'plus' : (form === '-' ? 'minus' : 'q')}`;
            ids.add(cid);
          }
        }
      }
    }

    let done = 0;
    for(const id of ids){
      if(getCheck(id, false)) done++;
    }
    const total = ids.size || 1;
    const pct = Math.max(0, Math.min(100, Math.round((done/total)*100)));

    const fill = document.getElementById('progFill');
    const progText = document.getElementById('progText');
    const secText = document.getElementById('secText');
    if(fill) fill.style.width = pct + '%';
    if(progText) progText.textContent = `Progreso total: ${done}/${total} (${pct}%)`;

    // Section progress
    const secIds = new Set();
    if(state.activeSec === 'pronouns'){
      for(const item of data.sections.pronouns.items) secIds.add(item.id);
    }else if(state.activeSec === 'verbs'){
      for(const item of data.sections.verbs.items) secIds.add(item.id);
    }else if(state.activeSec === 'tenses'){
      for(const t of data.sections.tenses.tenses){
        for(const b of ['regular','irregular']){
          for(const v of ['active','passive']){
            for(const f of ['plus','minus','q']){
              const cid = `t_${t.id}_${b}_${v}_${f}`;
              if(Object.prototype.hasOwnProperty.call(state.checks, cid) || true){
                // include if in ids set
              }
            }
          }
        }
      }
      // use ids filter
      for(const id of ids){
        if(id.startsWith('t_')) secIds.add(id);
      }
    }else if(state.activeSec === 'linking'){
      for(const cat of data.sections.linking_words.categories){
        secIds.add(cat.masteryItemId);
        for(const w of (sugg[cat.id] || [])){
          secIds.add(`lw_word_${cat.id}_${safeSlug(w)}`);
        }
        for(const w of (Array.isArray(state.customWords[cat.id]) ? state.customWords[cat.id] : [])){
          secIds.add(`lw_word_${cat.id}_${safeSlug(w)}`);
        }
      }
    }
    let sDone = 0;
    for(const id of secIds){
      if(getCheck(id, false)) sDone++;
    }
    const sTotal = secIds.size || 1;
    if(secText){
      secText.textContent = `Sección: ${state.activeSec} • ${sDone}/${sTotal}`;
    }
  }

  function setActiveSec(sec){
    state.activeSec = sec;
    // sections
    $$('.rutaSection').forEach(s => {
      s.classList.toggle('isVisible', s.dataset.sec === sec);
    });
    // tabs
    $$('.rutaTab').forEach(b => {
      const on = b.dataset.sec === sec;
      b.classList.toggle('isActive', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.rutaBottomBtn').forEach(b => b.classList.toggle('isActive', b.dataset.sec === sec));
    updateProgress();
  }

  function wireNav(){
    $$('.rutaTab').forEach(btn => btn.addEventListener('click', () => setActiveSec(btn.dataset.sec)));
    $$('.rutaBottomBtn').forEach(btn => btn.addEventListener('click', () => setActiveSec(btn.dataset.sec)));
    const back = document.getElementById('btnBack');
    if(back) back.addEventListener('click', () => { window.location.href = 'neuroverbs.html'; });

    const reset = document.getElementById('btnReset');
    if(reset) reset.addEventListener('click', () => {
      if(!confirm('¿Reiniciar toda la Ruta del Inglés en este dispositivo?')) return;
      try{ localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_CUSTOM_KEY); }catch(e){}
      state.checks = {};
      state.customWords = {};
      // rebuild defaults and re-render
      loadSaved();
      buildDefaultsFromData(state.data);
      renderAll();
      updateProgress();
      setActiveSec(state.activeSec);
    });
  }

  function renderAll(){
    const data = state.data;
    renderChecklist('pronouns', 'sec_pronouns', 'Pronouns', data.sections.pronouns.items);
    renderChecklist('verbs', 'sec_verbs', 'Verbs', data.sections.verbs.items);
    renderTenses('sec_tenses', data);
    renderLinking('sec_linking', data);
  }

  async function init(){
    wireNav();
    loadSaved();
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    const data = await res.json();
    state.data = data;
    buildDefaultsFromData(data);
    renderAll();
    setActiveSec('pronouns');
    updateProgress();
  }

  window.addEventListener('DOMContentLoaded', () => {
    init().catch(err => {
      console.error(err);
      const main = document.getElementById('rutaMain');
      if(main){
        main.innerHTML = '<div class="rutaCard"><h2>Error</h2><p>No se pudo cargar la Ruta del Inglés. Revisa que exista <b>assets/ruta_del_ingles.json</b>.</p></div>';
      }
    });
  });
})();
