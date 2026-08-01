-- AlterTable
ALTER TABLE "platform_users" ADD COLUMN     "totp_enabled_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totp_enabled_at" TIMESTAMPTZ,
ADD COLUMN     "totp_secret" TEXT;

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "platform_user_id" UUID,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");

-- CreateIndex
CREATE INDEX "recovery_codes_platform_user_id_idx" ON "recovery_codes"("platform_user_id");

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Seguridad: los secretos de 2FA y los códigos de recuperación son material
-- de autenticación. El rol de runtime NO los toca (igual que refresh_tokens y
-- platform_users): solo el flujo de auth, que corre con el rol admin.
-- ============================================================================
REVOKE ALL ON "recovery_codes" FROM app_runtime;

-- La columna totp_secret de users queda fuera del alcance del runtime:
-- se le concede explícitamente el resto de columnas.
REVOKE ALL ON "users" FROM app_runtime;
GRANT SELECT (id, tenant_id, email, name, phone, supervisor_pin_hash,
              must_change_password, is_active, last_login_at, totp_enabled_at,
              created_at, updated_at),
      INSERT, DELETE
  ON "users" TO app_runtime;
GRANT UPDATE (name, phone, supervisor_pin_hash, must_change_password,
              is_active, updated_at)
  ON "users" TO app_runtime;
