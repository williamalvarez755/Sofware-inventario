-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('OPENING', 'SALE_IN', 'SALE_VOID_OUT', 'WITHDRAWAL', 'EXPENSE_OUT', 'DEPOSIT_IN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER');

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "cash_register_id" UUID NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "opened_by" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_amount" BIGINT NOT NULL,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ,
    "expected_amount" BIGINT,
    "counted_amount" BIGINT,
    "counted_detail" JSONB,
    "difference" BIGINT,
    "notes" TEXT,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "cash_session_id" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT,
    "evidence_url" TEXT,
    "ref_type" TEXT,
    "ref_id" UUID,
    "user_id" UUID NOT NULL,
    "authorized_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counters" (
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "current_value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("store_id","doc_type")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "cash_session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "number" BIGINT NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "subtotal" BIGINT NOT NULL,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL,
    "tax_breakdown" BIGINT NOT NULL DEFAULT 0,
    "client_op_id" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ,
    "voided_by" UUID,
    "void_reason" TEXT,
    "void_authorized_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "unit_cost_at_sale" BIGINT NOT NULL DEFAULT 0,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "line_total" BIGINT NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" BIGINT NOT NULL,
    "amount_tendered" BIGINT,
    "reference" TEXT,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_registers_store_id_name_key" ON "cash_registers"("store_id", "name");

-- CreateIndex
CREATE INDEX "cash_sessions_store_id_opened_at_idx" ON "cash_sessions"("store_id", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "cash_movements_cash_session_id_created_at_idx" ON "cash_movements"("cash_session_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_store_id_created_at_idx" ON "sales"("store_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sales_cash_session_id_idx" ON "sales"("cash_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_store_id_number_key" ON "sales"("store_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenant_id_client_op_id_key" ON "sales"("tenant_id", "client_op_id");

-- CreateIndex
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");

-- CreateIndex
CREATE INDEX "sale_items_product_id_idx" ON "sale_items"("product_id");

-- CreateIndex
CREATE INDEX "sale_payments_sale_id_idx" ON "sale_payments"("sale_id");

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Seguridad Fase 2 (patrón de rls_security):
--   * RLS + FORCE en todas las tablas nuevas.
--   * Una sola sesión de caja OPEN por caja registradora.
--   * cash_movements append-only.
--   * sales: DELETE prohibido; UPDATE solo la transición COMPLETED→VOIDED
--     tocando únicamente las columnas de anulación.
-- ============================================================================

CREATE UNIQUE INDEX "uq_cash_sessions_open" ON "cash_sessions" ("cash_register_id") WHERE "status" = 'OPEN';

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cash_registers', 'cash_sessions', 'cash_movements',
    'counters', 'sales', 'sale_items', 'sale_payments'
  ] LOOP
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

-- Ledger de caja append-only
CREATE TRIGGER trg_cash_mov_immutable
  BEFORE UPDATE OR DELETE ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- sale_items y sale_payments: inmutables una vez creados
CREATE TRIGGER trg_sale_items_immutable
  BEFORE UPDATE OR DELETE ON "sale_items"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_sale_payments_immutable
  BEFORE UPDATE OR DELETE ON "sale_payments"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- sales: solo se permite la transición de anulación (D-007)
CREATE OR REPLACE FUNCTION sales_guard() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las ventas no se borran: use la anulación';
  END IF;
  IF OLD.status = 'VOIDED' THEN
    RAISE EXCEPTION 'Una venta anulada es inmutable';
  END IF;
  IF NEW.status <> 'VOIDED'
     OR NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.store_id <> OLD.store_id OR NEW.cash_session_id <> OLD.cash_session_id
     OR NEW.user_id <> OLD.user_id OR NEW.number <> OLD.number
     OR NEW.subtotal <> OLD.subtotal OR NEW.discount <> OLD.discount
     OR NEW.total <> OLD.total OR NEW.tax_breakdown <> OLD.tax_breakdown
     OR NEW.client_op_id <> OLD.client_op_id OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'En sales solo se permite la transición a VOIDED (columnas de anulación)';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_guard
  BEFORE UPDATE OR DELETE ON "sales"
  FOR EACH ROW EXECUTE FUNCTION sales_guard();
