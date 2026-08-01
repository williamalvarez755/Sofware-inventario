-- ============================================================================
-- schema.sql — Modelo relacional de referencia (PostgreSQL 16)
-- SaaS multi-tenant: inventario, POS, caja y proveedores para mini markets (GT)
--
-- ESTADO: especificación de diseño. Las migraciones reales se generarán con
-- Prisma en Fase 0; este archivo es la fuente de verdad del diseño y debe
-- mantenerse sincronizado con el esquema Prisma.
--
-- Convenciones:
--   * PK: UUID v7 generado por la aplicación (ordenable por tiempo).
--   * Dinero: BIGINT en centavos de Quetzal (GTQ). Nunca FLOAT/NUMERIC para dinero.
--   * Cantidades de stock: NUMERIC(12,3) (soporta granel: libras, litros).
--   * Timestamps: TIMESTAMPTZ en UTC.
--   * Toda tabla tenant-scoped: columna tenant_id + política RLS.
--   * Ledgers (kardex, caja, auditoría): INSERT-only, protegidos por trigger.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- búsqueda de productos por nombre

-- ============================================================================
-- 1. PLATAFORMA (sin RLS de tenant: solo accesible por rol de plataforma)
-- ============================================================================

CREATE TABLE plans (
    id              UUID PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,           -- 'basic', 'multi', ...
    name            TEXT NOT NULL,
    max_stores      INT  NOT NULL CHECK (max_stores >= 1),
    max_users       INT  NOT NULL CHECK (max_users >= 1),
    monthly_price   BIGINT NOT NULL CHECK (monthly_price >= 0),  -- centavos GTQ
    features        JSONB NOT NULL DEFAULT '{}',    -- flags de funcionalidad
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
    id              UUID PRIMARY KEY,
    name            TEXT NOT NULL,                  -- razón social / nombre del negocio
    slug            TEXT NOT NULL UNIQUE,           -- identificador legible
    status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','SUSPENDED','CANCELLED')),
    suspended_reason TEXT,                          -- mora, inactividad, administrativa
    contact_name    TEXT,
    contact_email   TEXT,
    contact_phone   TEXT,
    tax_id          TEXT,                           -- NIT del negocio (opcional v1)
    tax_regime      TEXT NOT NULL DEFAULT 'NINGUNO'
                    CHECK (tax_regime IN ('GENERAL','PEQUENO_CONTRIBUYENTE','NINGUNO')),
    settings        JSONB NOT NULL DEFAULT '{}',    -- allow_negative_stock, umbrales PIN, pie de ticket global...
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    plan_id         UUID NOT NULL REFERENCES plans(id)   ON DELETE RESTRICT,
    status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('TRIAL','ACTIVE','PAST_DUE','CANCELLED')),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    amount          BIGINT NOT NULL CHECK (amount >= 0),
    payment_note    TEXT,                            -- v1: registro manual de pago
    created_by      UUID,                            -- platform_user que la registró
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (period_end > period_start)
);
CREATE INDEX idx_subscriptions_tenant ON subscriptions (tenant_id, period_end DESC);

