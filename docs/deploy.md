# Despliegue — Render + Aiven

> Guía v1 (Fase 0). El deploy es `git push` una vez configurado (D-017): Render
> hace autodeploy desde GitHub; no hay pipelines propios.

## 1. Base de datos (Aiven)

1. Crear servicio **PostgreSQL 16** en Aiven (plan según etapa; el free/hobby sirve para arrancar).
2. Copiar la URI del usuario `avnadmin` — será `DATABASE_URL` (admin: migraciones, seed, módulo plataforma). Conservar `?sslmode=require`.
3. La primera migración crea el rol `app_runtime` con contraseña de desarrollo. **Inmediatamente después del primer deploy**, cambiarla desde la consola de Aiven (Query editor) o psql:
   ```sql
   ALTER ROLE app_runtime PASSWORD '<contraseña-fuerte-generada>';
   ```
4. Construir `APP_DATABASE_URL` con ese rol:
   `postgres://app_runtime:<contraseña>@<host>:<port>/defaultdb?sslmode=require`

## 2. API (Render Web Service)

| Campo | Valor |
|---|---|
| Root Directory | *(raíz del repo)* |
| Build Command | `npm install && npm run db:deploy -w apps/api` |
| Start Command | `npm run start -w apps/api` |
| Health Check Path | `/health` |

`db:deploy` ejecuta `prisma migrate deploy`: aplica migraciones pendientes en cada deploy, sin shadow DB ni prompts.

**Variables de entorno del servicio:**

| Variable | Valor |
|---|---|
| `DATABASE_URL` | URI avnadmin (paso 1.2) |
| `APP_DATABASE_URL` | URI app_runtime (paso 1.4) |
| `JWT_SECRET` | 64+ caracteres aleatorios (`openssl rand -base64 48`) |
| `CORS_ORIGIN` | URL del Static Site, p. ej. `https://minimarket-web.onrender.com` |
| `NODE_ENV` | `production` |
| `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` | credenciales reales del super admin |
| `SEED_DEMO_TENANTS` | `false` |

**Seed inicial (una sola vez):** desde la shell del servicio en Render:
`npm run db:seed -w apps/api` — crea catálogo RBAC, planes y el super admin (sin tenants demo por la variable anterior).

## 3. Web (Render Static Site)

| Campo | Valor |
|---|---|
| Root Directory | *(raíz del repo)* |
| Build Command | `npm install && npm run build -w apps/web` |
| Publish Directory | `apps/web/dist` |
| Rewrite Rule | `/*` → `/index.html` (SPA con React Router) |

**Variable de entorno de build:** `VITE_API_URL` = URL del Web Service del API (p. ej. `https://minimarket-api.onrender.com`).

## 4. Checklist post-deploy

- [ ] `ALTER ROLE app_runtime PASSWORD …` ejecutado (paso 1.3).
- [ ] Login del super admin funciona en `/api/platform/auth/login`.
- [ ] `GET /health` responde `{ ok: true }`.
- [ ] Crear el primer tenant real (por ahora vía seed/SQL; UI de plataforma llega en Fase 5).
- [ ] Backups automáticos visibles en Aiven (vienen activos por defecto; verificar retención).
