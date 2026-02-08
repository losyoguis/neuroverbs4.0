#!/usr/bin/env python3
import argparse, sqlite3, secrets, hashlib, base64

def pbkdf2_hash(password: str, iters: int = 210_000) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters, dklen=32)
    return f"pbkdf2${iters}${base64.urlsafe_b64encode(salt).decode().rstrip('=')}${base64.urlsafe_b64encode(dk).decode().rstrip('=')}"

def main():
    ap = argparse.ArgumentParser(description="Crea un usuario en SQLite (student/admin).")
    ap.add_argument("--db", default="neuroverbs_auth.db", help="Ruta al archivo .db")
    ap.add_argument("--username", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--role", default="student", choices=["student","admin"])
    args = ap.parse_args()

    if len(args.password) < 8:
        raise SystemExit("❌ Contraseña muy corta. Usa mínimo 8 caracteres.")

    ph = pbkdf2_hash(args.password)

    con = sqlite3.connect(args.db)
    cur = con.cursor()
    cur.execute("""
        INSERT INTO users (username, role, pass_hash, must_reset, is_active)
        VALUES (?, ?, ?, 0, 1)
    """, (args.username, args.role, ph))
    con.commit()
    con.close()
    print("✅ Usuario creado:", args.username)

if __name__ == "__main__":
    main()
