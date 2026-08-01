-- ============================================================================
-- Seguridad multi-tenant (CLAUDE.md §2.2, D-002):
--   1. Rol de runtime app_runtime SIN BYPASSRLS (el API tenant conecta con él).
--   2. RLS + FORCE en toda tabla tenant-scoped (segunda capa de defensa).
--   3. Bitácora audit_logs append-only (trigger anti UPDATE/DELETE).
-- En producción (Aiven): tras el primer deploy cambiar la contraseña:
--   ALTER ROLE app_runtime PASSWORD '<secreto-fuerte>';  (ver docs/deploy.md)
-- ============================================================================

-- 1. Rol de runtime -----------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN PASSWORD 'app_runtime_dev' NOSUPERUSER NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_runtime', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
-- Tablas futuras creadas por el rol de migraciones heredan los permisos:
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

-- El runtime JAMÁS toca credenciales de plataforma ni sesiones (auth usa el
-- cliente admin exclusivamente — ver src/lib/prisma.ts):
REVOKE ALL ON platform_users FROM app_runtime;
REVOKE ALL ON refresh_tokens FROM app_runtime;
-- Catálogos globales: solo lectura
REVOKE INSERT, UPDATE, DELETE ON plans, permissions, role_permissions FROM app_runtime;
-- La tabla de control de migraciones no le incumbe (no existe en la shadow DB)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = '_prisma_migrations'
  ) THEN
    REVOKE ALL ON _prisma_migrations FROM app_runtime;
  END IF;
END
$$;

-- 2. RLS ----------------------------------------------------------------------
-- El contexto lo fija la app por transacción:
--   SELECT set_config('app.tenant_id', '<uuid>', TRUE);
-- current_setting(..., true) devuelve NULL si no hay contexto → 0 filas.

-- tenants: el tenant solo ve/edita SU propia fila
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);

-- Tablas con columna tenant_id
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'subscriptions', 'users', 'stores', 'store_members', 'audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END
$$;

-- Nota: FORCE somete también al dueño de las tablas (rol de migraciones/admin).
-- El módulo de plataforma y el pre-login de auth necesitan operar sin contexto
-- de tenant, así que el rol admin recibe política explícita de paso total.
-- app_runtime NO está en esta política: su única vía es tenant_isolation.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants', 'subscriptions', 'users', 'stores', 'store_members', 'audit_logs'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY admin_bypass ON %I TO CURRENT_USER USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END
$$;

-- 3. Auditoría append-only ----------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'La tabla % es append-only: % prohibido', TG_TABLE_NAME, TG_OP;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
