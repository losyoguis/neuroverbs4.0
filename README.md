# SQLite (Neuroverbs Auth) — para subir al repo

Este paquete crea un archivo SQLite `neuroverbs_auth.db` con un usuario admin inicial:

- **username:** `spellingyoguisbe`
- **password:** **NO definida** (por seguridad). Debes asignarla con `scripts/set_password.py`.

## Importante (GitHub Pages)
GitHub Pages es **estático**: puede servir el archivo `.db` para lectura/descarga, pero **NO puede escribir** sobre él.
Para un inicio de sesión real (crear usuarios, cambiar passwords, sumar XP) necesitas un **backend** (Worker, VPS, Render, etc.)
que sea el que lea/escriba en SQLite.

## Asignar contraseña al admin
Desde tu computador:

```bash
cd sqlite
python3 scripts/set_password.py --db neuroverbs_auth.db --username spellingyoguisbe --password "TU_PASSWORD"
```

## Crear un usuario normal
```bash
python3 scripts/create_user.py --db neuroverbs_auth.db --username estudiante1 --password "ClaveSegura123" --role student
```

## Dónde poner el archivo en tu repo
Recomendado (repo privado):
```
/sqlite/neuroverbs_auth.db
/sqlite/schema.sql
/sqlite/scripts/...
```

## Backend recomendado
- **Cloudflare D1** (es “SQLite administrado”) para producción.
- O un API en **Render/Railway/Fly.io** que use este `.db` en un disco persistente.
