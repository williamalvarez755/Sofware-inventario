# Fase 3 — Funciones nuevas: diseño

> Diseño de las siete funciones del cuadro **"Hacer primero"** del informe
> *Funciones para destacar* (mucho impacto, poco esfuerzo), más la propuesta
> de arquitectura de FEL y del modo sin internet.
> **Nada de esto está implementado.** Fecha: 2026-11-25.

Cada función dice: qué cambia en la base, qué endpoints hacen falta, qué
pantallas, y los riesgos. Donde la estimación del informe no coincide con lo
que hay en el código, se dice.

---

## 1. Ticket térmico de 58 y 80 mm

**Lo que ya existe y el informe no sabía:** la impresión ESC/POS vía QZ Tray
está hecha desde la Fase 6 ([escpos.ts](../apps/web/src/lib/escpos.ts)), con
corte parcial, apertura de gaveta y 7 pruebas sobre los bytes exactos. También
la impresión por CSS para 58/80 mm. **Esta función está en gran parte hecha.**

Lo que falta de verdad:

- **QR en el ticket** que lleve al comprobante digital (y mañana a la factura
  FEL). ESC/POS tiene comando nativo de QR (`GS ( k`); hay que emitirlo.
- **Logo del negocio** en la cabecera (ESC/POS `GS v 0` con un bitmap
  monocromo; implica subir y convertir la imagen).
- **Datos del negocio en el ticket**: NIT, dirección y teléfono — que hoy no
  se pueden editar en ninguna pantalla (ver función 8 del informe,
  *Configuración del negocio*).

| | |
|---|---|
| **Base de datos** | Nada nuevo. `stores` ya tiene nombre comercial, dirección, teléfono y pie de ticket. |
| **Endpoints** | `PATCH /api/stores/:id` para editar esos datos (no existe). |
| **Pantallas** | Configuración del negocio; vista previa del ticket. |
| **Riesgos** | El logo en ESC/POS es el punto delicado: cada marca interpreta el bitmap distinto y no hay dos impresoras para probar (criterio abierto de la Fase 6). Empezar sin logo. |

**Esfuerzo real: bajo**, bastante menor de lo que supone el diagrama.

---

## 2. Venta en espera

Pausar un carrito para atender a otro cliente.

| | |
|---|---|
| **Base de datos** | Ninguna tabla. Se guarda en el navegador, reusando [`carrito.ts`](../apps/web/src/lib/carrito.ts) con varias ranuras por caja: la clave pasa de `mm.carrito.<tienda>.<caja>` a `…​.<caja>.<ranura>`. |
| **Endpoints** | Ninguno. |
| **Pantallas** | Botón "Dejar en espera" junto a Cobrar; una fila de pestañas con los carritos pausados y su total; "Retomar" y "Descartar". |
| **Riesgos** | Que se acumulen carritos olvidados. Mitigación: la vigencia de 12 horas que ya tiene el carrito, y un tope de 5 ranuras. |

**La decisión importante:** NO guardar en el servidor. Una venta en espera no
es un documento, es un borrador de mostrador; subirla obligaría a inventar
estados, limpieza y qué pasa si dos cajas la retoman. **Esfuerzo: muy bajo**,
porque la persistencia ya está construida.

---

## 3. Botones rápidos

Cuadrícula con los productos sin código más vendidos: pan, tortillas, huevos.

| | |
|---|---|
| **Base de datos** | `store_product_quick` (tenant_id, store_id, product_id, posición). Alternativa sin migración: derivarlos de los más vendidos de los últimos 30 días — pero el pan no siempre es lo más vendido y el tendero quiere decidir. Mejor tabla. |
| **Endpoints** | `GET/PUT /api/stores/:id/rapidos`. |
| **Pantallas** | Cuadrícula de 6–9 botones sobre el carrito en Vender; en Productos, "Fijar en Vender". |
| **Riesgos** | Ninguno serio. Cuidar que en el teléfono no empuje el carrito fuera de la pantalla. |

---

## 4. Cierre a ciegas

