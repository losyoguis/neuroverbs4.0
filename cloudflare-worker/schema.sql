-- NeuroVerbs Auth DB (Cloudflare D1)
-- Ejecuta: wrangler d1 execute neuroverbs-auth --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT DEFAULT "",
  name TEXT DEFAULT "",
  salt_b64 TEXT NOT NULL,
  pass_hash_b64 TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT "student", -- student | admin
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
