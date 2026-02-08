# NeuroVerbs — Autenticación con Panel de Administrador (sin Workspace)

Este ZIP incluye **un segundo mecanismo de autenticación** (usuario/contraseña) para que no dependas solo de Google Workspace.

La idea recomendada es:
- **Frontend (GitHub Pages):** llama a un **Cloudflare Worker** con CORS.
- **Auth:** el Worker gestiona usuarios (D1) y genera un token.
- **XP y Ranking:** el Worker escribe en tu **Apps Script** con una acción especial `upsertLocal` (con llave secreta).

---

## 1) Despliegue del Cloudflare Worker (Auth API)

Carpeta: `cloudflare-worker/`

### A. Crea la base de datos D1
1. Instala Wrangler
2. Crea DB:
   - `wrangler d1 create neuroverbs-auth`
3. Copia el `database_id` en `wrangler.toml.example` (renómbralo a `wrangler.toml`)
4. Crea las tablas:
   - `wrangler d1 execute neuroverbs-auth --file=./schema.sql`

### B. Configura secretos
En la carpeta del worker:
- `wrangler secret put JWT_SECRET` (cadena larga aleatoria)
- `wrangler secret put APP_SCRIPT_LOCAL_KEY` (cadena aleatoria)
- `wrangler secret put BOOTSTRAP_TOKEN` (para crear el primer admin)

### C. Publica
- `wrangler deploy`

Tu API quedará en algo como: `https://neuroverbs-auth.<tu-subdominio>.workers.dev`

---

## 2) Parchar tu Apps Script (backend de Sheets)

En tu Apps Script agrega una llave secreta y una acción nueva.

### A. Añade una constante
```javascript
const LOCAL_SECRET_KEY = "PEGA_AQUÍ_EL_MISMO_VALOR_DE_APP_SCRIPT_LOCAL_KEY";
```

### B. Añade esta acción en doPost (o en tu router)
```javascript
function handleUpsertLocal_(payload){
  const key = String(payload.key || "");
  if(key !== LOCAL_SECRET_KEY) return json_( { ok:false, error:"unauthorized" }, 401 );

  const sub = String(payload.sub || "").trim();
  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim();
  const xpDelta = Number(payload.xpDelta || 0) || 0;

  // Reutiliza tu función existente de upsert (la que escribe en hoja users)
  return upsertUserBySub_(sub, name, email, xpDelta);
}
```

Y en tu `doPost(e)` (o switch `action`):
```javascript
if(action === "upsertLocal"){
  return handleUpsertLocal_(payload);
}
```

> Nota: `upsertUserBySub_` es la misma lógica que ya tienes para insertar/actualizar en la hoja `users`.

---

## 3) Configurar el frontend

En `nv-config.js` agrega (o deja) esta propiedad:
- `authApiBase: "https://TU-WORKER.workers.dev"`

También puedes configurarlo desde `index.html` con el botón **“Configurar API”**.

### Flujos
- Estudiante: `index.html` → login usuario/contraseña → `neuroverbs.html`
- Administrador: `admin.html` → login → crea usuarios

---

## 4) Crear el primer administrador (bootstrap)

Una sola vez:
- Endpoint: `POST /api/bootstrap/admin`

Body:
```json
{
  "username": "spellingyoguisbe",
  "name": "Spelling Yoguis Bee",
  "email": "admin@neuroverbs",
  "password": "TuClaveSegura",
  "bootstrapToken": "EL_BOOTSTRAP_TOKEN"
}
```

Luego ya puedes entrar a `admin.html`.

> También puedes crear el admin desde la misma página `admin.html`, en la sección **“🧰 Crear Admin Inicial”**.
