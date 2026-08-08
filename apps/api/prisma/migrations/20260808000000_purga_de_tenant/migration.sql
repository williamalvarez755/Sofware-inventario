-- ============================================================================
-- Purga definitiva de un cliente que se dio de baja.
--
-- El sistema fue construido para que los ledgers NO se puedan borrar (D-007):
-- nueve disparadores rechazan DELETE en ventas, caja, kardex, bitácora y
-- compras. Eso es lo que lo hace auditable, y no se toca.
--
-- Pero un SaaS necesita poder retirar de verdad a un cliente que se fue: sus
-- datos ocupan lugar, aparecen en los reportes globales y —sobre todo— si
-- pide que se borren, no se le puede responder que es técnicamente imposible.
--
-- La salida es una puerta con llave, no un boquete:
--   1. Solo se abre dentro de la transacción que la declara (SET LOCAL), así
--      que no existe fuera de esa operación.
--   2. El rol de ejecución de la aplicación (app_runtime) NUNCA puede abrirla,
--      aunque declare la variable. La purga solo la puede hacer el rol
--      administrativo, que es el del módulo de plataforma.
--
-- Con esas dos condiciones, un fallo de la aplicación —o un atacante que llegue
-- hasta app_runtime— sigue sin poder borrar un solo movimiento.
-- ============================================================================

CREATE OR REPLACE FUNCTION purga_autorizada() RETURNS boolean AS $fn$
BEGIN
  RETURN current_setting('app.purge_tenant', true) = 'on'
     AND current_user <> 'app_runtime';
END;
$fn$ LANGUAGE plpgsql STABLE;

-- Tablas append-only: se permite el DELETE solo bajo purga autorizada.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' AND purga_autorizada() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'La tabla % es append-only: % prohibido', TG_TABLE_NAME, TG_OP;
END;
$fn$ LANGUAGE plpgsql;

-- sales: el DELETE sigue prohibido salvo purga; el resto del guard intacto.
CREATE OR REPLACE FUNCTION sales_guard() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF purga_autorizada() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Las ventas no se borran: use la anulación';
  END IF;
  IF OLD.status = 'VOIDED' THEN
    RAISE EXCEPTION 'Una venta anulada es inmutable';
  END IF;
  IF NEW.status <> 'VOIDED'
     OR NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.store_id <> OLD.store_id OR NEW.number <> OLD.number
     OR NEW.total <> OLD.total OR NEW.subtotal <> OLD.subtotal
     OR NEW.discount <> OLD.discount OR NEW.cash_session_id <> OLD.cash_session_id
     OR NEW.user_id <> OLD.user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'En sales solo se permite la transición a VOIDED (columnas de anulación)';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION purchases_guard() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF purga_autorizada() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Las compras no se borran: use la anulación';
  END IF;
  IF OLD.status = 'VOIDED' THEN
    RAISE EXCEPTION 'Una compra anulada es inmutable';
  END IF;
  IF NEW.status <> 'VOIDED'
     OR NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.store_id <> OLD.store_id OR NEW.supplier_id <> OLD.supplier_id
     OR NEW.total <> OLD.total OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'En purchases solo se permite la transición a VOIDED';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- Nota: gastos, kardex, caja, bitácora, items y pagos de venta y items de
-- compra usan todos forbid_mutation(), así que quedaron cubiertos arriba.
