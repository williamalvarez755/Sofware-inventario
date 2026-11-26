# Despliegue — Render + Aiven

> Estado del documento: actualizado a **Fase 7** (2026-08-02).
> El deploy continuo es `git push` una vez configurado (D-017): Render hace
> autodeploy desde GitHub; no hay pipelines propios.

## El orden importa

Hay un huevo-y-gallina que conviene evitar: el API **no arranca** sin
`APP_DATABASE_URL`, pero el rol `app_runtime` de esa URL **no existe** hasta que
corre la primera migración. Si se crea el servicio en Render antes de migrar, el
primer deploy falla y hay que volver a tocar variables.

Por eso este orden: **base → migrar y sembrar desde tu máquina → recién ahí
crear los servicios en Render**. Como beneficio adicional, no se necesita la
shell de Render (el plan gratuito no la tiene).

---

## 1. Base de datos (Aiven)

1. Crear un servicio **PostgreSQL 16**.
2. Copiar la URI del usuario `avnadmin`. Esa es `DATABASE_URL` — el rol
   administrativo: migraciones, seed y el módulo de plataforma. Conservar
   `?sslmode=require`.

---

## 2. Migrar y sembrar desde tu máquina

En la raíz del repo, con la URI de Aiven:

```bash
DATABASE_URL="postgres://avnadmin:...@...aivencloud.com:PUERTO/defaultdb?sslmode=require" APP_DATABASE_URL="postgres://app_runtime:app_runtime_dev@...aivencloud.com:PUERTO/defaultdb?sslmode=require" npm run db:deploy -w apps/api
```

`db:deploy` ejecuta `prisma migrate deploy`: aplica las migraciones pendientes
sin shadow DB ni prompts. Entre ellas se crea el rol `app_runtime` (sin
`BYPASSRLS`) con la contraseña de desarrollo `app_runtime_dev`.

**Cambiá esa contraseña ya**, desde el Query editor de Aiven o por psql:

```sql
ALTER ROLE app_runtime PASSWORD 'una-contrasena-larga-y-aleatoria';
```

> **Esto ya no es un consejo: el API no arranca sin ello (D-065).** Si
> `APP_DATABASE_URL` o `DATABASE_URL` conservan la contraseña `app_runtime_dev`
> —que está escrita en este repositorio, y el repositorio es público— el
> servicio sale con código 1 y el log de Render nombra la variable culpable.
> RLS no protege de esa fuga: quien se conecta con ese rol elige él mismo el
> `app.tenant_id`. En desarrollo solo avisa.
>
> El `npm run db:deploy` de arriba SÍ lleva la contraseña publicada, y está
> bien: es la única forma de conectarse al rol que la migración acaba de crear,
> y ese comando no es el servidor — la comprobación solo corre al arrancar el
> API.

Con eso armás la segunda URI:

```
APP_DATABASE_URL = postgres://app_runtime:<esa-contrasena>@<host>:<puerto>/defaultdb?sslmode=require
```

Ahora el seed inicial —catálogo RBAC, planes y super admin, **sin** tenants demo:

```bash
DATABASE_URL="<uri-avnadmin>" APP_DATABASE_URL="<uri-app_runtime>" SEED_DEMO_TENANTS=false SEED_SUPERADMIN_EMAIL="tu-correo@real.com" SEED_SUPERADMIN_PASSWORD="tu-contrasena-real" npm run db:seed -w apps/api
```

El super admin queda con usuario **`superadmin`** y la contraseña que pusiste
(el ingreso es por usuario desde D-036; el correo se sigue aceptando).

> El seed es idempotente: correrlo dos veces no duplica nada.

---

## 3. API (Render Web Service)

| Campo | Valor |
|---|---|
| Root Directory | *(raíz del repo)* |
| Build Command | `npm install && npm run db:deploy -w apps/api` |
| Start Command | `npm run start -w apps/api` |
| Health Check Path | `/health` |

Dejar `db:deploy` en el build hace que cada deploy futuro aplique solo las
migraciones nuevas. `PORT` lo inyecta Render y el API lo lee de ahí — no hay que
fijarlo.

**Variables de entorno:**

