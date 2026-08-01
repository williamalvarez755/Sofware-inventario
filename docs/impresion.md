# Impresión térmica

El sistema imprime por **dos vías** (D-009). La primera funciona siempre; la
segunda da la experiencia de un POS de verdad.

## Vía 1 — Navegador (siempre disponible)

No requiere instalar nada. El comprobante se maqueta con CSS a 72 mm de ancho
y se manda al diálogo de impresión del sistema. Funciona con cualquier
impresora que Windows/macOS reconozca, térmica o no.

**Limitación:** no corta el papel automáticamente ni abre la gaveta de dinero;
el cajero corta a mano y abre la gaveta con su llave.

**Configuración recomendada en la impresora térmica:**
- Tamaño de papel: 80 mm × recibo (o 58 mm según el modelo)
- Márgenes: 0
- Desactivar encabezados y pies del navegador

## Vía 2 — QZ Tray (corte automático y gaveta)

[QZ Tray](https://qz.io/) es un agente que se instala en la computadora de la
tienda y permite enviar comandos ESC/POS crudos desde el navegador.

1. Instalar QZ Tray en la PC del punto de venta.
2. Conectar la impresora térmica y dejarla como predeterminada.
3. Abrir el POS: el botón dirá **"Imprimir (térmica)"** cuando detecte el agente.

Con esta vía el ticket sale con **corte parcial automático** y, si hay gaveta
conectada al puerto RJ11 de la impresora, **se abre al cobrar**.

Si el agente no está corriendo, el POS cae solo a la vía 1 sin interrumpir la
venta — el cobro ya ocurrió, imprimir es lo secundario.

## Estado de verificación

| Aspecto | Estado |
|---|---|
| Maquetación CSS 58/80 mm | ✅ Verificado en navegador |
| Generación de comandos ESC/POS | ✅ 7 pruebas de unidad sobre los bytes exactos ([escpos.test.ts](../apps/web/src/lib/escpos.test.ts)) |
| Corte automático en hardware real | ⏳ **Pendiente** — requiere impresora física |
| Apertura de gaveta en hardware real | ⏳ **Pendiente** — requiere gaveta física |

El criterio de la Fase 6 pedía verificar el corte en **dos marcas reales**.
Queda abierto hasta disponer del hardware. Lo que sí se garantiza hoy es que
los comandos generados son los correctos: inicialización, alineación, negritas,
doble altura en el total, avance de papel, apertura de gaveta **antes** del
corte, y corte parcial al final.

## Matriz de hardware probado

| Marca / modelo | Ancho | Vía 1 (CSS) | Vía 2 (ESC/POS) | Notas |
|---|---|---|---|---|
| _pendiente_ | | | | Registrar aquí cada impresora probada en tienda |

> Al probar la primera impresora real, anotar marca, modelo, ancho de papel y
> si el corte y la gaveta respondieron. Esta tabla es lo que evitará repetir
> diagnósticos con cada cliente nuevo.
