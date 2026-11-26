# Fase 2 — Cosas que no quedan claras

> Propuestas de interfaz sobre el informe de usabilidad del 23/11/2026.
> **Nada de esto está implementado todavía**: la fase pide proponer antes de hacer.
> Fecha: 2026-11-25.

Los ~30 puntos del informe se agrupan por módulo. Cada uno dice qué se cambia,
qué toca en el código y qué NO se va a hacer, cuando corresponde.

---

## Lo primero: las tres que pidió el dueño

### 1. Editar y desactivar productos · existencia mínima

**Hallazgo clave de la Fase 0: esto ya existe en el API.** No hay que escribir
un endpoint ni una migración.

| Qué | Endpoint | Campos |
|---|---|---|
| Editar producto | `PATCH /api/products/:id` | `name`, `description`, `categoryId`, `price`, `isActive` |
| Config por tienda | `PATCH /api/products/:id/stores/:storeId` | `minStock`, `priceOverride`, `isActive` |

La columna `min_stock NUMERIC(12,3)` está en la base desde la Fase 1, y el
listado **ya devuelve** `minStock` y `lowStock`. Lo único que falta es la
pantalla.

**Propuesta.** La fila de Productos pasa de dos acciones (`Kardex`, `Ajustar`)
a un menú por fila con cuatro: **Editar**, **Ajustar**, **Historial** (así se
renombra Kardex, que es palabra de contador) y **Desactivar**. Un menú y no
cuatro botones: en el teléfono no caben, y es la misma razón por la que la
tabla pasa a tarjetas en pantalla angosta (ver *Productos* abajo).

El formulario de edición es el mismo de alta, precargado, más dos campos que
hoy no tienen dónde vivir:

- **Existencia mínima** (por tienda, no por producto: es `store_products`).
  Con una línea que explique para qué sirve — "cuando baje de aquí, aparece en
  *Hay que reponer*" — porque el informe muestra que nadie sabe que existe.
- **Precio para esta tienda** (el `priceOverride` que tampoco es alcanzable).

**Desactivar, no borrar.** Un producto con historial de ventas no se puede
borrar (D-007, llaves en `RESTRICT`), y está bien que así sea. El botón dice
"Desactivar" y explica que deja de aparecer en Vender pero conserva el
historial. Esto resuelve también el producto de prueba que el informe no pudo
quitar de la pantalla.

**Aviso de precio menor al costo** (hallazgo aparte, Media): al guardar, si
`price < avgCost`, se muestra una advertencia **que no bloquea** — hay
promociones y liquidaciones legítimas. Decir "Vendería con pérdida: el costo
es Q10.00" y dejar guardar.

### 2. Sugerencias al escribir en Vender

Hoy `lookup()` solo corre con Enter. Productos sí filtra al escribir, y esa
inconsistencia es la que confunde.

**Propuesta.** Lista desplegable con *debounce* de 250 ms a partir del tercer
carácter, **conservando** el camino rápido del lector: si lo escrito coincide
exacto con un código de barras, entra directo al carrito sin lista. Eso es lo
que hace rápido al lector HID y no se puede perder.

Esto resuelve de paso dos hallazgos más:

- *"Si hay un solo resultado lo agrega sin preguntar"* → por nombre siempre se
  muestra la lista; solo el código de barras agrega directo.
- *"Los resultados no dicen cuántos quedan"* → cada fila de la lista muestra
  precio **y existencia**, y la línea del carrito avisa en rojo cuando la
  cantidad supera lo disponible: "Cloro: solo hay 8". Hoy el error llega hasta
  el cobro y ni siquiera dice qué producto — eso además se arregla en el API
  (ver *Pendientes del servidor*).

### 3. Cierre de caja a ciegas

Hoy el modal muestra el esperado (Q522.00) antes de contar. Quien cuadra la
caja ve el número al que tiene que llegar, y eso convierte el arqueo en un
trámite.

**Propuesta — tres pasos, y el orden es el punto:**

