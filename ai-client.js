// Cliente sencillo para consumir la API (Worker o Proxy PHP)
(function(){
  const cfg = () => (window.NEUROVERBS_API || {base:"", endpoints:{}});

  function withTimeout(promise, ms){
    return new Promise((resolve, reject)=>{
      const t = setTimeout(()=>reject(new Error("Tiempo de espera agotado")), ms);
      promise.then(v=>{clearTimeout(t); resolve(v);}).catch(e=>{clearTimeout(t); reject(e);});
    });
  }

  async function postJson(path, data){
    const url = cfg().base + path;
    const res = await withTimeout(fetch(url, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(data || {})
    }), 45000);

    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch(e){ json = {error:"Respuesta no es JSON", raw:text}; }

    if(!res.ok){
      let msg = (json && (json.error || json.message)) ? (json.error || json.message) : ("HTTP " + res.status);

      // Mensajes más claros para rutas faltantes (ej: /chat no desplegado)
      if(res.status === 404){
        const p = String(path || "");
        if(p === (cfg().endpoints.chat || "/chat")){
          msg = "Tu Worker no tiene el endpoint /chat (Ruta no encontrada). Abre Cloudflare → Workers & Pages → neuroverbs-api → Edit code, reemplaza el código de tu Worker por la versión recomendada y luego Deploy.";
        } else if(p === (cfg().endpoints.generate || "/generate")){
          msg = "Tu Worker no tiene el endpoint /generate (Ruta no encontrada). Revisa que el Worker desplegado sea el correcto.";
        } else if(p === (cfg().endpoints.vocab || "/vocab")){
          msg = "Tu Worker no tiene el endpoint /vocab (Ruta no encontrada). Revisa que el Worker desplegado sea el correcto.";
        }
      }

      if(res.status === 401 || res.status === 403){
        msg = "No autorizado. Revisa el secret OPENAI_API_KEY en Cloudflare (Variables & Secrets) o los permisos del Worker.";
      }

      const err = new Error(msg);
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json;
  }

  function mapLevel(levelKey){
    // Front usa: easy / medium / hard
    // Worker usa (recomendado): facil / medio / dificil
    const m = { easy: "facil", medium: "medio", hard: "dificil" };
    return m[levelKey] || levelKey || "medio";
  }

  window.IA = {
    async generate({topic, levelKey, level, lang}){
      const lvl = mapLevel(levelKey || level);
      return await postJson(cfg().endpoints.generate, { topic, level: lvl, lang: lang || "en" });
    },
    async vocab({term, context}){
      return await postJson(cfg().endpoints.vocab, { term, context: context || "" });
    },
    async chat({mode, messages, levelKey, level}){
      // Requiere endpoint /chat en el Worker
      const lvl = mapLevel(levelKey || level);
      return await postJson(cfg().endpoints.chat, { mode: mode || "writing", level: lvl, messages: messages || [] });
    }
  };
})();