CREATE TABLE platform_users (                        -- super admins (separados de users)
    id              UUID PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    password_hash   TEXT NOT NULL,                   -- Argon2id
    totp_secret     TEXT,                            -- 2FA obligatorio (fase 6)
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. IDENTIDAD (tenant-scoped)
-- ============================================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    email           TEXT NOT NULL UNIQUE,            -- único GLOBAL en v1 (D-018): login sin selector de tenant
    name            TEXT NOT NULL,
    phone           TEXT,
    password_hash   TEXT NOT NULL,                   -- Argon2id
    supervisor_pin_hash TEXT,                        -- PIN corto para autorizaciones en POS (solo admins)
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,   -- desactivar = baja de personal
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stores (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name            TEXT NOT NULL,
    address         TEXT,
    phone           TEXT,
    receipt_header  TEXT,                            -- encabezado del ticket
    receipt_footer  TEXT,                            -- pie del ticket ("¡Gracias por su compra!")
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

-- Membresía usuario↔tienda con rol. OWNER se asigna a todas las tiendas del tenant.
CREATE TABLE store_members (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    store_id        UUID NOT NULL REFERENCES stores(id)  ON DELETE RESTRICT,
    user_id         UUID NOT NULL REFERENCES users(id)   ON DELETE RESTRICT,
    role            TEXT NOT NULL CHECK (role IN ('OWNER','STORE_ADMIN','WORKER')),
    extra_permissions JSONB NOT NULL DEFAULT '[]',   -- permisos adicionales puntuales (p.ej. purchases.receive)
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (store_id, user_id)
);
CREATE INDEX idx_store_members_user ON store_members (user_id) WHERE is_active;

-- Catálogo RBAC (seed fijo en v1; habilita roles custom a futuro sin migración)
CREATE TABLE permissions (
    id              SERIAL PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,            -- 'sales.create', 'sales.void', 'costs.view', ...
    description     TEXT NOT NULL
);

CREATE TABLE role_permissions (
    role            TEXT NOT NULL,                   -- 'OWNER' | 'STORE_ADMIN' | 'WORKER'
    permission_id   INT  NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role, permission_id)
);

-- Sesiones por dispositivo: rotación de refresh token + detección de reuso
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY,
    tenant_id       UUID,                            -- NULL => platform_user
    user_id         UUID,                            -- exactamente uno de user_id/platform_user_id
    platform_user_id UUID REFERENCES platform_users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,            -- nunca el token en claro
    family_id       UUID NOT NULL,                   -- cadena de rotación (detección de reuso)
    device_info     TEXT,
    ip              INET,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((user_id IS NOT NULL) <> (platform_user_id IS NOT NULL))
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- ============================================================================
-- 3. CATÁLOGO (tenant-scoped)
-- ============================================================================

CREATE TABLE categories (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name            TEXT NOT NULL,
    deleted_at      TIMESTAMPTZ,                     -- soft delete (solo catálogos)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE units (
    id              UUID PRIMARY KEY,
    tenant_id       UUID REFERENCES tenants(id) ON DELETE RESTRICT,  -- NULL = seed global
    code            TEXT NOT NULL,                   -- 'UNIDAD','LIBRA','LITRO','DOCENA'
    name            TEXT NOT NULL,
    allows_decimals BOOLEAN NOT NULL DEFAULT FALSE,  -- granel => TRUE
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_units_code ON units (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

-- Maestro de productos por TENANT (el stock vive en store_products)
CREATE TABLE products (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    sku             TEXT NOT NULL,                   -- código interno
    name            TEXT NOT NULL,
    description     TEXT,
    category_id     UUID REFERENCES categories(id) ON DELETE RESTRICT,
    unit_id         UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
    base_price      BIGINT NOT NULL CHECK (base_price >= 0),   -- centavos, IVA incluido
    image_url       TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, sku)
);
CREATE INDEX idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX idx_products_tenant_active ON products (tenant_id) WHERE is_active AND deleted_at IS NULL;

-- Varios códigos por producto (presentaciones, códigos pesables). Búsqueda POS O(1).
CREATE TABLE product_barcodes (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id)  ON DELETE RESTRICT,
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    barcode         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, barcode)
);
CREATE INDEX idx_product_barcodes_product ON product_barcodes (product_id);

-- CORAZÓN DEL INVENTARIO: existencia del producto en cada tienda.
-- stock_qty es materializado; la fuente de verdad es inventory_movements.
CREATE TABLE store_products (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id)  ON DELETE RESTRICT,
    store_id        UUID NOT NULL REFERENCES stores(id)   ON DELETE RESTRICT,
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    stock_qty       NUMERIC(12,3) NOT NULL DEFAULT 0,
    avg_cost        BIGINT NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),  -- CPP en centavos
    min_stock       NUMERIC(12,3) NOT NULL DEFAULT 0,                 -- umbral de alerta
    price_override  BIGINT CHECK (price_override >= 0),               -- NULL = usa base_price
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (store_id, product_id)
    -- El CHECK stock_qty >= 0 se aplica vía lógica de dominio: es relajable
    -- por tenant (settings.allow_negative_stock). Ver CLAUDE.md A4.
);
CREATE INDEX idx_store_products_low_stock ON store_products (store_id)
    WHERE is_active AND stock_qty <= min_stock;