1. **Contar.** Solo el campo de conteo, sin el esperado a la vista. Con
   desglose opcional por denominaciones (Q200, Q100, Q50, Q20, Q10, Q5, Q1 y
   monedas), que suma solo. El modelo ya guarda ese detalle en JSONB.
2. **Ver la diferencia.** Recién aquí aparece esperado, contado y diferencia.
3. **Confirmar.** Si hay faltante o sobrante fuera de umbral, **motivo
   obligatorio** antes de cerrar.

Lo único que toca el servidor es exigir el motivo cuando hay diferencia; el
cierre ya calcula y guarda todo lo demás.

**Riesgo que vale nombrar:** a ciegas es más lento y a un cajero apurado le va
a molestar. Es deliberado — es la diferencia entre un arqueo y una firma.

---

## Por módulo

### General

| Punto | Propuesta |
|---|---|
| El buscador (Ctrl+K) solo abre pantallas; "coca" no encuentra nada | Que busque también **productos** (por nombre, SKU y código), **ventas por número** y **proveedores**. Mientras no esté: renombrar el marcador a "Ir a…". Es un cambio de alcance real, no de etiqueta: hay que consultar el API con debounce y agrupar resultados por tipo. |
| Contraseña, tema y cerrar sesión "escondidos tras el icono de sol" | **El menú sí abre al tocar el nombre** — toda la tarjeta de la cuenta es un botón. Pero el glifo `ajustes` es, literalmente, un sol (círculo con ocho rayos). Redibujarlo como engranaje. |
| Dos nombres sin explicar: "Tienda Alejandra" y "la bandicion" | Rotular **Negocio** y **Sucursal** en la barra lateral y en los selectores. |

### Inicio

| Punto | Propuesta |
|---|---|
| "Le quedó Q22.75" parece ganancia, pero hubo Q250 de gastos | Renombrar a **"Ganancia antes de gastos"** y agregar debajo, en letra chica, el **resultado después de gastos** (que puede ser negativo y debe verse en rojo). El dato ya está: el tablero trae `expensesTotal`. |
| "Hay que reponer" dice que todo está bien con el mínimo en 0 | Se arregla solo al poder fijar el mínimo (punto 1). Además: cuando **ningún** producto tenga mínimo configurado, el panel no debe decir "todo en orden" sino "nadie tiene mínimo configurado todavía", con enlace a Productos. Decir que todo está bien cuando no se ha medido nada es mentir. |

### Vender

| Punto | Propuesta |
|---|---|
| Libra, docena y galón salen como "c/u"; el comprobante dice "2.5 x Arroz" | Mostrar la unidad real: "Q6.00 / lb" y "2.5 lb". El dato viaja (`unit.code`), solo no se usa. |
| "Vaciar carrito" borra sin confirmar | Confirmación. Ahora pesa más: con el carrito persistente, vaciar borra también lo guardado. |
| "2 artículo(s)" cuenta líneas, no unidades | Decir "3 unidades"; sumar cantidades, no filas. |
| Dejar vacío el efectivo cobra el monto exacto, sin decirlo | Botón **"Exacto"** junto a los billetes rápidos. |
| Un código inexistente dice "Sin resultados" y ahí termina | Ofrecer **"Crear producto con este código"** a quien tenga `products.manage`, reusando el alta prellenada que ya existe en Productos. |
| La referencia de tarjeta/transferencia no sale en el comprobante | Imprimirla bajo el método de pago. |

### Caja

