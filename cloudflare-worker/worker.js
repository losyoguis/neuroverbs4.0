/**
 * NeuroVerbs — Auth API (Cloudflare Worker + D1)
 * ------------------------------------------------
 * Endpoints:
 *  POST /api/auth/login        {usernameOrEmail, password}
 *  GET  /api/auth/me
 *  GET  /api/admin/users       (admin)
 *  POST /api/admin/users       (admin) {username,name,email,password,role}
 *  PATCH /api/admin/users/:id  (admin) {active,role,name,email,password}
 *  POST /api/xp                {xpDelta} -> escribe en Apps Script (upsertLocal)
 *  POST /api/bootstrap/admin   {username,name,email,password,bootstrapToken}  (one-time)
 *
 * Env:
 *  - DB (D1)
 *  - JWT_SECRET (string)
 *  - CORS_ORIGIN (e.g. https://losyoguis.github.io)
 *  - APP_SCRIPT_EXEC_URL (Apps Script Web App /exec)
 *  - APP_SCRIPT_LOCAL_KEY (shared secret for upsertLocal)
 *  - BOOTSTRAP_TOKEN (string)  (para crear el primer admin)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return cors(env, new Response("", { status: 204 }));
    }

    try {
      if (path === "/api/auth/login" && request.method === "POST") {
        const body = await request.json();
        const usernameOrEmail = String(body.usernameOrEmail || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (!usernameOrEmail || !password) return jsonErr(env, 400, "Faltan credenciales");

        const user = await findUserByUsernameOrEmail(env.DB, usernameOrEmail);
        if (!user || !user.active) return jsonErr(env, 401, "Usuario/contraseña inválidos");

        const ok = await verifyPassword(password, user.salt_b64, user.pass_hash_b64);
        if (!ok) return jsonErr(env, 401, "Usuario/contraseña inválidos");

        await env.DB.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?").bind(user.id).run();

        const token = await signJWT(env.JWT_SECRET, {
          sub: String(user.id),
          role: user.role,
          username: user.username,
          exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7 días
        });

        return jsonOk(env, { token, user: publicUser(user) });
      }

      if (path === "/api/auth/me" && request.method === "GET") {
        const me = await requireAuth(request, env);
        return jsonOk(env, { user: publicUser(me) });
      }

      if (path === "/api/bootstrap/admin" && request.method === "POST") {
        const body = await request.json();
        const bt = String(body.bootstrapToken || "");
        if (!env.BOOTSTRAP_TOKEN || bt !== env.BOOTSTRAP_TOKEN) return jsonErr(env, 403, "Bootstrap token inválido");

        // Solo si NO existe ningún admin
        const admins = await env.DB.prepare("SELECT COUNT(1) as c FROM users WHERE role='admin'").first();
        if ((admins?.c || 0) > 0) return jsonErr(env, 409, "Ya existe un admin");

        const username = String(body.username || "").trim().toLowerCase();
        const name = String(body.name || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (!username || !password) return jsonErr(env, 400, "Falta username o password");

        const { salt_b64, pass_hash_b64 } = await hashPassword(password);
        await env.DB.prepare(
          "INSERT INTO users(username,email,name,salt_b64,pass_hash_b64,role,active) VALUES(?,?,?,?,?,?,1)"
        ).bind(username, email, name, salt_b64, pass_hash_b64, "admin").run();

        return jsonOk(env, { ok: true });
      }

      // Admin users
      if (path === "/api/admin/users" && request.method === "GET") {
        const me = await requireAdmin(request, env);
        const rows = await env.DB.prepare(
          "SELECT id,username,email,name,role,active,created_at,updated_at,last_login FROM users ORDER BY id DESC"
        ).all();
        return jsonOk(env, { users: rows.results || [] });
      }

      if (path === "/api/admin/users" && request.method === "POST") {
        const me = await requireAdmin(request, env);
        const body = await request.json();
        const username = String(body.username || "").trim().toLowerCase();
        const email = String(body.email || "").trim().toLowerCase();
        const name = String(body.name || "").trim();
        const password = String(body.password || "");
        const role = String(body.role || "student").trim();
        if (!username || !password) return jsonErr(env, 400, "Falta username o password");
        if (!isRole(role)) return jsonErr(env, 400, "Rol inválido");

        const { salt_b64, pass_hash_b64 } = await hashPassword(password);

        try {
          await env.DB.prepare(
            "INSERT INTO users(username,email,name,salt_b64,pass_hash_b64,role,active) VALUES(?,?,?,?,?,?,1)"
          ).bind(username, email, name, salt_b64, pass_hash_b64, role).run();
        } catch (e) {
          return jsonErr(env, 409, "Username ya existe");
        }

        return jsonOk(env, { ok: true });
      }

      const adminUserMatch = path.match(/^\/api\/admin\/users\/(\d+)$/);
      if (adminUserMatch && request.method === "PATCH") {
        const me = await requireAdmin(request, env);
        const id = Number(adminUserMatch[1]);
        const body = await request.json();

        const updates = [];
        const binds = [];

        if (body.active !== undefined) {
          updates.push("active=?");
          binds.push(body.active ? 1 : 0);
        }
        if (body.role !== undefined) {
          const r = String(body.role || "").trim();
          if (!isRole(r)) return jsonErr(env, 400, "Rol inválido");
          updates.push("role=?");
          binds.push(r);
        }
        if (body.name !== undefined) {
          updates.push("name=?");
          binds.push(String(body.name || ""));
        }
        if (body.email !== undefined) {
          updates.push("email=?");
          binds.push(String(body.email || "").toLowerCase());
        }
        if (body.password !== undefined) {
          const pw = String(body.password || "");
          const { salt_b64, pass_hash_b64 } = await hashPassword(pw);
          updates.push("salt_b64=?"); binds.push(salt_b64);
          updates.push("pass_hash_b64=?"); binds.push(pass_hash_b64);
        }

        if (!updates.length) return jsonErr(env, 400, "Sin cambios");
        updates.push("updated_at=datetime('now')");

        binds.push(id);
        await env.DB.prepare(`UPDATE users SET ${updates.join(",")} WHERE id=?`).bind(...binds).run();
        return jsonOk(env, { ok: true });
      }

      // XP proxy
      if (path === "/api/xp" && request.method === "POST") {
        const me = await requireAuth(request, env);
        const body = await request.json();
        const xpDelta = Number(body.xpDelta || 0);
        if (!Number.isFinite(xpDelta) || xpDelta < 0 || xpDelta > 500) {
          return jsonErr(env, 400, "xpDelta inválido");
        }
        if (!env.APP_SCRIPT_EXEC_URL || !env.APP_SCRIPT_LOCAL_KEY) {
          return jsonErr(env, 500, "Falta configurar APP_SCRIPT_EXEC_URL o APP_SCRIPT_LOCAL_KEY");
        }

        // Sub para Sheets: local:<id>
        const sub = "local:" + String(me.id);
        const payload = {
          action: "upsertLocal",
          key: env.APP_SCRIPT_LOCAL_KEY,
          sub,
          name: me.name || me.username || "Usuario",
          email: me.email || "",
          xpDelta
        };

        const r = await fetch(env.APP_SCRIPT_EXEC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        // Apps Script puede responder texto; intentamos JSON
        let out = null;
        try { out = await r.json(); } catch (_) { out = { ok: r.ok }; }
        if (!r.ok || !out || out.ok !== true) {
          return jsonErr(env, 502, "No se pudo escribir en Sheets");
        }

        return jsonOk(env, { ok: true });
      }

      return jsonErr(env, 404, "No encontrado");
    } catch (err) {
      return jsonErr(env, 500, String(err && err.message ? err.message : err));
    }
  }
};

// -----------------------------
// Helpers
// -----------------------------

function cors(env, res) {
  const origin = env.CORS_ORIGIN || "*";
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(res.body, { status: res.status, headers });
}
function jsonOk(env, obj) {
  return cors(env, new Response(JSON.stringify({ ok: true, ...obj }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  }));
}
function jsonErr(env, status, error) {
  return cors(env, new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json" }
  }));
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email || "",
    name: u.name || "",
    role: u.role || "student",
    active: !!u.active
  };
}

function isRole(r) {
  return r === "admin" || r === "student";
}

async function findUserByUsernameOrEmail(DB, v) {
  const row = await DB.prepare(
    "SELECT * FROM users WHERE lower(username)=? OR lower(email)=? LIMIT 1"
  ).bind(v, v).first();
  return row || null;
}

// -------- Password hashing (PBKDF2-HMAC-SHA256) --------

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const salt_b64 = b64(salt);
  const pass_hash_b64 = await pbkdf2B64(password, salt, 200_000);
  return { salt_b64, pass_hash_b64 };
}

async function verifyPassword(password, salt_b64, pass_hash_b64) {
  const salt = b64ToBytes(salt_b64);
  const calc = await pbkdf2B64(password, salt, 200_000);
  return timingSafeEq(calc, pass_hash_b64);
}

async function pbkdf2B64(password, saltBytes, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    key,
    256
  );
  return b64(new Uint8Array(bits));
}

function timingSafeEq(a, b) {
  // comparación constante (aprox)
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return out === 0;
}

// -------- JWT (HS256) --------

async function signJWT(secret, payload) {
  if (!secret) throw new Error("Falta JWT_SECRET");
  const header = { alg: "HS256", typ: "JWT" };
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const data = enc.encode(h + "." + p);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  const s = base64urlBytes(sig);
  return h + "." + p + "." + s;
}

async function verifyJWT(secret, token) {
  if (!secret) throw new Error("Falta JWT_SECRET");
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const data = enc.encode(h + "." + p);
  const sig = base64urlToBytes(s);
  const ok = await crypto.subtle.verify("HMAC", key, sig, data);
  if (!ok) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(p)));
    const exp = payload.exp ? Number(payload.exp) : 0;
    if (exp && Math.floor(Date.now() / 1000) > exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

async function requireAuth(request, env) {
  const token = getBearer(request);
  if (!token) throw new Error("No autorizado");
  const payload = await verifyJWT(env.JWT_SECRET, token);
  if (!payload || !payload.sub) throw new Error("No autorizado");

  const id = Number(payload.sub);
  const row = await env.DB.prepare("SELECT * FROM users WHERE id=? LIMIT 1").bind(id).first();
  if (!row || !row.active) throw new Error("No autorizado");
  return row;
}

async function requireAdmin(request, env) {
  const me = await requireAuth(request, env);
  if (me.role !== "admin") throw new Error("Prohibido");
  return me;
}

function getBearer(request) {
  const h = request.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : "";
}

// -------- base64 helpers --------

function b64(bytes) {
  let s = "";
  bytes.forEach(b => s += String.fromCharCode(b));
  return btoa(s);
}
function b64ToBytes(b64str) {
  const s = atob(String(b64str || ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function base64url(str) {
  const b = btoa(str);
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64urlBytes(bytes) {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64urlToBytes(s) {
  const b64 = String(s || "").replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return b64ToBytes(b64);
}
