// Teacher Yoguis - Content (externalized to avoid inline-script blocks)
(() => {
const $ = (s)=>document.querySelector(s);

    const DIFF = {
      easy:   {label:'Fácil',       chars: 900,  paras: 2},
      medium: {label:'Intermedio',  chars: 1900, paras: 4},
      hard:   {label:'Difícil',     chars: 3200, paras: 6},
    };

    function qs(k){
      const u = new URL(location.href);
      return u.searchParams.get(k) || '';
    }

    // history helpers
    function loadHistory(){
      try{ return JSON.parse(localStorage.getItem('ty_history')||'[]') }catch(e){ return [] }
    }
    function saveHistory(arr){
      localStorage.setItem('ty_history', JSON.stringify(arr.slice(0, 20)));
    }
    function renderHistory(){
      const tab = document.querySelector('.sideTab.active')?.dataset.tab || 'open';
      const wrap = $('#history');
      const arr = loadHistory().filter(x => (x.status||'open') === tab);
      if(!arr.length){
        wrap.innerHTML = '<div class="empty">Aún no hay contenidos aquí.</div>';
        return;
      }
      wrap.innerHTML = '<div class="histTitle">Últimos 7 días</div>' + arr.slice(0,10).map(x=>{
        const d = new Date(x.ts);
        const diff = DIFF[x.level]?.label || 'Medio';
        return `
          <div class="item" data-topic="${encodeURIComponent(x.topic)}" data-level="${x.level}">
            <div>
              <b>${x.topic}</b><br/>
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

    // ---- Wikipedia fetch (EN + ES)
    async function wikiTitle(lang, query){
      const url = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&namespace=0&format=json&origin=*`;
      const res = await fetch(url);
      const data = await res.json();
      return (data && data[1] && data[1][0]) ? data[1][0] : '';
    }

    async function wikiExtract(lang, title, chars){
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&exchars=${chars}&titles=${encodeURIComponent(title)}&format=json&origin=*`;
      const res = await fetch(url);
      const data = await res.json();
      const pages = data?.query?.pages || {};
      const firstKey = Object.keys(pages)[0];
      const text = pages[firstKey]?.extract || '';
      return text;
    }

    function cleanText(t){
      // Wikipedia extracts sometimes include headings like "== History ==".
      // Also remove "References / External links" blocks when present.
      return (t||'')
        .replace(/\r/g,'')
        .replace(/\n==+[^\n]+==+\n/g,'\n')
        .replace(/^\s*(References|External links|See also|Notes|Bibliography)\s*$/gmi,'')
        .replace(/\n{3,}/g,'\n\n')
        .replace(/[ \t]{2,}/g,' ')
        .replace(/\n\s+/g,'\n')
        .trim();
    }

    function pickFunFact(sentences, lang){
      const keys = lang==='en'
        ? /(\b(19\d{2}|20\d{2})\b|\d{2,}|\bfirst\b|\blargest\b|\bmost\b|\bfounded\b|\binvented\b|\brecord\b)/i
        : /(\b(19\d{2}|20\d{2})\b|\d{2,}|\bprimera\b|\bprimer\b|\bmayor\b|\bmás\b|\bfundad[oa]\b|\binventad[oa]\b|\brécord\b)/i;
      return (sentences||[]).find(s => keys.test(s) && (s||'').length >= 40 && (s||'').length <= 180) || '';
    }

    function curateEducationalText(topic, lang, text){
      const t = cleanText(text);
      if(!t) return '';
      const sents = splitSentences(t.replace(/\n+/g,' ')).map(x=>x.trim()).filter(x=>x.length>15);
      if(!sents.length) return t;

      const def = sents[0];
      const fact = pickFunFact(sents.slice(1), lang);
      const intro = (lang==='en')
        ? `Mini-lesson on ${topic}: key ideas first, then a fun fact.`
        : `Mini-lección sobre ${topic}: primero ideas clave y luego un dato curioso.`;

      // Build a lightly "edutaining" block using only extracted facts (no invented info)
      const parts = [intro, def];
      if(fact){
        parts.push((lang==='en' ? 'Fun fact: ' : 'Dato curioso: ') + fact);
      }

      // Append the rest, avoiding duplicates
      const rest = sents.slice(1)
        .filter(s => s !== def && s !== fact)
        .join(' ');
      return cleanText(parts.join(' ') + ' ' + rest);
    }

    function expandClauses(sentences, minCount){
      // If we don't have enough sentences to build the requested number of paragraphs,
      // split long sentences into shorter clauses (comma/semicolon/colon separated).
      let s = (sentences||[]).slice();
      const punct = (x)=>{
        const t = (x||'').trim();
        if(!t) return '';
        return /[.!?]$/.test(t) ? t : (t + '.');
      };
      while(s.length < minCount && s.length){
        let longest = 0;
        for(let i=1;i<s.length;i++){
          if((s[i]||'').length > (s[longest]||'').length) longest = i;
        }
        const parts = String(s[longest]||'')
          .split(/[,;:]\s+/)
          .map(x=>x.trim())
          .filter(x=>x.length > 12);
        if(parts.length < 2) break;
        s.splice(longest, 1, ...parts.map(punct).filter(Boolean));
      }
      // As a last resort, duplicate the last sentence to reach the minimum
      while(s.length && s.length < minCount){
        s.push(s[s.length-1]);
      }
      return s;
    }

    function pickParagraphs(text, levelKey){
      const cfg = DIFF[levelKey] || DIFF.medium;
      const t = cleanText(text);
      if(!t) return [];

      // Build a clean sentence list
      let sents = splitSentences(t.replace(/\n+/g,' '))
        .map(x=>x.trim())
        .filter(x=>x.length > 15);

      // Ensure we can create the required number of paragraphs
      sents = expandClauses(sents, cfg.paras);
      if(!sents.length) return [];

      // Control how much content we show per level
      const perPara = (levelKey==='easy') ? 3 : (levelKey==='medium') ? 4 : 5;
      const minTotal = Math.max(cfg.paras, cfg.paras * perPara);
      const maxTotal = Math.min(sents.length, minTotal);
      sents = sents.slice(0, maxTotal);

      // Make sure we still have at least one sentence per paragraph
      while(sents.length < cfg.paras){
        sents.push(sents[sents.length-1]);
      }

      // Distribute sequentially into EXACTLY cfg.paras paragraphs
      const n = cfg.paras;
      const k = sents.length;
      const base = Math.floor(k / n);
      let rem = k % n;
      const paras = [];
      let idx = 0;
      for(let p=0;p<n;p++){
        let sz = base + (p < rem ? 1 : 0);
        if(sz < 1) sz = 1;
        const chunk = sents.slice(idx, idx + sz);
        idx += sz;
        paras.push(chunk.join(' '));
      }

      // Enforce (rough) character limit without changing paragraph count
      let joined = paras.join('\n\n');
      while(joined.length > cfg.chars){
        let changed = false;
        for(let p=n-1;p>=0;p--){
          const ls = splitSentences(paras[p]);
          if(ls.length > 1){
            ls.pop();
            paras[p] = ls.join(' ');
            changed = true;
            break;
          }
        }
        if(!changed) break;
        joined = paras.join('\n\n');
      }

      return paras.slice(0, n);
    }


    function splitSentences(text){
      const t = (text||'').trim();
      if(!t) return [];
      // Sentence split without lookbehind (better compatibility)
      const marked = t.replace(/([.!?])\s+/g, '$1|');
      return marked.split('|').map(x=>x.trim()).filter(Boolean);
    }

    function wrapWordsInSentence(sentence){
      const s = String(sentence||'');
      const re = /([A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’\-][A-Za-zÀ-ÖØ-öø-ÿ]+)*)/g;
      let out = '';
      let last = 0;
      let m;
      while((m = re.exec(s)) !== null){
        const before = s.slice(last, m.index);
        if(before) out += escapeHtml(before);
        const w = m[1];
        const wEsc = escapeHtml(w);
        out += `<span class="tyWord" data-word="${wEsc}">${wEsc}</span>`;
        last = m.index + w.length;
      }
      const after = s.slice(last);
      if(after) out += escapeHtml(after);
      return out;
    }

    function wrapSentences(paragraph, baseIndex){
      const sents = splitSentences(paragraph);
      let html = '';
      let idx = baseIndex;
      let offset = 0;
      const spans = [];
      for(const s of sents){
        const start = offset;
        const end = offset + s.length;
        spans.push({i: idx, start, end});
        html += `<span class="sentence" data-i="${idx}" data-start="${start}" data-end="${end}">${wrapWordsInSentence(s)}</span> `;
        offset = end + 1;
        idx++;
      }
      return {html: html.trim(), count: sents.length, spanMeta: spans, textJoined: sents.join(' ')};
    }

    function escapeHtml(s){
      return s.replace(/[&<>"']/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    // --- Speech + highlighting (sentence-by-sentence for reliable highlighting)
    let currentLang = 'en';
    let utterance = null;
    let speaking = false;
    let paused = false;
    let stopped = false;

    // Voice selection (best-effort): pick a clear, natural voice when available.
    let _voices = [];
    let _voiceReady = false;
    function refreshVoices(){
      try{
        _voices = (typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices) ? (speechSynthesis.getVoices()||[]) : [];
        _voiceReady = _voices.length > 0;
      }catch(e){
        _voices = [];
        _voiceReady = false;
      }
    }
    function scoreVoice(v, lang){
      const name = String(v?.name||'');
      const vlang = String(v?.lang||'').toLowerCase();
      const want = (lang==='en') ? 'en' : 'es';
      let s = 0;
      if(vlang.startsWith(want)) s += 60;
      // Prefer region-appropriate voices when available
      if(lang==='en' && (vlang.startsWith('en-us') || vlang.startsWith('en_us'))) s += 18;
      if(lang==='en' && (vlang.startsWith('en-gb') || vlang.startsWith('en_gb'))) s += 12;
      if(lang==='es' && (vlang.startsWith('es-co') || vlang.startsWith('es_co'))) s += 20;
      if(lang==='es' && (vlang.startsWith('es-mx') || vlang.startsWith('es_mx'))) s += 14;
      if(lang==='es' && (vlang.startsWith('es-es') || vlang.startsWith('es_es'))) s += 10;
      if(v?.default) s += 10;
      if(!v?.localService) s += 8;
      if(/google/i.test(name)) s += 35;
      if(/microsoft/i.test(name)) s += 30;
      if(/natural|neural/i.test(name)) s += 25;
      if(/samantha|zira|jenny|aria|lucia|helena|paulina|jorge|juan/i.test(name)) s += 10;
      if(/robot|compact|bad|whisper/i.test(name)) s -= 20;
      return s;
    }
    function preferredVoice(lang){
      refreshVoices();
      if(!_voices.length) return null;
      const want = (lang==='en') ? 'en' : 'es';
      const candidates = _voices.filter(v => String(v?.lang||'').toLowerCase().startsWith(want));
      const list = candidates.length ? candidates : _voices;
      let best = list[0];
      let bestScore = -1e9;
      for(const v of list){
        const sc = scoreVoice(v, lang);
        if(sc > bestScore){ bestScore = sc; best = v; }
      }
      return best || null;
    }

    // Make the listening experience more "educational": slightly slower + short pause between sentences.
    function getEduRate(){
      const raw = parseFloat($('#speedSelect')?.value || '0.65');
      // Estos valores ya son adecuados para aprendizaje; usa la velocidad seleccionada tal cual.
      return Math.max(0.55, Math.min(1.35, raw));
    }
    function getGapMs(){
      // Short pause between sentences helps comprehension.
      const r = getEduRate();
      // Slower rate => a bit longer pause.
      return Math.round(320 + (1.05 - Math.min(1.05, r)) * 260);
    }

    let fullText = {en:'', es:''};
    let displayText = '';
    let sentenceEls = new Map();
    let sentenceQueue = [];
    let queuePos = 0;

    function clearHighlight(){
      sentenceEls.forEach(el => el.classList.remove('speaking'));
    }

    function markSpeaking(el){
      clearHighlight();
      if(el){
        el.classList.add('speaking');
        try{ el.scrollIntoView({block:'center', behavior:'smooth'}); }catch(_){}
      }
    }

    function buildQueue(){
      sentenceQueue = Array.from(sentenceEls.entries())
        .map(([i, el])=>({i: parseInt(i,10), el, text: (el.textContent||'').trim()}))
        .filter(x => x.text)
        .sort((a,b)=>a.i-b.i);
    }

    function updatePauseUI(){
      const btn = $('#btnPause');
      if(!btn) return;
      const span = btn.querySelector('span');
      if(!span) return;
      span.textContent = (speaking && paused) ? 'Resume' : 'Pause';
    }

    function stopSpeak(){
      stopped = true;
      try{ speechSynthesis.cancel(); }catch(e){}
      utterance = null;
      speaking = false;
      paused = false;
      updatePauseUI();
      clearHighlight();
    }

    function speakCurrent(){
      if(stopped) return;
      if(!sentenceQueue.length) buildQueue();
      if(!sentenceQueue.length){
        speaking = false;
        paused = false;
        updatePauseUI();
        return;
      }
      const item = sentenceQueue[queuePos];
      if(!item){
        speaking = false;
        paused = false;
        updatePauseUI();
        clearHighlight();
        return;
      }
      utterance = new SpeechSynthesisUtterance(item.text);
      // Voice (best available) + lang alignment
      const v = preferredVoice(currentLang);
      if(v){
        utterance.voice = v;
        utterance.lang = v.lang || (currentLang==='en' ? 'en-US' : 'es-ES');
      }else{
        utterance.lang = currentLang==='en' ? 'en-US' : 'es-ES';
      }
      // Educational tuning
      utterance.rate = getEduRate();
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      utterance.onstart = ()=>{ markSpeaking(item.el); };
      utterance.onend = ()=>{
        if(stopped) return;
        queuePos++;
        if(queuePos < sentenceQueue.length){
          // Small gap between sentences feels more natural and less "rushed".
          setTimeout(()=>{ if(!stopped) speakCurrent(); }, getGapMs());
        }else{
          speaking = false;
          paused = false;
          updatePauseUI();
          clearHighlight();
        }
      };
      utterance.onerror = ()=>{
        speaking = false;
        paused = false;
        updatePauseUI();
        clearHighlight();
      };
      speechSynthesis.speak(utterance);
    }

    function playSpeak(){
      if(!('speechSynthesis' in window)){
        alert('Tu navegador no soporta SpeechSynthesis (audio).');
        return;
      }
      // Ensure voices are loaded (some browsers load asynchronously)
      refreshVoices();
      // Start from the beginning
      stopSpeak();
      buildQueue();
      queuePos = 0;
      stopped = false;
      speaking = true;
      paused = false;
      updatePauseUI();
      speakCurrent();
    }

    function togglePause(){
      if(!('speechSynthesis' in window)) return;
      if(!speaking) return;
      if(!paused){
        speechSynthesis.pause();
        paused = true;
      }else{
        speechSynthesis.resume();
        paused = false;
      }
      updatePauseUI();
    }

    function restartFromCurrent(){
      if(!speaking) return;
      const pos = queuePos;
      stopSpeak();
      buildQueue();
      queuePos = Math.max(0, Math.min(pos, Math.max(0, sentenceQueue.length-1)));
      stopped = false;
      speaking = true;
      paused = false;
      updatePauseUI();
      speakCurrent();
    }

    // ---- Quiz generation

    function buildQuiz(text, lang){
      const paras = text.split(/\n\n+/).map(x=>x.trim()).filter(Boolean);
      const all = paras.join(' ');
      const sents = splitSentences(all).slice(0, 10);
      // key words
      const words = all
        .replace(/[^\p{L}\s]/gu,' ')
        .split(/\s+/)
        .map(w=>w.trim())
        .filter(w=>w.length>=6)
        .slice(0, 200);

      const uniq = [...new Set(words.map(w=>w.toLowerCase()))].slice(0, 30);
      const pick = (arr)=>arr[Math.floor(Math.random()*arr.length)];
      const sampleWords = uniq.length ? uniq : ['learning','language','practice','content','topic'];

      const L = {
        en:{
          q1:'¿Cuál es la idea principal del texto?',
          q2:'Completa la frase:',
          q3:'Según el texto, esta afirmación es…',
          true:'Verdadero', false:'Falso',
          check:'Calificar'
        },
        es:{
          q1:'¿Cuál es la idea principal del texto?',
          q2:'Completa la frase:',
          q3:'Según el texto, esta afirmación es…',
          true:'Verdadero', false:'Falso',
          check:'Calificar'
        }
      }[lang];

      const questions = [];

      // Q1: main idea
      const topic = $('#topicTitle').textContent;
      const distract = ['Tecnología', 'Cultura', 'Historia', 'Ciencia', 'Educación'].filter(x=>x.toLowerCase()!==topic.toLowerCase());
      const options1 = shuffle([topic, ...shuffle(distract).slice(0,3)]);
      questions.push({
        q: L.q1,
        options: options1,
        answer: topic
      });

      // Q2/Q3: fill in blanks from sentences
      const fillSent = sents.find(s=>s.length>60) || sents[0] || '';
      if(fillSent){
        const targetWord = pickWordForBlank(fillSent);
        const blank = fillSent.replace(new RegExp(`\\b${escapeReg(targetWord)}\\b`,'i'), '_____');
        const opts = shuffle([targetWord, pick(sampleWords), pick(sampleWords), pick(sampleWords)].map(capitalizeFirst));
        questions.push({
          q: L.q2,
          stem: blank,
          options: uniqify(opts),
          answer: capitalizeFirst(targetWord)
        });
      }

      const fillSent2 = sents.find(s=>s.length>40 && s!==fillSent) || sents[1] || '';
      if(fillSent2){
        const targetWord = pickWordForBlank(fillSent2);
        const blank = fillSent2.replace(new RegExp(`\\b${escapeReg(targetWord)}\\b`,'i'), '_____');
        const opts = shuffle([targetWord, pick(sampleWords), pick(sampleWords), pick(sampleWords)].map(capitalizeFirst));
        questions.push({
          q: L.q2,
          stem: blank,
          options: uniqify(opts),
          answer: capitalizeFirst(targetWord)
        });
      }

      // True/False based on a sentence
      const tfSent = sents[2] || sents[0] || '';
      if(tfSent){
        const makeFalse = tfSent.replace(/\b(is|are|was|were|has|have|can|will)\b/i, 'is not');
        const correct = Math.random() < 0.5;
        const statement = correct ? tfSent : makeFalse;
        questions.push({
          q: L.q3,
          stem: statement,
          options: [L.true, L.false],
          answer: correct ? L.true : L.false
        });
      }

      // "Which word appeared?"
      const w = pick(sampleWords);
      const fake1 = scramble(w);
      const fake2 = scramble(w+'x');
      const fake3 = scramble(w+'y');
      const opts5 = shuffle([w, fake1, fake2, fake3].map(capitalizeFirst));
      questions.push({
        q: lang==='en' ? 'Which word appeared in the text?' : '¿Qué palabra aparece en el texto?',
        options: opts5,
        answer: capitalizeFirst(w)
      });

      return questions.slice(0,5);
    }

    function pickWordForBlank(sentence){
      const tokens = sentence.replace(/[^\p{L}\s]/gu,' ').split(/\s+/).filter(Boolean);
      const cands = tokens.filter(w=>w.length>=6);
      return (cands.sort((a,b)=>b.length-a.length)[0] || tokens[0] || 'topic');
    }
    function escapeReg(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function shuffle(a){ return [...a].sort(()=>Math.random()-0.5); }
    function uniqify(arr){
      const seen=new Set(); const out=[];
      for(const x of arr){ const k=x.toLowerCase(); if(!seen.has(k)){ seen.add(k); out.push(x); } }
      while(out.length<4) out.push(out[out.length-1]||'');
      return out.slice(0,4);
    }
    function capitalizeFirst(s){ s=String(s||''); return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }
    function scramble(s){
      const a = String(s||'word').split('');
      return shuffle(a).join('').replace(/\s/g,'');
    }

    // render quiz UI
    
    // Normaliza el quiz del Worker a la estructura interna del front
    function normalizeWorkerQuiz(items){
      try{
        const arr = Array.isArray(items) ? items : [];
        const out = arr.map((it)=>{
          const opts = it.options || it.opciones || it.choices || [];
          const idx = (typeof it.answerIndex === 'number') ? it.answerIndex :
                      (typeof it.correctIndex === 'number') ? it.correctIndex : null;
          const ans = (idx !== null && opts && opts[idx] != null) ? opts[idx] :
                      (it.answer || it.correct || '');
          return {
            q: it.q || it.question || '',
            stem: it.stem || it.context || it.passage || '',
            options: Array.isArray(opts) ? opts : [],
            answer: ans
          };
        }).filter(q => q.q && q.options && q.options.length >= 2);
        return out.slice(0,5);
      }catch(e){
        return [];
      }
    }

function renderQuiz(questions){
      const wrap = $('#panelQuiz');
      const qHtml = questions.map((q,idx)=>{
        const opts = (q.options||[]).map((o,i)=>`
          <label class="opt">
            <input type="radio" name="q${idx}" value="${escapeHtml(o)}"/>
            <div>${escapeHtml(o)}</div>
          </label>
        `).join('');
        return `
          <div class="q" data-idx="${idx}">
            <h4>${idx+1}. ${escapeHtml(q.q)}</h4>
            ${q.stem ? `<div class="legend tyStem">${escapeHtml(q.stem)}</div>` : ''}
            ${opts}
            <div class="result isHidden"></div>
          </div>
        `;
      }).join('');

      wrap.innerHTML = `
        <div class="quiz">
          ${qHtml}
          <div class="score">
            <b id="scoreTxt">Listo para calificar</b>
            <button id="btnCheck">Calificar</button>
          </div>
        </div>
      `;

      $('#btnCheck').addEventListener('click', ()=>{
        let ok=0; let allAnswered = true;
        questions.forEach((q,idx)=>{
          const sel = wrap.querySelector(`input[name="q${idx}"]:checked`);
          const box = wrap.querySelector(`.q[data-idx="${idx}"] .result`);
          if(!sel) allAnswered = false;
          const val = sel ? sel.value : '';
          const good = (val||'').toLowerCase() === String(q.answer||'').toLowerCase();
          if(good) ok++;
          box.style.display='block';
          box.className = 'result ' + (good?'ok':'bad');
          box.textContent = good ? '✅ Correcto' : `❌ Incorrecto • Respuesta: ${q.answer}`;
        });
        if(!allAnswered){
          $('#scoreTxt').textContent = 'Responde todas las preguntas y luego presiona “Calificar”.';
          return;
        }
        $('#scoreTxt').textContent = `Puntaje: ${ok} / ${questions.length}`;
        // mark in history as done once the quiz is taken (graded)
        const arr = loadHistory();
        const topicNow = (qs('topic')||'').trim().toLowerCase();
        const idx = arr.findIndex(x => String(x.topic||'').trim().toLowerCase() === topicNow);
        if(idx>=0){
          arr[idx].status = 'done';
          arr[idx].done_ts = new Date().toISOString();
          saveHistory(arr);
          renderHistory();
        }
      });
    }

    
    // ---- Vocabulary hover modal (pronunciación + traducción + significado + ejemplos)
    const VOCAB = { cache: new Map(), term:'', sentence:'', pendingTerm:'', pendingSentence:'' };
    let _vocabBound = false;

    function isVocabOpen(){
      const ov = $('#vocabOverlay');
      return !!(ov && ov.style.display === 'flex');
    }

    function openVocab(term, sentence){
      term = sanitizeTerm(term);
      if(!term) return;
      VOCAB.term = term;
      VOCAB.sentence = sentence || '';

      const ov = $('#vocabOverlay');
      if(!ov) return;
      document.body.classList.add('modal-open');
      ov.style.display = 'flex';
      ov.setAttribute('aria-hidden','false');

      $('#vocabTerm').textContent = term;
      $('#vocabPhonetic').textContent = '';
      $('#vocabTranslation').textContent = 'Cargando…';
      $('#vocabMeaning').textContent = 'Cargando…';
      $('#vocabExamples').innerHTML = '<li class="vocabMuted">Cargando…</li>';
      $('#vocabSentence').innerHTML = sentence ? highlightInSentence(sentence, term) : '<span class="vocabMuted">—</span>';

      loadVocab(term, sentence).catch(()=>{
        $('#vocabTranslation').textContent = 'No disponible.';
        $('#vocabMeaning').textContent = 'No disponible.';
        $('#vocabExamples').innerHTML = '<li class="vocabMuted">Intenta con otra palabra o revisa tu conexión.</li>';
      });
    }

    function closeVocab(){
      const ov = $('#vocabOverlay');
      if(!ov) return;
      ov.style.display = 'none';
      ov.setAttribute('aria-hidden','true');
      document.body.classList.remove('modal-open');
    }

    function sanitizeTerm(s){
      s = String(s||'').replace(/\s+/g,' ').trim();
      s = s.replace(/^[^\p{L}]+/gu,'').replace(/[^\p{L}]+$/gu,'').trim();
      if(s.length > 40) s = s.slice(0,40).trim();
      return s;
    }

    function highlightInSentence(sentence, term){
      const s = String(sentence||'');
      const t = String(term||'');
      const i = s.toLowerCase().indexOf(t.toLowerCase());
      if(i < 0) return escapeHtml(s);
      return escapeHtml(s.slice(0,i)) + `<span class="vocabMark">${escapeHtml(s.slice(i,i+t.length))}</span>` + escapeHtml(s.slice(i+t.length));
    }

    async function translateENtoES(q){
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=en|es`;
      const res = await fetch(url);
      if(!res.ok) throw new Error('translate');
      const data = await res.json();
      return String(data?.responseData?.translatedText || '').trim();
    }

    async function dictionaryLookup(word){
      const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
      const res = await fetch(url);
      if(!res.ok) return null;
      const data = await res.json();
      const e = data && data[0] ? data[0] : null;
      if(!e) return null;

      const phonetic = e.phonetic || (e.phonetics||[]).find(p=>p?.text)?.text || '';
      const meanings = e.meanings || [];
      const m0 = meanings[0] || {};
      const part = m0.partOfSpeech || '';
      const defs = m0.definitions || [];
      const def = defs[0]?.definition || '';
      const exs = [];
      for(const d of defs){
        if(d?.example && exs.length < 3) exs.push(String(d.example));
      }
      return { phonetic, part, definition: def, examples: exs };
    }

    function phraseHint(term){
      const k = String(term||'').toLowerCase();
      const hints = {
        'due to': 'se usa para indicar la causa o razón de algo.',
        'because of': 'se usa para expresar la causa de algo.',
        'in order to': 'se usa para expresar propósito (para / con el fin de).',
        'such as': 'se usa para introducir ejemplos (como, tales como).',
        'for example': 'introduce un ejemplo (por ejemplo).',
        'as well as': 'añade información adicional (así como / además de).'
      };
      return hints[k] ? `La expresión “${term}” ${hints[k]}` : '';
    }


    function buildExamples(term, sentence, dictExamples){
      const out = [];
      const push = (x)=>{
        x = String(x||'').trim();
        if(!x) return;
        const k = x.toLowerCase();
        if(out.some(e=>e.toLowerCase()===k)) return;
        out.push(x);
      };

      if(sentence && sentence.toLowerCase().includes(String(term).toLowerCase())) push(sentence);
      (dictExamples||[]).forEach(push);

      const t = term;
      if(t.includes(' ')) {
        push(`We stayed indoors ${t} the heavy rain.`);
        push(`The match was postponed ${t} safety concerns.`);
        push(`She got the scholarship ${t} her excellent grades.`);
      } else {
        push(`The teacher asked us to use “${t}” in a sentence.`);
        push(`I often see “${t}” in articles about science and technology.`);
        push(`Using “${t}” correctly makes your English clearer.`);
      }

      return out.slice(0,4);
    }

    function termFromWordEl(wordEl){
      const base = (wordEl?.dataset?.word || wordEl?.textContent || '').trim();
      const sent = wordEl?.closest ? wordEl.closest('.sentence') : null;
      if(!sent) return base;
      const ws = Array.from(sent.querySelectorAll('.tyWord'));
      const i = ws.indexOf(wordEl);
      if(i < 0) return base;

      const w = (k)=> (ws[i+k]?.textContent || '').trim().toLowerCase();
      const prev = (k)=> (ws[i-k]?.textContent || '').trim().toLowerCase();

      const tri = `${w(0)} ${w(1)} ${w(2)}`.trim();
      const triPrev = `${prev(2)} ${prev(1)} ${w(0)}`.trim();
      const pair = `${w(0)} ${w(1)}`.trim();
      const pairPrev = `${prev(1)} ${w(0)}`.trim();

      const triSet = new Set(['in order to','as well as']);
      const pairSet = new Set(['due to','because of','such as','for example']);

      if(triSet.has(tri)) return tri;
      if(triSet.has(triPrev)) return triPrev;
      if(pairSet.has(pair)) return pair;
      if(pairSet.has(pairPrev)) return pairPrev;

      return base;
    }

    async function loadVocab(term, sentence){
      const key = (term+'|'+(sentence||'')).toLowerCase();
      if(vocabCache.has(key)) return vocabCache.get(key);

      // 1) Primero: Worker (OpenAI) — devuelve traducción + significado + ejemplos
      if(window.IA && IA.vocab){
        try{
          const resp = await IA.vocab({term, context: sentence||''});

          const translation = resp.traduccion || resp.translation || '';
          const meaningEs  = resp.significado || resp.meaningEs || resp.meaning || '';
          const exArr = resp.ejemplos || resp.examples || [];
          const examples = Array.isArray(exArr)
            ? exArr.map(x=>{
                if(!x) return '';
                if(typeof x === 'string') return x;
                if(x.en && x.es) return `${x.en} — ${x.es}`;
                if(x.en) return x.en;
                if(x.es) return x.es;
                return '';
              }).filter(Boolean).slice(0,3)
            : [];

          const out = { term: resp.term || term, translation, meaningEs, meaningEn:'', phonetic:'', examples };
          vocabCache.set(key, out);
          return out;
        }catch(e){
          console.warn('Vocab IA falló, usando fallback:', e);
        }
      }

      // 2) Fallback: dictionaryapi + traducción simple (cuando no hay IA)
      const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`;
      try{
        const res = await fetch(url);
        const data = await res.json();
        const entry = Array.isArray(data) ? data[0] : null;

        const phonetic = entry?.phonetic || (entry?.phonetics?.find(p=>p.text)?.text) || '';
        const meaningEn = entry?.meanings?.[0]?.definitions?.[0]?.definition || '';
        const examplesEn = entry?.meanings?.[0]?.definitions?.filter(d=>d.example).slice(0,3).map(d=>d.example) || [];
        const translation = await translateENtoES(term);

        const out = { term, translation, meaningEs:'', meaningEn, phonetic, examples: examplesEn };
        vocabCache.set(key, out);
        return out;
      }catch(err){
        const out = { term, translation:'', meaningEs:'', meaningEn:'', phonetic:'', examples: [] };
        vocabCache.set(key, out);
        return out;
      }
    }

function renderVocab(data){
      $('#vocabTerm').textContent = data.term || '—';
      $('#vocabPhonetic').textContent = data.phonetic ? String(data.phonetic) : '';
      $('#vocabTranslation').textContent = data.translation || '—';

      const meaningBox = $('#vocabMeaning');
      meaningBox.innerHTML = '';
      const es = String(data.meaningEs || '').trim();
      const en = String(data.meaningEn || '').trim();
      const div = document.createElement('div');
      if(es){
        div.textContent = es;
      } else if(en){
        div.textContent = `Definición (EN): ${en}`;
        div.className = 'vocabMuted';
      } else {
        div.textContent = '—';
        div.className = 'vocabMuted';
      }
      meaningBox.appendChild(div);

      const ul = $('#vocabExamples');
      ul.innerHTML = '';
      (data.examples||[]).forEach(ex=>{
        const li = document.createElement('li');
        li.textContent = ex;
        ul.appendChild(li);
      });
      if(!ul.children.length){
        ul.innerHTML = '<li class="vocabMuted">—</li>';
      }
    }




    function speakTerm(term){
      if(!('speechSynthesis' in window)) return;
      refreshVoices();
      try{ speechSynthesis.cancel(); }catch(_){ }
      const u = new SpeechSynthesisUtterance(String(term||''));
      const v = preferredVoice('en');
      if(v){ u.voice = v; u.lang = v.lang || 'en-US'; }
      else{ u.lang = 'en-US'; }
      u.rate = Math.max(0.6, Math.min(1.0, getEduRate()));
      u.pitch = 1.0;
      u.volume = 1.0;
      speechSynthesis.speak(u);
    }

    function bindVocab(){
      if(_vocabBound) return;
      _vocabBound = true;

      // UI events (modal)
      $('#vocabClose')?.addEventListener('click', closeVocab);
      $('#vocabOverlay')?.addEventListener('click', (e)=>{ if(e.target?.id === 'vocabOverlay') closeVocab(); });
      document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && isVocabOpen()) closeVocab(); });

      const panel = $('#panelContent');
      const btn   = $('#btnVocabSelection');
      const noteEl = $('#note');
      let noteTimer = null;

      function flashNote(msg){
        if(!noteEl){ try{ alert(msg); }catch(_){ } return; }
        const base = noteEl.dataset.base || noteEl.textContent;
        if(!noteEl.dataset.base) noteEl.dataset.base = base;
        noteEl.textContent = msg;
        clearTimeout(noteTimer);
        noteTimer = setTimeout(()=>{ noteEl.textContent = noteEl.dataset.base; }, 2400);
      }

      function updateBtn(){
        if(!btn) return;
        btn.disabled = !VOCAB.pendingTerm;
      }

      function setPendingFromSelection(){
        try{
          const sel = window.getSelection && window.getSelection();
          if(!sel || sel.isCollapsed || !sel.rangeCount){
            VOCAB.pendingTerm = '';
            VOCAB.pendingSentence = '';
            updateBtn();
            return;
          }

          const raw = (sel.toString()||'').trim();
          if(!raw){
            VOCAB.pendingTerm = '';
            VOCAB.pendingSentence = '';
            updateBtn();
            return;
          }

          // Asegura que la selección esté dentro del panel
          const range = sel.getRangeAt(0);
          const node = range.commonAncestorContainer;
          const el = node && node.nodeType === 1 ? node : node?.parentElement;
          if(!el || !panel || !panel.contains(el)){
            VOCAB.pendingTerm = '';
            VOCAB.pendingSentence = '';
            updateBtn();
            return;
          }

          const term = sanitizeTerm(raw);
          if(!term){
            VOCAB.pendingTerm = '';
            VOCAB.pendingSentence = '';
            updateBtn();
            return;
          }

          const wc = term.split(/\s+/).length;
          if(wc > 3){
            VOCAB.pendingTerm = '';
            VOCAB.pendingSentence = '';
            updateBtn();
            flashNote('Selecciona máximo 3 palabras para el vocabulario.');
            return;
          }

          const sentEl = el.closest('.sentence');
          const sentence = sentEl ? sentEl.textContent.trim() : '';
          VOCAB.pendingTerm = term;
          VOCAB.pendingSentence = sentence;
          updateBtn();
        }catch(_){ }
      }

      // Captura selección (NO abre modal; solo habilita botón)
      panel?.addEventListener('mouseup', ()=> setTimeout(setPendingFromSelection, 0));
      panel?.addEventListener('touchend', ()=> setTimeout(setPendingFromSelection, 0));
      panel?.addEventListener('keyup', ()=> setTimeout(setPendingFromSelection, 0));

      // Abre modal SOLO cuando el usuario hace clic en el botón
      btn?.addEventListener('click', ()=>{
        if(!VOCAB.pendingTerm){
          flashNote('Selecciona una palabra o fragmento primero.');
          return;
        }
        openVocab(VOCAB.pendingTerm, VOCAB.pendingSentence);

        // Limpia selección para evitar aperturas repetidas por accidente
        try{
          const sel = window.getSelection && window.getSelection();
          sel && sel.removeAllRanges();
        }catch(_){ }
      });

      updateBtn();
    }


    // ---- render content paragraphs + build sentence map for highlighting
    function renderContent(paras){
      const wrap = $('#panelContent');
      sentenceEls = new Map();
      sentenceQueue = [];
      queuePos = 0;

      let globalIndex = 0;
      const htmlParas = (paras||[]).map(p=>{
        const {html, count} = wrapSentences(p, globalIndex);
        globalIndex += count;
        return `<p class="tyPara">${html}</p>`;
      }).join('');

      wrap.innerHTML = htmlParas || '<div class="warn">No se encontró contenido. Prueba con otro tema.</div>';
      wrap.querySelectorAll('.sentence').forEach(el=>{
        sentenceEls.set(el.dataset.i, el);
      });

      // prepare speech queue for highlighting + playback
      buildQueue();
      updatePauseUI();

      // enable hover/click vocabulary modal
      bindVocab();
    }

    // MAIN
    const topic = qs('topic') || 'Tema';
    const level = qs('level') || 'medium';
    const cfg = DIFF[level] || DIFF.medium;
    $('#pillTopic').textContent = topic;
    $('#pillLevel').textContent = cfg.label;
    $('#topicTitle').textContent = topic;
    $('#topicMeta').textContent = `Nivel: ${cfg.label} • Audio: velocidad educativa 0.65x–1.35x (con pausa entre frases)`;

    // sidebar events
    document.querySelectorAll('.sideTab').forEach(t=>{
      t.addEventListener('click', ()=>{
        document.querySelectorAll('.sideTab').forEach(x=>x.classList.remove('active'));
        t.classList.add('active');
        renderHistory();
      });
    });
    $('#btnPlus').addEventListener('click', ()=>location.href='teacher-yoguis-input.html');
    $('#btnNew').addEventListener('click', ()=>location.href='teacher-yoguis-input.html');

    // tab switch
    document.querySelectorAll('.tab').forEach(t=>{
      t.addEventListener('click', ()=>{
        document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
        t.classList.add('active');
        const which = t.dataset.tab;
        $('#panelContent').style.display = which==='content' ? '' : 'none';
        $('#panelQuiz').style.display = which==='quiz' ? '' : 'none';
        if(which==='quiz' && !$('#panelQuiz').dataset.ready){
          const lang = currentLang;
          const base = String(displayText||'') || (lang==='en'?fullText.en:fullText.es) || fullText.en || fullText.es;
          let qs;
          if(workerQuiz && Array.isArray(workerQuiz) && workerQuiz.length){
            qs = normalizeWorkerQuiz(workerQuiz);
          }else{
            qs = buildQuiz(base, lang);
          }
          renderQuiz(qs);
          $('#panelQuiz').dataset.ready='1';
        }
      });
    });

    // language toggle
    function setLang(lang){
      currentLang = lang;
      $('#btnEN').classList.toggle('active', lang==='en');
      $('#btnES').classList.toggle('active', lang==='es');
      stopSpeak();

      const cfg = DIFF[level] || DIFF.medium;
      const wanted = cfg.paras;

      // Preferir los párrafos entregados por el Worker (si existen)
      let paras;
      if(fullParas[lang] && fullParas[lang].length){
        paras = fullParas[lang].slice(0, wanted);
      }else{
        const txt = ((lang==='en'?fullText.en:fullText.es) || fullText.en || '');
        paras = pickParagraphs(txt, level);
      }

      displayText = paras.join('\n\n');
      renderContent(paras);

      // reset quiz
      $('#panelQuiz').dataset.ready='';
      $('#panelQuiz').innerHTML = '<div class="warn">Generando cuestionario…</div>';

      // Traducción perezosa al español (solo si NO vino en el Worker)
      if(lang==='es' && (!fullParas.es || !fullParas.es.length) && fullParas.en && fullParas.en.length && !translatingES){
        translatingES = true;
        const btn = $('#btnES');
        const old = btn.textContent;
        btn.textContent = 'ES (traduciendo…)';
        Promise.all(fullParas.en.slice(0, wanted).map(p => translateENtoES(p).catch(()=>'')))
          .then(arr=>{
            const clean = arr.map((t,i)=> (t && String(t).trim()) ? t : fullParas.en[i]).filter(Boolean);
            fullParas.es = clean;
            fullText.es = clean.join('\n\n');
            if(currentLang==='es'){
              const p = fullParas.es.slice(0, wanted);
              displayText = p.join('\n\n');
              renderContent(p);
              // reset quiz again (por si cambió el texto)
              $('#panelQuiz').dataset.ready='';
              $('#panelQuiz').innerHTML = '<div class="warn">Generando cuestionario…</div>';
            }
          })
          .finally(()=>{
            translatingES = false;
            btn.textContent = old;
          });
      }
    }
    $('#btnEN').addEventListener('click', ()=>setLang('en'));
    $('#btnES').addEventListener('click', ()=>setLang('es'));

    // audio controls
    $('#btnPlay').addEventListener('click', playSpeak);
    $('#btnPause').addEventListener('click', togglePause);
    $('#btnStop').addEventListener('click', stopSpeak);
    $('#speedSelect').addEventListener('change', ()=>{
      // if currently speaking, restart at new speed
      if(speaking){ restartFromCurrent(); }
    });

    // fetch content
    async function load(){
      renderHistory();

      const cfg = DIFF[level] || DIFF.medium;
      const wanted = cfg.paras;

      // 1) Intentar primero con el Worker (OpenAI) — si falla, caemos a Wikipedia
      workerQuiz = null;
      fullParas = {en:[], es:[]};

      try{
        if(window.IA && IA.generate){
          
          $('#loading').textContent = 'Consultando IA…';
          const resp = await IA.generate({topic, levelKey: level});
          const title = resp.title || topic;

          const parasEN = Array.isArray(resp.paragraphs) ? resp.paragraphs : [];
          const chosenEN = parasEN.slice(0, wanted);

          const parasESraw = resp.paragraphs_es || resp.paragraphsES || resp.paragraphsEs || resp.parrafos || resp.paragraphsES;
          const parasES = Array.isArray(parasESraw) ? parasESraw.slice(0, wanted) : [];

          if(chosenEN.length){
            fullParas.en = chosenEN;
            fullText.en = chosenEN.join('\n\n');
            if(parasES.length){
              fullParas.es = parasES;
              fullText.es = parasES.join('\n\n');
            }else{
              fullParas.es = [];
              fullText.es = '';
            }

            if(Array.isArray(resp.quiz)) workerQuiz = resp.quiz;

            $('#topicTitle').textContent = title;
            $('#topicMeta').textContent = `${cfg.label} · ${wanted} párrafo(s) · IA`;
            setLang('en');
            return;
          }
        }
      }catch(err){
        console.warn('Worker/IA falló, usando fallback:', err);
      }

      $('#loading').textContent = 'Buscando en Wikipedia…';

      try{
        const enTitle = await wikiTitle('en', topic) || topic;
        const esTitle = await wikiTitle('es', topic) || topic;

        const [enText, esText] = await Promise.all([
          wikiExtract('en', enTitle, cfg.chars),
          wikiExtract('es', esTitle, cfg.chars)
        ]);

        // Clean + curate (important + entertaining, without inventing facts)
        fullText.en = curateEducationalText(topic, 'en', enText); fullText.es = curateEducationalText(topic, 'es', esText);
        fullParas.en = pickParagraphs(fullText.en, level);
        fullParas.es = pickParagraphs(fullText.es, level);

        if(!fullText.en && !fullText.es){
          fullText.en = `This is a short lesson about ${topic}. Try a more specific topic (for example: “solar energy”, “Amazon rainforest”, “Medellín”).`;
          fullText.es = `Esta es una lección corta sobre ${topic}. Intenta un tema más específico (por ejemplo: “energía solar”, “Amazonía”, “Medellín”).`;
        }

        // default: EN first
        setLang('en');
        $('#loading')?.remove();
      }catch(e){
        fullText.en = `This is a short lesson about ${topic}. (Offline mode)`;
        fullText.es = `Esta es una lección corta sobre ${topic}. (Modo sin conexión)`;
        setLang('en');
      }
    }
    load();

    // Try to keep voice list fresh
    if(typeof speechSynthesis !== 'undefined'){
      try{
        speechSynthesis.onvoiceschanged = () => { refreshVoices(); };
        refreshVoices();
      }catch(e){}
    }
})();