| Punto | Propuesta |
|---|---|
| No se puede abrir turno desde Caja, aunque Inicio invita a hacerlo | Poner **"Abrir caja"** aquí también, con el mismo formulario del POS. |
| Al cerrar, el turno desaparece y no hay corte imprimible | **Lista de turnos** de la tienda con su corte: efectivo, tarjeta, transferencia, retiros, depósitos y diferencia, imprimible en 58/80 mm con la plantilla que ya existe. |
| "Depósito" suena a depósito bancario | Renombrar a **"Meter efectivo"** y **"Sacar efectivo"**. Los tipos del ledger (`DEPOSIT_IN`, `WITHDRAWAL`) no cambian: es solo la etiqueta. |
| Dos formas de sacar dinero y no se sabe cuál usar | Una línea bajo cada botón: *Retiro* = sacar efectivo para guardarlo o llevarlo al banco; *Gasto desde caja* = pagar algo (al panadero, la luz) y que quede clasificado. |
| Las ventas del turno no dicen cómo se pagaron | Mostrar el método, y corregir el texto de anulación: hoy dice "devuelve el efectivo" aunque haya sido transferencia. |

### Productos

| Punto | Propuesta |
|---|---|
| Importar CSV abre el explorador sin decir qué columnas lleva | Ventana previa con las columnas, **plantilla descargable** y vista previa de las primeras filas antes de confirmar. |
| La categoría es texto libre | Lista con las categorías existentes + opción de crear al vuelo (el API ya crea la categoría si no existe). |
| Para un conteo físico hay que calcular la diferencia a mano | Modo **"¿Cuántas hay?"**: se escribe la cantidad real y el sistema calcula el ajuste y elige entrada o salida. El endpoint de ajustes no cambia. |
| "Kardex" es palabra de contador | **"Historial"**. |
| En celular la tabla no cabe | Tarjetas en pantallas angostas, con las acciones en el menú por fila. |

### Compras

| Punto | Propuesta |
|---|---|
| El costo viene vacío, sin el último costo ni la existencia | Prellenar con el último costo de ese proveedor (`product_suppliers.lastCost`, que ya se guarda) y mostrar la existencia actual junto al producto. |
| Tocar una compra no muestra su detalle; no se pide fecha ni forma de pago | Detalle de compra con sus líneas. **Fecha y forma de pago quedan fuera por ahora**: compra retroactiva choca con D-011 (obliga a recalcular CPP hacia atrás) y "contado/crédito" es cuentas por pagar, que es un dominio propio (D-023). Van al backlog, no a esta fase. |

### Gastos

| Punto | Propuesta |
|---|---|
| "Limpieza" viene preseleccionada | Empezar sin categoría, con el selector en "Elija una…". |
| Un gasto no se puede editar ni anular | **Anular con motivo**, no editar: si salió de caja, anular tiene que generar el movimiento compensatorio igual que una venta anulada. Esto sí necesita servidor y es la única pieza de esta fase que toca un ledger. |

### Reportes

| Punto | Propuesta |
|---|---|
| Movimientos de caja no muestra fecha, apertura ni depósitos | Agregar esas columnas para que el esperado se pueda reconstruir a mano. |
| El Resumen financiero no resta mermas ni faltantes de caja | Incluir ambos. Es cambio de servicio, no de interfaz, y hay que cuidar que siga cuadrando contra los ledgers (hay pruebas de reconciliación que lo exigen). |
| Faltan totales; cantidades sin unidad; fechas en formato ISO | Fila de totales, "2 u." / "2.5 lb", y fechas "23/11/2026". |

---

## Pendientes del servidor que salen de esta fase

1. **`Stock insuficiente para esta operación` no dice qué producto**
   ([movements.service.ts:116](../apps/api/src/modules/inventory/movements.service.ts)).
   El error se lanza desde el núcleo de inventario, que no conoce el nombre;
   hay que pasarlo o resolverlo en `sales.service` antes de responder.
2. **Motivo obligatorio al cerrar caja con diferencia.**
3. **Anulación de gastos** con movimiento compensatorio.

## Orden sugerido

1. Editar/desactivar + existencia mínima (desbloquea "Hay que reponer").
2. Sugerencias al escribir + existencia en la lista + error con nombre.
3. Cierre a ciegas.
4. Renombres y textos (barato, y quita la mitad de las confusiones).
5. Lista de turnos con corte imprimible.
6. El resto, por módulo.
