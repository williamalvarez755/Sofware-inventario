-- Costo promedio ponderado con 4 decimales de centavo.
--
-- EL PROBLEMA (informe de usabilidad del 23/11/2026, prioridad Baja):
--   "El costo promedio se guarda con 2 decimales y el valor no cuadra:
--    Coca-Cola 600 ml vale Q388.37, pero se pagaron Q388.20."
--
-- `avg_cost` era BIGINT en centavos enteros, así que cada recálculo del CPP
-- redondeaba al centavo. Ese medio centavo de error se MULTIPLICA por la
-- existencia al valorizar el inventario (stock_qty × avg_cost) y se ACUMULA
-- en cada compra. Con 24 unidades y dos compras, bastó para desviar la
-- valorización 17 centavos de lo realmente pagado.
--
-- El costo promedio no es dinero que se cobre: es un valor DERIVADO que sirve
-- para valorizar y para congelar el costo de cada venta. Guardarlo al centavo
-- era aplicarle una regla (A9: dinero en centavos enteros) que está pensada
-- para los montos que de verdad se pagan. Los montos siguen en BIGINT; lo que
-- gana decimales es solo este promedio.
--
-- COMPATIBILIDAD: ensanchar BIGINT a NUMERIC(16,4) no pierde ni un dato — los
-- valores actuales pasan a x.0000 — y PostgreSQL lo hace con una conversión
-- implícita, sin reescribir nada a mano. Las lecturas siguen devolviendo el
-- mismo número; lo único que cambia es que ahora caben los decimales.
--
-- 16 dígitos con 4 decimales = hasta 99 999 999 999.9999 centavos, o sea unos
-- mil millones de quetzales por unidad. De sobra para cualquier producto.

ALTER TABLE "store_products"
  ALTER COLUMN "avg_cost" TYPE NUMERIC(16, 4) USING "avg_cost"::numeric,
  ALTER COLUMN "avg_cost" SET DEFAULT 0;
