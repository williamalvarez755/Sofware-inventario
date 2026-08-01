/*
  Warnings:

  - You are about to drop the column `totp_enabled_at` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `totp_secret` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "totp_enabled_at",
DROP COLUMN "totp_secret";

-- CreateTable
CREATE TABLE "user_totp" (
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "enabled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_totp_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_totp" ADD CONSTRAINT "user_totp_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- D-033: el segundo factor sale de `users` a su propia tabla.
--
-- Se revierte el GRANT por columnas de la migración anterior: restringir
-- columnas de `users` rompía toda consulta sin `select` explícito (autorización
-- por PIN, listados de usuarios, pruebas de aislamiento) y dejaba una trampa
-- para cada función futura. Con el secreto aislado, `users` vuelve a ser una
-- tabla normal para el runtime y el material de 2FA queda simplemente fuera de
-- su alcance, igual que refresh_tokens y recovery_codes.
-- ============================================================================
REVOKE ALL ON "users" FROM app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO app_runtime;

REVOKE ALL ON "user_totp" FROM app_runtime;
