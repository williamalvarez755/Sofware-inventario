-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('INITIAL', 'PURCHASE', 'PURCHASE_VOID', 'SALE', 'SALE_VOID', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'WASTE', 'INTERNAL_USE', 'RETURN_IN', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "allows_decimals" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category_id" UUID,
    "unit_id" UUID NOT NULL,
    "base_price" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_barcodes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "stock_qty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "avg_cost" BIGINT NOT NULL DEFAULT 0,
    "min_stock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "price_override" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "store_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unit_cost" BIGINT NOT NULL DEFAULT 0,
    "balance_after" DECIMAL(12,3) NOT NULL,
    "ref_type" TEXT,
    "ref_id" UUID,
    "user_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenant_id_name_key" ON "categories"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "units_tenant_id_code_key" ON "units"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "products_tenant_id_name_idx" ON "products"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "product_barcodes_product_id_idx" ON "product_barcodes"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_barcodes_tenant_id_barcode_key" ON "product_barcodes"("tenant_id", "barcode");

-- CreateIndex
CREATE INDEX "store_products_store_id_idx" ON "store_products"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_products_store_id_product_id_key" ON "store_products"("store_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_movements_store_id_product_id_created_at_idx" ON "inventory_movements"("store_id", "product_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "inventory_movements_ref_type_ref_id_idx" ON "inventory_movements"("ref_type", "ref_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Seguridad Fase 1 (mismo patrón que 20260801043927_rls_security):
-- RLS + FORCE en tablas nuevas, kardex inmutable, unicidad de unidades global.
-- Los GRANTs a app_runtime llegan solos vía ALTER DEFAULT PRIVILEGES.
-- ============================================================================

-- Unidades globales (tenant_id NULL): un solo código global
CREATE UNIQUE INDEX "uq_units_global_code" ON "units" ("code") WHERE "tenant_id" IS NULL;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories', 'products', 'product_barcodes', 'store_products', 'inventory_movements'
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

-- units: lectura de globales + del tenant; escritura solo del propio tenant
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "units"
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY admin_bypass ON "units" TO CURRENT_USER USING (true) WITH CHECK (true);

-- Kardex append-only (la función forbid_mutation existe desde rls_security)
CREATE TRIGGER trg_inv_mov_immutable
  BEFORE UPDATE OR DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
