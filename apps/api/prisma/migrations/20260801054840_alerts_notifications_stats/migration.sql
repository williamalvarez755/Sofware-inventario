-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'RESOLVED');

-- CreateTable
CREATE TABLE "stock_alerts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_product_id" UUID NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "triggered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "stock_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_store_stats" (
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "sales_count" INTEGER NOT NULL DEFAULT 0,
    "sales_total" BIGINT NOT NULL DEFAULT 0,
    "cost_total" BIGINT NOT NULL DEFAULT 0,
    "profit_total" BIGINT NOT NULL DEFAULT 0,
    "voided_count" INTEGER NOT NULL DEFAULT 0,
    "expenses_total" BIGINT NOT NULL DEFAULT 0,
    "purchases_total" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "daily_store_stats_pkey" PRIMARY KEY ("store_id","day")
);

-- CreateIndex
CREATE INDEX "stock_alerts_tenant_id_status_idx" ON "stock_alerts"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "daily_store_stats_tenant_id_day_idx" ON "daily_store_stats"("tenant_id", "day");

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_store_product_id_fkey" FOREIGN KEY ("store_product_id") REFERENCES "store_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Seguridad Fase 4: RLS en tablas nuevas + una sola alerta ACTIVE por producto.
-- ============================================================================

CREATE UNIQUE INDEX "uq_stock_alerts_active" ON "stock_alerts" ("store_product_id") WHERE "status" = 'ACTIVE';

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_alerts', 'notifications', 'daily_store_stats'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
    EXECUTE format(
      'CREATE POLICY admin_bypass ON %I TO CURRENT_USER USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END
$$;
