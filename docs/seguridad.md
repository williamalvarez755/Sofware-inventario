# Revisión de seguridad

> Revisión de la **Fase 6**, realizada el 2026-08-01 sobre el código completo.
> Las garantías que se podían automatizar están en
> [tests/security.test.ts](../apps/api/tests/security.test.ts) (17 pruebas) para
> que no dependan de que alguien se acuerde de revisarlas.

## Hallazgos corregidos en esta revisión

| # | Hallazgo | Riesgo real | Corrección |
|---|---|---|---|
| 1 | El límite de intentos de login era **por IP** y compartía cubo con la verificación 2FA | Una tienda entera sale por una sola conexión: tres cajeros equivocándose en el cambio de turno dejaban al cuarto sin poder entrar, **con clientes esperando en el mostrador** | Cubos separados: por cuenta (ip+correo, 10 intentos), por conexión (100) y para el segundo factor (10 por desafío). Claves probadas por unidad |
| 2 | Un JSON malformado devolvía **500** | Un cliente con un error de formato parecía una caída del servidor; enmascara incidentes reales en el monitoreo | Mapeo de errores de body-parser → 400 `MALFORMED_JSON` |
| 3 | Un cuerpo enorme devolvía **500** en vez de 413 | Un intento de agotar memoria se perdía entre los 500 legítimos | → 413 `PAYLOAD_TOO_LARGE` |
| 4 | Un identificador inválido en la URL devolvía **500** | Un escáner probando URLs al azar llenaba el monitoreo de "errores internos" falsos, ocultando los de verdad | Errores conocidos de Prisma mapeados a 400/404/409 |
| 5 | Restringir `users.totp_secret` por columna rompía consultas legítimas | La autorización por PIN de supervisor (retiros y anulaciones) fallaba en producción | El secreto se movió a la tabla `user_totp`, negada por completo al rol de runtime (D-033) |

## Garantías verificadas automáticamente

**Cabeceras** — CSP `default-src 'none'`, `frame-ancestors 'none'`, HSTS a un año
con subdominios, `nosniff`, `no-referrer`, y sin `X-Powered-By`.

**Material de autenticación** — ninguna respuesta devuelve hashes, secretos de
2FA ni PIN. El rol de runtime **no puede leer** `recovery_codes`,
`refresh_tokens`, `platform_users` ni `user_totp`; sí lee `users` con
normalidad, sin trampas por columna.

**Mensajes de error** — sin stack traces ni mención del motor de base de datos.
El login fallido responde igual para un correo inexistente que para una
contraseña incorrecta (no permite enumerar usuarios).

**Entrada** — cuerpos malformados, tipos inesperados e intentos de inyección SQL
se rechazan sin caídas; el tamaño del cuerpo está limitado a 1 MB.

**Autorización** — ningún endpoint entrega costos ni utilidades a un trabajador;
el módulo de compras completo le está cerrado. Un token manipulado se rechaza y
**desactivar a un empleado revoca sus sesiones al instante**.

**Aislamiento entre clientes** — 8 pruebas dedicadas
([isolation.test.ts](../apps/api/tests/isolation.test.ts)) comprueban que la
separación se sostiene incluso **sin** los filtros de la aplicación, apoyada
solo en RLS de PostgreSQL.

## Dependencias

`npm audit --omit=dev` reporta **un** aviso alto, aceptado con justificación:

> **react-router 7.12.0–8.2.0 — "RSC Mode CSRF Bypass"** ([GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2))
>
> **No hay versión corregida publicada** (7.18.2 es la última disponible; el
> aviso apunta a una futura 8.2.x).
>
> **La ruta vulnerable no es alcanzable en esta aplicación.** El fallo está en
> el modo **RSC** (React Server Components) con *server actions*. Este proyecto
> es una SPA puramente de cliente servida como archivos estáticos: usa
> únicamente `BrowserRouter`, `Routes`, `Route`, `Link`, `Navigate`,
> `useLocation` y `useNavigate` — sin data router, sin `loader`, sin `action`,
> sin renderizado en servidor. No existe el código vulnerable en el paquete
> compilado.
>
> **Acción:** revisar mensualmente y actualizar en cuanto se publique la
> versión corregida. Si en el futuro se adoptan loaders o actions de
> React Router, **actualizar primero**.

## Pendiente de verificación con hardware

La impresión ESC/POS (corte automático y apertura de gaveta) **no está probada
en impresora física** — requiere el agente QZ Tray instalado y una impresora
térmica real. Lo que sí está verificado son los bytes que se le envían
([escpos.test.ts](../apps/web/src/lib/escpos.test.ts), 7 pruebas). El criterio
de la Fase 6 "corte automático en al menos 2 marcas reales" **queda abierto**
hasta tener el hardware. Mientras tanto el POS imprime por el navegador, que
funciona con cualquier impresora instalada en el sistema.

## Revisión periódica sugerida

- **Mensual:** `npm audit --omit=dev`, ensayo de restauración ([respaldos.md](respaldos.md)), revisar la bitácora en busca de `auth.refresh_reuse_detected` y `auth.login_2fa_failed`.
- **Antes de cada despliegue grande:** correr la suite completa y `npm run load-test -w apps/api`.
- **Al crecer el equipo:** reactivar linters y hooks de pre-commit (se omitieron por D-017, que asume un solo desarrollador).