| Variable | Valor | Obligatoria |
|---|---|---|
| `DATABASE_URL` | URI de `avnadmin` (paso 1.2) | sí |
| `APP_DATABASE_URL` | URI de `app_runtime` (paso 2) | sí |
| `JWT_SECRET` | 64+ caracteres aleatorios (`openssl rand -base64 48`). **Mínimo 32, y no el valor de ejemplo del repo: por debajo de eso el API no arranca (D-065).** | sí |
| `NODE_ENV` | `production` | sí |
| `CORS_ORIGIN` | URL del Static Site, p. ej. `https://minimarket-web.onrender.com` (acepta varias separadas por coma) | sí |
| `ACCESS_TOKEN_TTL_MIN` | por defecto `15` | no |
| `REFRESH_TOKEN_TTL_DAYS` | por defecto `30` | no |
| `RATE_LIMIT_MULTIPLIER` | `1` en producción — solo la suite de pruebas lo eleva | no |

> **Tres cosas impiden que el API arranque en producción (D-065),** y las tres
> son credenciales que están publicadas en este repositorio porque hacen falta
> para levantar el proyecto:
>
> 1. `DATABASE_URL` o `APP_DATABASE_URL` con la contraseña `app_runtime_dev`.
> 2. `JWT_SECRET` igual al valor de ejemplo, o de menos de 32 caracteres.
> 3. El super admin con su contraseña inicial (se comprueba contra el hash).
>
> Una contraseña rotada se puede volver a olvidar en el próximo despliegue; un
> arranque que se niega, no. Por eso la comprobación vive en el código y no en
> esta lista de pasos.

> **Los tenants demo NO van a producción.** El seed del paso 2 ya pasa
> `SEED_DEMO_TENANTS=false`, y desde 2026-11-25 la variable es *opt-in*
> (`=true`) y se ignora por completo con `NODE_ENV=production` (D-058). Antes
> fallaba ABIERTO: olvidarla sembraba `tienda-uno` y `tienda-dos` con una
> contraseña que está en el archivo de seed de un repositorio público.
>
> Ni el Build Command ni el Start Command siembran: `db:deploy` es
> `prisma migrate deploy`, que **no** ejecuta el hook `prisma.seed` (solo lo
> hacen `migrate dev` y `migrate reset`). Así que los demos solo pueden estar en
> producción si alguien corrió `db:seed` a mano contra esa base sin la variable.
> Para comprobarlo, sin necesidad de la base:
>
> ```bash
> curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<tu-api>/api/auth/login \
>   -H 'Content-Type: application/json' --data '{"username":"owner1","password":"Demo!2026"}'
> ```
>
> `401` es lo que se espera: no hay cuenta demo alcanzable. Un `200` significa
> que existe y que su contraseña publicada todavía sirve — dé de baja esos dos
> clientes desde el panel de plataforma y elimínelos.

> **Plan gratuito y el POS:** el free tier de Render duerme el servicio tras
> ~15 min sin tráfico, y despertarlo tarda ~50 s. En un mostrador con un cliente
> esperando eso es inaceptable. Para uso real el API va en plan pago; el Static
> Site puede quedarse en gratuito (son archivos estáticos, no duerme).

---

## 4. Web (Render Static Site)

| Campo | Valor |
|---|---|
| Root Directory | *(raíz del repo)* |
| Build Command | `npm install && npm run build -w apps/web` |
| Publish Directory | `apps/web/dist` |
| Rewrite Rule | `/*` → `/index.html` (SPA con React Router) |

**Variable de entorno de build:** `VITE_API_URL` = URL del Web Service del API
(p. ej. `https://minimarket-api.onrender.com`), **sin barra final**.

Se lee en tiempo de compilación: si se cambia después, hay que **redeploy con
"Clear build cache"** — reiniciar no basta.

Una vez que exista la URL del Static Site, volver al API y poner ese valor en
`CORS_ORIGIN`. Son mutuamente dependientes: se crea uno, se anota su URL, se
completa el otro.

---

## 5. Checklist post-deploy

- [ ] `ALTER ROLE app_runtime PASSWORD …` ejecutado, y `APP_DATABASE_URL` usa la nueva.
- [ ] `GET /health` del API responde `{ ok: true }`.
- [ ] Ingreso del super admin (`superadmin` + su contraseña) desde la web publicada.
- [ ] Alta del primer cliente real desde el panel de plataforma (Fase 5), que devuelve la contraseña temporal para dictarle al tendero.
- [ ] La consola del navegador no muestra errores de CORS al iniciar sesión.
- [ ] Backups automáticos visibles en Aiven (vienen activos; verificar retención).
- [ ] Ensayo de restauración agendado — el procedimiento está en [respaldos.md](respaldos.md) y ya se ejecutó una vez.

---

## 6. Despliegues siguientes

`git push` a `main`. Render reconstruye ambos servicios y el build del API aplica
las migraciones nuevas contra Aiven. **Si un push no trae migración, la base no
cambia** — es esperado que Aiven no muestre movimiento.
