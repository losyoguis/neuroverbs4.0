// Configuración de la API (Cloudflare Worker o Proxy PHP)
// Puedes sobrescribirla desde la consola del navegador:
// localStorage.setItem('NEUROVERBS_API_BASE','https://TU-WORKER.workers.dev'); location.reload();

(function(){
  const defaultBase = "https://neuroverbs-api.yoguisindevoz.workers.dev";
  let base = (localStorage.getItem("NEUROVERBS_API_BASE") || defaultBase).trim();
  // Evita que se quede apuntando a un placeholder típico de ejemplo.
  if (!base || /TU-WORKER|YOUR-WORKER/i.test(base)) base = defaultBase;
  base = base.replace(/\/$/, "");
  window.NEUROVERBS_API = {
    base,
    endpoints: {
      generate: "/generate",
      vocab: "/vocab",
      chat: "/chat" // opcional (si lo agregas en el Worker)
    }
  };
})();