Ya diseñado en la [Fase 2](fase2-interfaz.md#3-cierre-de-caja-a-ciegas). Es
interfaz más "motivo obligatorio si hay diferencia" en el servidor.

---

## 5. Resumen diario por WhatsApp

Al cerrar la caja, un mensaje con ventas, ganancia, diferencias y productos
por agotarse.

| | |
|---|---|
| **Base de datos** | `tenants.settings` (JSONB, ya existe): número de destino y si está activo. |
| **Endpoints** | Nada nuevo hacia afuera; un envío al cerrar el turno. |
| **Pantallas** | Configuración: número y casilla de activar. |
| **Riesgos** | **El grande**: la API de WhatsApp Business no es gratis ni instantánea de obtener — hace falta una cuenta Meta Business verificada y plantillas aprobadas, y las plantillas tardan días. |

**Recomendación: empezar por el camino barato.** Un botón "Enviar por
WhatsApp" que abra `wa.me` con el texto armado. Cero costo, cero verificación,
funciona hoy; lo manda la persona en vez del servidor. El envío automático
queda para cuando haya clientes que lo paguen. **El diagrama lo pone en
"mucho impacto, poco esfuerzo" y eso solo es cierto con esta variante.**

---

## 6. Compra por fardo, venta por unidad

1 quintal = 100 libras, 1 fardo = 12 botellas, 1 cartón = 30 huevos.

| | |
|---|---|
| **Base de datos** | `product_packs` (tenant_id, product_id, nombre, unidades_por_paquete, código de barras propio opcional). El stock **se sigue guardando en la unidad base**: el paquete es solo una forma de entrar o salir. |
| **Endpoints** | CRUD de presentaciones; `purchases` acepta `packId` y multiplica; `sales` igual. |
| **Pantallas** | Presentaciones en la ficha del producto; selector en Compras y en Vender. |
| **Riesgos** | **El CPP.** Si entran 10 fardos de 12 a Q60 el fardo, el costo unitario es Q5 y hay que convertir ANTES de llamar a `applyCostedEntry`, nunca después. Un error aquí corrompe el costo promedio de forma silenciosa. Pide pruebas específicas contra casos calculados a mano, como las que ya existen para CPP. |

**Esfuerzo: medio**, no bajo. Es la única del cuadro que toca el núcleo de
dinero.

---

## 7. Pagos con QR

Registrar cobros con QR de los bancos (Cuik, NeoNet, Bi en Línea, Zigi) con su
referencia.

| | |
|---|---|
| **Base de datos** | Agregar `QR` al enum de métodos de pago. `sale_payments` ya tiene campo de referencia. |
| **Endpoints** | Ninguno nuevo: `sales` ya acepta pagos mixtos con método y referencia. |
| **Pantallas** | Un método más en el cobro, con campo de referencia. |
| **Riesgos** | Ninguno técnico. **Aclaración importante: esto NO es integración bancaria.** El cliente paga con su app y el cajero anota la referencia; el sistema no verifica que el pago entró. Conviene que la pantalla lo diga, para que nadie crea que está conciliado. |

**Esfuerzo: muy bajo.**

---

## Lo que hay que planear: FEL

### Qué es

Toda factura pasa por un **certificador autorizado por la SAT** (Infile,
Digifact, Megaprint), que firma el XML y devuelve un **UUID de autorización**.
Sin esa respuesta, no hay factura válida.

### Arquitectura propuesta

**Módulo nuevo `fel`, aislado detrás de una interfaz.** Hay tres
certificadores con APIs distintas y el cliente elige el suyo: si el código de
ventas llama directo a Infile, cambiar de certificador es reescribir ventas.

```
sales.service ──> fel.service ──> CertificadorInfile
                   (interfaz)  ──> CertificadorDigifact
```

**La decisión de diseño que importa: la emisión NO va dentro de la transacción
de la venta.** El certificador es un tercero por red, con latencia y caídas.
Meterlo en la transacción significa que una venta de Q10 en el mostrador falla
porque la SAT está lenta — inaceptable (§6.1: si falla la impresión la venta
NO se revierte; el mismo principio).

Entonces:

1. La venta se registra y se cobra como hoy. Se acabó la interacción con el cliente.
2. Se encola un documento FEL en estado `PENDIENTE`.
3. Un proceso aparte lo certifica y guarda el UUID; si falla, reintenta.
4. El ticket sale al instante con un QR que apunta a una URL del sistema; esa
   URL muestra la factura cuando llega la autorización.

**Esto obliga a traer BullMQ y Redis**, que están pospuestos desde D-020
justamente hasta que hubiera un trabajo que lo amerite. Este lo amerita: es el
primer trabajo que no puede correr dentro del request.

| | |
|---|---|
| **Base de datos** | `fel_documents` (tenant_id, sale_id, estado, uuid_autorizacion, xml_firmado, serie, número, intentos, último error). Credenciales del certificador cifradas en `tenants.settings`. |
| **Endpoints** | `POST /api/sales/:id/fel` (reintento manual), `GET /api/fel/:uuid` (pública, para el QR), configuración del certificador. |
| **Pantallas** | NIT y nombre del cliente en el cobro, con consulta de NIT; estado FEL en la lista de ventas; pantalla pública de la factura. |
| **Riesgos** | Credenciales de la SAT por tenant (hay que cifrarlas en reposo, no basta el JSONB). Anulación: una factura certificada se anula con una **nota de crédito**, no borrando — encaja bien con los ledgers inmutables. Certificación en ambiente de pruebas antes de producción. |

**Esfuerzo: alto.** Es una fase propia, no una función.

---

## Lo que hay que planear: modo sin internet

### Por qué es el más difícil

Es la mejora futura #1 del backlog desde el día uno, y sigue siéndolo. El
problema no es guardar la venta en el navegador: es que **el correlativo, el
stock y el arqueo son transaccionales en el servidor** (§6.1). Si dos cajas
venden sin conexión, las dos creen tener el stock y las dos piden el mismo
número de comprobante.

### Arquitectura propuesta

**No "offline-first" entero: offline SOLO para vender.** Vender es lo único
que no puede esperar; consultar reportes o recibir compras sí puede.

1. **Catálogo en el dispositivo.** IndexedDB con productos, códigos y precios,
   refrescado al abrir caja. Esto choca de frente con D-032 ("el API nunca se
   cachea") y hay que registrarlo como una excepción explícita y acotada: se
   cachea el catálogo, nunca el stock ni la caja.
2. **Correlativo reservado por bloques.** Al abrir el turno, la caja pide un
   rango (por ejemplo 50 números) y los consume sin red. Los huecos quedan
   explicados por el bloque, que es auditable — un correlativo con huecos sin
   explicación sí sería un problema (A11).
3. **Cola local de ventas** con su `client_op_id`, que **ya existe** y ya es
   idempotente: la pieza más delicada de la sincronización está construida y
   probada desde la Fase 2.
4. **Stock: optimista y con reconciliación.** Sin conexión no se puede
   garantizar el stock. La venta se registra igual y al sincronizar, si el
   stock quedó negativo, se genera un **ajuste con aviso** en vez de rechazar
   la venta — la mercadería física ya salió de la tienda; negarlo no la trae
   de vuelta.

| | |
|---|---|
| **Base de datos** | `number_blocks` (tienda, tipo, desde, hasta, asignado_a, consumido). `sales` necesita `created_offline_at` para distinguir cuándo ocurrió de cuándo llegó. |
| **Endpoints** | Reserva de bloque; sincronización por lotes. |
| **Pantallas** | Indicador de modo sin conexión (ya existe el de conexión), contador de ventas por sincronizar, pantalla de conflictos. |
| **Riesgos** | El arqueo de caja sin conexión: el efectivo esperado se calcula del ledger del servidor. Hay que recalcularlo al sincronizar y aceptar que un cierre offline es provisional hasta entonces. |

**Esfuerzo: muy alto, y es la función que más distingue al producto.** Loyverse
lo hace solo en parte (sin conexión no admite devoluciones). Conviene hacerlo
cuando haya clientes reales que lo pidan, y hacerlo bien.

---

## Resumen de esfuerzo, corregido contra el código

| Función | Diagrama | Real | Por qué cambia |
|---|---|---|---|
| Ticket térmico | Poco | **Muy poco** | ESC/POS, corte y gaveta ya están hechos desde la Fase 6 |
| Venta en espera | Poco | **Muy poco** | La persistencia del carrito ya existe |
| Botones rápidos | Poco | Poco | — |
| Cierre a ciegas | Poco | Poco | — |
| Resumen por WhatsApp | Poco | **Poco solo con `wa.me`** | La API de WhatsApp Business exige verificación de Meta y plantillas aprobadas |
| Compra por fardo | Poco | **Medio** | Toca el CPP, que es el núcleo de dinero |
| Pagos con QR | Poco | **Muy poco** | Es un método de pago más; no hay integración bancaria |
| FEL | Mucho | Mucho | Obliga además a traer colas (D-020) |
| Sin internet | Mucho | **Muy alto** | Correlativo y stock son transaccionales por diseño |

**Sugerencia de orden:** pagos con QR → venta en espera → ticket con QR y
datos del negocio → botones rápidos → cierre a ciegas → WhatsApp con `wa.me`
→ compra por fardo. Y antes que todas ellas, **usuarios y permisos**, que no
está en este cuadro pero es la que impide poner el sistema en una tienda con
cajeros (ver el análisis de seguridad).
