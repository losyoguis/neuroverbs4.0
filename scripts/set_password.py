#!/usr/bin/env python3
import argparse, sqlite3, os, secrets, hashlib, base64, datetime

def pbkdf2_hash(password: str, iters: int = 210_000) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters, dklen=32)
    return f"pbkdf2${iters}${base64.urlsafe_b64encode(salt).decode().rstrip('=')}${base64.urlsafe_b64encode(dk).decode().rstrip('=')}"

def main():
    ap = argparse.ArgumentParser(description="Asigna/actualiza contraseña a un usuario en SQLite.")
    ap.add_argument("--db", default="neuroverbs_auth.db", help="Ruta al archivo .db")
    ap.add_argument("--username", required=True, help="Usuario")
    ap.add_argument("--password", required=True, help="Contraseña (mínimo 8 recomendado)")
    args = ap.parse_args()

    if len(args.password) < 8:
        raise SystemExit("❌ Contraseña muy corta. Usa mínimo 8 caracteres.")

    ph = pbkdf2_hash(args.password)

    con = sqlite3.connect(args.db)
    cur = con.cursor()
    cur.execute("SELECT id FROM users WHERE username = ?", (args.username,))
    row = cur.fetchone()
    if not row:
        raise SystemExit("❌ Usuario no existe.")

    cur.execute("""
        UPDATE users
        SET pass_hash = ?, must_reset = 0, updated_at = datetime('now')
        WHERE username = ?
    """, (ph, args.username))
    con.commit()
    con.close()
    print("✅ Contraseña actualizada.")

if __name__ == "__main__":
    main()
