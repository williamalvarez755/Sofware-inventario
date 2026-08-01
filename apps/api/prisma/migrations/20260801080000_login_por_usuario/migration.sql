-- ============================================================================
-- D-036: el ingreso pasa de correo a NOMBRE DE USUARIO.
--
-- Motivo: un cajero de tienda de barrio no siempre tiene correo, y teclear
-- "maria.lopez@abarroteria-el-ahorro.com" en cada turno es una fricción real
-- frente al cliente. El correo se conserva (sirve para avisos y para el
-- contacto del dueño), pero deja de ser lo que se escribe para entrar.
--
-- Respaldo de los datos existentes: se toma la parte del correo anterior al
-- arroba y, si hubiera colisión entre tenants, se numera.
-- ============================================================================

-- ── users ───────────────────────────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN "username" TEXT;

WITH numerados AS (
  SELECT id,
         lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g')) AS base,
         ROW_NUMBER() OVER (
           PARTITION BY lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g'))
           ORDER BY created_at
         ) AS n
  FROM users
)
UPDATE users u
SET username = CASE WHEN nu.n = 1 THEN nu.base ELSE nu.base || nu.n::text END
FROM numerados nu
WHERE nu.id = u.id;

-- Red de seguridad: si algún correo dejara la base vacía, se usa el id corto.
UPDATE users SET username = 'usuario-' || left(id::text, 8)
WHERE username IS NULL OR username = '';

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- ── platform_users ──────────────────────────────────────────────────────────
ALTER TABLE "platform_users" ADD COLUMN "username" TEXT;

WITH numerados AS (
  SELECT id,
         lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g')) AS base,
         ROW_NUMBER() OVER (
           PARTITION BY lower(regexp_replace(split_part(email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g'))
           ORDER BY created_at
         ) AS n
  FROM platform_users
)
UPDATE platform_users p
SET username = CASE WHEN nu.n = 1 THEN nu.base ELSE nu.base || nu.n::text END
FROM numerados nu
WHERE nu.id = p.id;

UPDATE platform_users SET username = 'admin-' || left(id::text, 8)
WHERE username IS NULL OR username = '';

ALTER TABLE "platform_users" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "platform_users_username_key" ON "platform_users"("username");