CREATE TABLE suppliers (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name            TEXT NOT NULL,
    tax_id          TEXT,                            -- NIT
    contact_name    TEXT,
    phone           TEXT,
    email           TEXT,
    notes           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE product_suppliers (
    tenant_id       UUID NOT NULL REFERENCES tenants(id)   ON DELETE RESTRICT,
    product_id      UUID NOT NULL REFERENCES products(id)  ON DELETE RESTRICT,
    supplier_id     UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    supplier_sku    TEXT,
    last_cost       BIGINT CHECK (last_cost >= 0),   -- sugerido al recibir compra
    last_purchase_at TIMESTAMPTZ,
    PRIMARY KEY (product_id, supplier_id)
);

-- ============================================================================
-- 4. INVENTARIO — KARDEX (ledger inmutable, particionado por mes)
-- ============================================================================

CREATE TABLE inventory_movements (
    id              UUID NOT NULL,
    tenant_id       UUID NOT NULL,
    store_id        UUID NOT NULL,
    product_id      UUID NOT NULL,
    type            TEXT NOT NULL CHECK (type IN (
                        'PURCHASE','PURCHASE_VOID','SALE','SALE_VOID',
                        'ADJUSTMENT_IN','ADJUSTMENT_OUT','WASTE','INTERNAL_USE',
                        'RETURN_IN','TRANSFER_IN','TRANSFER_OUT','INITIAL')),
    qty             NUMERIC(12,3) NOT NULL CHECK (qty <> 0),  -- con signo: + entra, - sale
    unit_cost       BIGINT NOT NULL DEFAULT 0,       -- costo unitario del movimiento (centavos)
    balance_after   NUMERIC(12,3) NOT NULL,          -- snapshot => kardex sin recomputar
    ref_type        TEXT,                            -- 'sale' | 'purchase' | 'adjustment' | ...
    ref_id          UUID,                            -- documento origen
    user_id         UUID NOT NULL,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
-- Particiones mensuales creadas por job (ej.: inventory_movements_2026_08).

CREATE INDEX idx_inv_mov_kardex ON inventory_movements (store_id, product_id, created_at DESC);
CREATE INDEX idx_inv_mov_ref    ON inventory_movements (ref_type, ref_id);

-- ============================================================================
-- 5. VENTAS
-- ============================================================================

-- Correlativos transaccionales por tienda y tipo de documento
CREATE TABLE counters (
    tenant_id       UUID NOT NULL,
    store_id        UUID NOT NULL,
    doc_type        TEXT NOT NULL,                   -- 'SALE', futuro: 'FEL', ...
    current_value   BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (store_id, doc_type)
);

CREATE TABLE sales (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    store_id        UUID NOT NULL REFERENCES stores(id)  ON DELETE RESTRICT,
    cash_session_id UUID NOT NULL,                   -- FK a cash_sessions (definida abajo)
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    number          BIGINT NOT NULL,                 -- correlativo por tienda (counters)
    status          TEXT NOT NULL DEFAULT 'COMPLETED'
                    CHECK (status IN ('COMPLETED','VOIDED')),
    subtotal        BIGINT NOT NULL CHECK (subtotal >= 0),
    discount        BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0),
    total           BIGINT NOT NULL CHECK (total >= 0),
    tax_breakdown   BIGINT NOT NULL DEFAULT 0,       -- IVA informativo incluido en total
    client_op_id    UUID NOT NULL,                   -- idempotencia POS (reintentos de red)
    voided_at       TIMESTAMPTZ,
    voided_by       UUID REFERENCES users(id),
    void_reason     TEXT,
    void_authorized_by UUID REFERENCES users(id),    -- admin que autorizó (PIN)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (store_id, number),
    UNIQUE (tenant_id, client_op_id),
    CHECK (discount <= subtotal),
    CHECK (status = 'COMPLETED' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE INDEX idx_sales_store_date   ON sales (store_id, created_at DESC);
CREATE INDEX idx_sales_session      ON sales (cash_session_id);
CREATE INDEX idx_sales_user_date    ON sales (user_id, created_at DESC);

CREATE TABLE sale_items (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    sale_id         UUID NOT NULL REFERENCES sales(id)    ON DELETE RESTRICT,
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    qty             NUMERIC(12,3) NOT NULL CHECK (qty > 0),
    unit_price      BIGINT NOT NULL CHECK (unit_price >= 0),   -- congelado al vender
    unit_cost_at_sale BIGINT NOT NULL DEFAULT 0,               -- CPP congelado => utilidad histórica inmutable
    discount        BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0),
    line_total      BIGINT NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX idx_sale_items_sale    ON sale_items (sale_id);
CREATE INDEX idx_sale_items_product ON sale_items (product_id);

CREATE TABLE sale_payments (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    sale_id         UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
    method          TEXT NOT NULL CHECK (method IN ('CASH','CARD','TRANSFER')),
    amount          BIGINT NOT NULL CHECK (amount > 0),
    amount_tendered BIGINT,                          -- efectivo recibido (para cambio)
    reference       TEXT                             -- nº de voucher / transferencia
);
CREATE INDEX idx_sale_payments_sale ON sale_payments (sale_id);

-- ============================================================================
-- 6. CAJA
-- ============================================================================

CREATE TABLE cash_registers (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    store_id        UUID NOT NULL REFERENCES stores(id)  ON DELETE RESTRICT,
    name            TEXT NOT NULL,                   -- 'Caja 1', 'Caja turno noche'
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (store_id, name)
);

CREATE TABLE cash_sessions (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id)        ON DELETE RESTRICT,
    store_id        UUID NOT NULL REFERENCES stores(id)         ON DELETE RESTRICT,
    cash_register_id UUID NOT NULL REFERENCES cash_registers(id) ON DELETE RESTRICT,
    status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
    opened_by       UUID NOT NULL REFERENCES users(id),
    opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    opening_amount  BIGINT NOT NULL CHECK (opening_amount >= 0),
    closed_by       UUID REFERENCES users(id),
    closed_at       TIMESTAMPTZ,
    expected_amount BIGINT,                          -- calculado al cierre
    counted_amount  BIGINT,                          -- conteo físico
    counted_detail  JSONB,                           -- desglose por denominaciones (opcional)
    difference      BIGINT,                          -- counted - expected (+ sobrante / - faltante)
    notes           TEXT,
    CHECK (status = 'OPEN' OR (closed_at IS NOT NULL AND counted_amount IS NOT NULL))
);
-- Una sola sesión abierta por caja:
CREATE UNIQUE INDEX uq_cash_sessions_open ON cash_sessions (cash_register_id) WHERE status = 'OPEN';
CREATE INDEX idx_cash_sessions_store ON cash_sessions (store_id, opened_at DESC);

ALTER TABLE sales ADD CONSTRAINT fk_sales_cash_session
    FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id) ON DELETE RESTRICT;

-- Ledger inmutable de caja
CREATE TABLE cash_movements (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    store_id        UUID NOT NULL,
    cash_session_id UUID NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
    type            TEXT NOT NULL CHECK (type IN (
                        'OPENING','SALE_IN','SALE_VOID_OUT','WITHDRAWAL',
                        'EXPENSE_OUT','DEPOSIT_IN','ADJUSTMENT')),
    amount          BIGINT NOT NULL CHECK (amount <> 0),   -- con signo: + entra, - sale
    reason          TEXT,                            -- OBLIGATORIO en egresos (validado en dominio + trigger)
    evidence_url    TEXT,                            -- foto en S3 (retiros/gastos)
    ref_type        TEXT,                            -- 'sale' | 'expense' | NULL
    ref_id          UUID,
    user_id         UUID NOT NULL,                   -- quien registra
    authorized_by   UUID,                            -- admin que autorizó con PIN (retiros de worker)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (amount > 0 OR reason IS NOT NULL)         -- todo egreso lleva motivo
);
CREATE INDEX idx_cash_movements_session ON cash_movements (cash_session_id, created_at);

-- ============================================================================
-- 7. COMPRAS Y GASTOS
-- ============================================================================

CREATE TABLE purchases (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id)   ON DELETE RESTRICT,
    store_id        UUID NOT NULL REFERENCES stores(id)    ON DELETE RESTRICT,
    supplier_id     UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    user_id         UUID NOT NULL REFERENCES users(id),
    status          TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','VOIDED')),
    supplier_invoice TEXT,                           -- nº de factura del proveedor
    purchased_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    total           BIGINT NOT NULL CHECK (total >= 0),
    notes           TEXT,
    voided_at       TIMESTAMPTZ,
    voided_by       UUID REFERENCES users(id),
    void_reason     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_purchases_store_date ON purchases (store_id, purchased_at DESC);
CREATE INDEX idx_purchases_supplier   ON purchases (supplier_id, purchased_at DESC);

CREATE TABLE purchase_items (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    purchase_id     UUID NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
    product_id      UUID NOT NULL REFERENCES products(id)  ON DELETE RESTRICT,
    qty             NUMERIC(12,3) NOT NULL CHECK (qty > 0),
    unit_cost       BIGINT NOT NULL CHECK (unit_cost > 0),
    line_total      BIGINT NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX idx_purchase_items_purchase ON purchase_items (purchase_id);
CREATE INDEX idx_purchase_items_product  ON purchase_items (product_id);

CREATE TABLE expense_categories (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name            TEXT NOT NULL,                   -- seed: Servicios, Transporte, Limpieza...
    deleted_at      TIMESTAMPTZ,
    UNIQUE (tenant_id, name)
);

CREATE TABLE expenses (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    store_id        UUID NOT NULL REFERENCES stores(id)  ON DELETE RESTRICT,
    category_id     UUID NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
    cash_session_id UUID REFERENCES cash_sessions(id),   -- NULL si no salió de caja
    user_id         UUID NOT NULL REFERENCES users(id),
    amount          BIGINT NOT NULL CHECK (amount > 0),
    description     TEXT NOT NULL,                   -- justificación obligatoria
    evidence_url    TEXT,
    expensed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_store_date ON expenses (store_id, expensed_at DESC);

-- ============================================================================
-- 8. ALERTAS, NOTIFICACIONES, AGREGADOS
-- ============================================================================

CREATE TABLE stock_alerts (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    store_product_id UUID NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RESOLVED')),
    triggered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ,
    notified_at     TIMESTAMPTZ                      -- anti re-notificación
);
CREATE UNIQUE INDEX uq_stock_alerts_active ON stock_alerts (store_product_id) WHERE status = 'ACTIVE';

CREATE TABLE notifications (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,                   -- 'STOCK_LOW','CASH_DIFFERENCE',...
    title           TEXT NOT NULL,
    body            TEXT,
    data            JSONB NOT NULL DEFAULT '{}',
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- Agregados diarios precalculados (job nocturno) => dashboards instantáneos
CREATE TABLE daily_store_stats (
    tenant_id       UUID NOT NULL,
    store_id        UUID NOT NULL,
    day             DATE NOT NULL,
    sales_count     INT    NOT NULL DEFAULT 0,
    sales_total     BIGINT NOT NULL DEFAULT 0,
    cost_total      BIGINT NOT NULL DEFAULT 0,
    profit_total    BIGINT NOT NULL DEFAULT 0,
    voided_count    INT    NOT NULL DEFAULT 0,
    expenses_total  BIGINT NOT NULL DEFAULT 0,
    purchases_total BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (store_id, day)
);

-- ============================================================================
-- 9. AUDITORÍA (append-only, particionada por mes)
-- ============================================================================

CREATE TABLE audit_logs (
    id              UUID NOT NULL,
    tenant_id       UUID,                            -- NULL => acción de plataforma
    store_id        UUID,
    user_id         UUID,                            -- actor tenant
    platform_user_id UUID,                           -- actor super admin
    impersonating   BOOLEAN NOT NULL DEFAULT FALSE,  -- super admin "viendo como" tenant
    action          TEXT NOT NULL,                   -- catálogo: 'sale.void','cash.withdrawal',...
    entity_type     TEXT,
    entity_id       UUID,
    before          JSONB,
    after           JSONB,
    ip              INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_audit_tenant_date ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX idx_audit_action      ON audit_logs (action, created_at DESC);
CREATE INDEX idx_audit_entity      ON audit_logs (entity_type, entity_id);

-- ============================================================================
-- 10. INMUTABILIDAD DE LEDGERS (trigger anti UPDATE/DELETE)
-- ============================================================================

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Tabla % es append-only: % prohibido', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inv_mov_immutable  BEFORE UPDATE OR DELETE ON inventory_movements
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_cash_mov_immutable BEFORE UPDATE OR DELETE ON cash_movements
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_audit_immutable    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
-- sales: DELETE prohibido; UPDATE solo para transición a VOIDED (función dedicada
-- en la capa de dominio; trigger valida que solo cambien columnas de anulación).

-- ============================================================================
-- 11. ROW LEVEL SECURITY (aislamiento multi-tenant, segunda capa de defensa)
-- ============================================================================
-- La app abre cada transacción con:  SET LOCAL app.tenant_id = '<uuid>';
-- El rol de conexión de la app NO tiene BYPASSRLS.
-- El Super Admin usa un rol distinto (platform_role) con políticas propias.

-- Patrón aplicado a TODAS las tablas con columna tenant_id:
--   users, stores, store_members, refresh_tokens, categories, units (custom),
--   products, product_barcodes, store_products, suppliers, product_suppliers,
--   inventory_movements, counters, sales, sale_items, sale_payments,
--   cash_registers, cash_sessions, cash_movements, purchases, purchase_items,
--   expense_categories, expenses, stock_alerts, notifications,
--   daily_store_stats, audit_logs (tenant ve solo lo suyo)
--
-- Ejemplo (repetir por tabla; en la migración real se genera con un script):

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================================================
-- FIN — Ver CLAUDE.md §5 para la justificación de cada tabla y §7 para las
-- reglas de integridad aplicadas en la capa de dominio.
-- ============================================================================
