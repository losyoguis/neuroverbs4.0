PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT, -- formato: pbkdf2$<iters>$<salt_b64>$<hash_b64>
  role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','admin')),
  is_active INTEGER NOT NULL DEFAULT 1,
  must_reset INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS xp (
  user_id INTEGER PRIMARY KEY,
  total_xp INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS xp_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Admin inicial (SIN contraseña): debes asignarla con scripts/set_password.py
INSERT OR IGNORE INTO users (username, role, pass_hash, must_reset, is_active)
VALUES ('spellingyoguisbe', 'admin', NULL, 1, 1);
