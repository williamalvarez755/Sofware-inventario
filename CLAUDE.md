# CLAUDE.md — Documento Maestro del Proyecto

> **Producto:** SaaS multi-tenant de inventario, punto de venta (POS), caja y proveedores para mini markets en Guatemala.
> **Moneda:** Quetzal (GTQ, `Q`).
> **Estado:** **Fase 0 (fundaciones) COMPLETADA** — ver §9. Próxima: Fase 1 (catálogo e inventario).
> **Última actualización:** 2026-07-31.
>
> Este archivo es la fuente de verdad del proyecto. Toda decisión técnica relevante debe registrarse aquí (sección *Registro de decisiones*) antes o inmediatamente después de implementarse.

---

## 1. Resumen del proyecto

Plataforma SaaS que permite a múltiples negocios (mini markets, tiendas de barrio, abarroterías) operar su punto de venta y controlar su negocio:

- **Inventario** por producto y por tienda, con kardex (bitácora de movimientos) inmutable.
- **Ventas (POS)** rápidas con escaneo por código de barras (lector físico o cámara), impresión de comprobante en impresora térmica.
- **Caja**: apertura/cierre por turno, arqueo (efectivo esperado vs. real), ingresos, egresos y retiros con motivo obligatorio.
- **Proveedores y compras** con actualización automática de stock y costo.
- **Gastos** categorizados.
- **Utilidades y márgenes** calculados automáticamente (costo promedio ponderado congelado al momento de la venta).
- **Alertas de stock bajo** por producto y tienda.
- **Reportes** operativos, contables y de auditoría.

Modelo de negocio: el **Super Admin** (propietario de la plataforma) vende suscripciones por plan a **negocios (tenants)**. Cada tenant puede tener **una o varias tiendas** según su plan. Cada tienda tiene **admins** y **trabajadores**.

### Ambigüedades detectadas y cómo se resolvieron

| # | Ambigüedad | Decisión | Razón |
|---|---|---|---|
| A1 | ¿El tenant es la tienda o el negocio? | El tenant es el **negocio** (cliente que paga). Las tiendas son entidades hijas del tenant. | El requerimiento dice "un admin puede administrar más de una tienda si su plan lo autoriza" — eso exige un nivel superior a la tienda. |
| A2 | Impuestos en Guatemala | Precios de venta **con IVA incluido** (práctica universal en retail GT). El tenant configura su régimen (`GENERAL` 12 %, `PEQUENO_CONTRIBUYENTE` 5 %, `NINGUNO`) solo para **desglose informativo** en reportes. FEL (facturación electrónica SAT) queda fuera del MVP, diseñado como fase futura. | Un mini market emite comprobantes simples en el día a día; FEL requiere integración con certificador (Infile, Digifact) y es un proyecto en sí mismo. El modelo de datos ya deja campos para no bloquearlo. |
| A3 | Método de costeo | **Costo promedio ponderado (CPP)** por producto **y por tienda**, recalculado en cada compra. El costo se **congela** en cada línea de venta (`unit_cost_at_sale`) para que la utilidad histórica no cambie retroactivamente. | CPP es el estándar de retail, simple y auditable. FIFO descartado: complejidad de capas de inventario sin beneficio real para mini markets. |
| A4 | Venta sin stock suficiente | **Bloqueada por defecto**; configurable por tenant (`allow_negative_stock`) para tiendas cuyo inventario físico va adelantado al sistema. | La operación real de tienda a veces necesita vender lo que físicamente existe aunque el sistema no lo refleje; el bloqueo total genera rechazo del producto. |
| A5 | Precios por tienda | Precio base en el producto + **override opcional por tienda** (`store_products.price_override`). | Sucursales en zonas distintas pueden tener precios distintos; el caso común (un solo precio) no se complica. |
| A6 | Retiros de caja por trabajador | El trabajador puede **registrar** el retiro, pero requiere **autorización de un admin** (re-autenticación con PIN de supervisor) que queda registrada (`authorized_by`). El admin retira directo. Motivo siempre obligatorio; foto de evidencia opcional. | Cumple "registrar salidas autorizadas" sin darle al trabajador poder unilateral sobre efectivo. |
| A7 | Anulación de ventas | Nunca se borra. `status = VOIDED` + motivo obligatorio + autorización admin. Genera movimientos **compensatorios** de inventario y de caja (si la sesión sigue abierta; si ya cerró, genera un movimiento en la sesión activa con referencia cruzada). | Trazabilidad total; el arqueo de caja nunca queda inconsistente. |
| A8 | Cobro de la suscripción SaaS | V1: activación/suspensión **manual** por el Super Admin (pago por transferencia). Fase posterior: pasarela **Recurrente** (guatemalteca) o tarjeta vía procesador local. Stripe descartado: no opera con cuentas en Guatemala. | No bloquear el lanzamiento por la pasarela; la suspensión por mora es manual pero el mecanismo técnico (estado del tenant) existe desde el día 1. |
| A9 | Representación de dinero | **Enteros en centavos** (`BIGINT`) en toda la base y el backend. Formateo a `Q 1,234.56` solo en presentación. | Elimina errores de punto flotante en sumas de caja y reportes. |
| A10 | Visibilidad de costos | El rol **Trabajador no ve** costos, márgenes ni utilidades — solo precios de venta. Aplicado en API (serialización condicionada por permiso), no solo en UI. | Requisito de "consultar únicamente la información necesaria para operar". |
| A11 | Números de comprobante | Correlativo **secuencial por tienda** (`sales.number`), generado con contador transaccional (tabla `counters`), nunca reutilizado (las anuladas conservan su número). | Auditoría y conciliación exigen correlativos sin huecos inexplicables. |
| A12 | Idioma / zona horaria | Español, `America/Guatemala` (UTC-6, sin DST). Timestamps en UTC en la base; conversión en presentación. | Estándar; evita bugs de fechas en cortes de caja. |

---

## 2. Arquitectura

### 2.1 Decisión: Monolito modular con Clean Architecture

```
┌────────────────────────────────────────────────────────────┐
│                        CLIENTES                            │
│  POS (tienda)   ·   Panel Admin tienda   ·   Panel SaaS    │
│     React + Vite (SPA, rutas por rol; PWA en Fase 6)       │
└────────────────────────┬───────────────────────────────────┘
                         │ HTTPS / REST (JSON)
┌────────────────────────▼───────────────────────────────────┐
│           API — Node.js + Express (monolito modular)       │
│  ┌──────────┐ ┌──────────┐ ┌───────┐ ┌─────────┐ ┌───────┐ │
│  │ identity │ │ catalog  │ │ sales │ │  cash   │ │ purch │ │
│  ├──────────┤ ├──────────┤ ├───────┤ ├─────────┤ ├───────┤ │
│  │inventory │ │ reports  │ │ audit │ │ tenancy │ │billing│ │
│  └──────────┘ └──────────┘ └───────┘ └─────────┘ └───────┘ │
│   Cada módulo: controller → service (dominio) → repositorio│
│   Transversales: middlewares (auth, tenant, permisos),     │
│   helper de auditoría transaccional, manejador de errores  │
└──────┬──────────────────┬───────────────────┬──────────────┘
       │                  │                   │
┌──────▼──────┐    ┌──────▼──────┐    ┌───────▼───────┐
│ PostgreSQL  │    │    Redis    │    │ S3-compatible │
│ (RLS multi- │    │ cache/rate/ │    │ (evidencias,  │
│  tenant)    │    │   BullMQ    │    │ logos, export)│
└─────────────┘    └─────────────┘    └───────────────┘
```

**Por qué monolito modular y no microservicios:**

- **Volumen real:** 1,000 tiendas × 500 ventas/día ≈ 6 ventas/segundo promedio. Un solo proceso Node bien escrito sobre Postgres maneja esto con margen enorme. Los microservicios resolverían un problema que este dominio no tiene.
- **Consistencia transaccional:** una venta toca inventario, caja, correlativo y auditoría **en una sola transacción ACID**. En microservicios eso serían sagas/compensaciones — complejidad injustificada para la operación de una tienda física donde la consistencia inmediata importa.
- **Equipo pequeño:** un monolito modular se despliega, monitorea y depura con una fracción del costo operativo.
- **Salida de emergencia:** los módulos se comunican por interfaces internas (nunca imports cruzados de repositorios); si algún módulo (p. ej. reportes) llegara a necesitar escalar aparte, se extrae sin reescritura.

**Por qué es escalable:** el API es *stateless* (JWT, sesión en Redis) → escala horizontal con N réplicas tras un load balancer; Postgres escala vertical + réplicas de lectura para reportes; trabajos pesados van a colas (BullMQ) fuera del request path; tablas de alto crecimiento (movimientos, auditoría) nacen particionadas.

**Por qué es mantenible:** cada módulo tiene una responsabilidad (alta cohesión), los módulos solo se hablan por sus servicios (nunca imports cruzados de repositorios), y las reglas de negocio viven en servicios de dominio puros y testeables — no en routers ni en el ORM (Clean Architecture: dominio no depende de infraestructura). En Express esta disciplina no la impone un framework: la impone la convención documentada aquí (router → service → Prisma) y se revisa antes de crear cada archivo.

**Por qué es adecuada para SaaS multi-tenant:** el aislamiento se aplica en **dos capas independientes** (ver 2.2); agregar un tenant es un `INSERT`, no un despliegue; la suspensión de un tenant es un cambio de estado evaluado en un guard global.

**Alternativas descartadas:** microservicios (costo operativo, consistencia distribuida innecesaria); serverless/lambdas (cold starts en POS, conexiones a Postgres problemáticas, lock-in); monolito sin módulos (se degrada a lodo con el crecimiento del equipo).

### 2.2 Modelo multi-tenant

**Decisión: base de datos compartida, esquema compartido, columna `tenant_id` + Row Level Security (RLS) de PostgreSQL.**

| Estrategia | Veredicto | Razón |
|---|---|---|
| BD por tenant | ❌ | Con miles de tiendas: migraciones ×N, backups ×N, pool de conexiones ×N, costo ×N. Solo se justifica con requisitos regulatorios de aislamiento físico. |
| Esquema por tenant | ❌ | Mismos problemas a menor escala; soporte pobre en ORMs; los reportes globales del Super Admin se vuelven UNION de miles de esquemas. |
| **Esquema compartido + `tenant_id` + RLS** | ✅ | Migración única, costo marginal por tenant ≈ 0, reportes globales triviales. El riesgo (fuga entre tenants por un bug) se mitiga con defensa en dos capas. |

**Defensa en dos capas (obligatoria, no opcional):**

1. **Capa de aplicación:** todo request autenticado resuelve `tenant_id` desde el JWT (nunca desde el body/query). Un *Prisma Client Extension* inyecta el filtro `tenant_id` en cada consulta de modelos tenant-scoped. Ningún repositorio acepta `tenant_id` como parámetro del cliente.
2. **Capa de base de datos (RLS):** cada transacción ejecuta `SET LOCAL app.tenant_id = '<uuid>'`. Políticas RLS en todas las tablas tenant-scoped: `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. El rol de conexión de la app **no** tiene `BYPASSRLS`. Aunque un bug de aplicación omita el filtro, la base no devuelve filas ajenas.

- El **Super Admin** opera con un rol de conexión distinto y endpoints separados (`/platform/*`); su acceso queda auditado.
- **Jerarquía:** `tenant (negocio) → stores (tiendas) → datos operativos`. `tenant_id` se **denormaliza** en todas las tablas operativas (aunque tengan `store_id`) para que RLS e índices no requieran joins.
- **Suspensión:** `tenants.status ∈ {ACTIVE, SUSPENDED, CANCELLED}` evaluado en guard global → un tenant suspendido recibe `403` con mensaje de contacto, sin tocar sus datos.

---

## 3. Roles, permisos y políticas de acceso

### 3.1 Modelo RBAC

- **Roles de plataforma:** `SUPER_ADMIN` (usuario con `tenant_id = NULL`, tabla y login separados del flujo tenant).
- **Roles de tenant:** `OWNER` (dueño del negocio, acceso a todas sus tiendas), `STORE_ADMIN` y `WORKER` (asignados **por tienda** vía `store_members`).
- Los permisos son **granulares y catalogados** (tabla `permissions`, seed fijo). Cada rol mapea a un set de permisos (`role_permissions`). V1 usa roles fijos; la estructura ya soporta roles personalizados como mejora futura sin cambiar el modelo.
- **Evaluación:** middleware `requirePermission('sales.void')` en la ruta + revalidación en el servicio de dominio para operaciones críticas (defensa en profundidad). La membresía se evalúa contra la tienda del recurso, no solo contra el tenant.

### 3.2 Matriz de permisos (resumen del seed)

| Permiso | SUPER_ADMIN | OWNER | STORE_ADMIN | WORKER |
|---|---|---|---|---|
| Gestionar tenants, planes, suscripciones | ✅ | — | — | — |
| Métricas y auditoría globales | ✅ | — | — | — |
| Crear/editar tiendas (dentro del plan) | ✅ | ✅ | — | — |
| Gestionar usuarios de tienda | — | ✅ | ✅ | — |
| CRUD productos, categorías, proveedores | — | ✅ | ✅ | — |
| Registrar compras | — | ✅ | ✅ | opcional* |
| Ajustes de inventario / merma | — | ✅ | ✅ | — |
| Registrar ventas | — | ✅ | ✅ | ✅ |
| Anular ventas | — | ✅ | ✅ | — |
| Abrir/cerrar caja | — | ✅ | ✅ | ✅ (su turno) |
| Retiros de caja | — | ✅ | ✅ | registra, requiere PIN admin |
| Registrar gastos | — | ✅ | ✅ | ✅ (con motivo) |
| Ver costos, márgenes, utilidades | — | ✅ | ✅ | ❌ |
| Reportes de tienda | — | ✅ | ✅ | solo su turno |
| Ver auditoría del tenant | — | ✅ | ✅ | ❌ |
| Configuración del tenant | — | ✅ | — | — |

\* activable por tienda si el dueño delega recepción de mercadería.

**Políticas transversales:**
- Nadie ve ni toca datos de otro tenant (RLS).
- `WORKER` jamás recibe campos de costo en respuestas del API (serialización por permiso, no ocultamiento en UI).
- Toda acción sensible (anulación, retiro, ajuste, cambio de precio, login fallido) queda en `audit_logs`.
- Re-autenticación (PIN) para: autorizar retiro, anular venta, ajuste negativo grande (umbral configurable).

---

## 4. Decisiones técnicas (stack)

> Regla: cada elección lista qué se descartó y por qué. Si una decisión cambia, se registra en §11.

| Área | Elección | Justificación | Alternativas descartadas |
|---|---|---|---|
| **Backend** | **Node.js 22 + Express 5 (TypeScript)** — decisión del dueño del proyecto (D-016) | Familiaridad del desarrollador (trabaja solo: la velocidad de quien escribe el código pesa más que cualquier virtud teórica del framework); Express 5 maneja promesas rechazadas nativamente (menos boilerplate de errores); ecosistema enorme. La estructura modular que NestJS impone por framework aquí se impone **por convención estricta**: `src/modules/<dominio>/{router,service}` + middlewares transversales; ningún módulo importa internals de otro. | **NestJS**: más andamiaje del que un solo dev necesita; su beneficio (disciplina) se conserva por convención. **Fastify**: más rápido, pero el cuello de botella es Postgres, no el framework HTTP; familiaridad prima. |
| **Frontend** | **React 19 + Vite (SPA); Tailwind + shadcn/ui; TanStack Query; React Router** — decisión del dueño del proyecto (D-016) | El POS es una app autenticada con estado vivo en el cliente (carrito, caja): una SPA es el modelo natural y Vite da el ciclo de desarrollo más rápido que existe. Deploy trivial como Static Site en Render. PWA (instalable, cámara) se añade sobre Vite en Fase 6 con `vite-plugin-pwa`. | **Next.js**: SSR/SEO no aportan nada a una app 100 % autenticada; añade complejidad de servidor al deploy. **Flutter/React Native**: complica impresión térmica y despliegue web; innecesario en v1. |
| **Base de datos** | **PostgreSQL 16** | RLS nativo (pilar del multi-tenant), ACID real para stock/caja, `JSONB` para diffs de auditoría, particionado declarativo para tablas de alto crecimiento, ecosistema de backups maduro (wal-g/pgBackRest). | **MySQL/MariaDB**: sin RLS — obligaría a confiar solo en la capa de aplicación. **MongoDB**: dominio claramente relacional con ledgers transaccionales. **SQLite**: no es multi-tenant server-grade. |
| **ORM** | **Prisma** | Tipado end-to-end, migraciones declarativas versionadas, *client extensions* para inyectar el scope de tenant en cada query. Con RLS: cada transacción abre con `SET LOCAL app.tenant_id`. SQL crudo (`$queryRaw`) para reportes agregados. | **TypeORM**: historial de bugs y mantenimiento irregular. **Drizzle**: buena opción (plan B ligero), ecosistema de migraciones menos maduro. **Knex/SQL puro**: productividad y seguridad de tipos muy inferiores para CRUD masivo. |
| **Autenticación** | **Propia: JWT access (15 min) + refresh token rotativo con detección de reuso; Argon2id; TOTP 2FA para OWNER y SUPER_ADMIN (fase 6)** | El costo por usuario activo de un IdP externo castiga el margen del SaaS (cada cajero es un usuario). El flujo es estándar y bien acotado. Refresh tokens en tabla → revocación por dispositivo y cierre de sesión remoto al despedir a un empleado. | **Auth0/Clerk**: costo por MAU + lock-in. **Keycloak**: correcto pero pesado de operar para un equipo pequeño. **Sesiones server-side puras**: válido, pero JWT corto + refresh da mejor encaje con PWA y balanceo. |
| **Permisos** | **RBAC con catálogo de permisos en BD y roles fijos (seed)** | Ver §3. Granularidad real desde v1, roles custom posibles después sin migración estructural. | **CASL/ABAC completo**: sobre-ingeniería v1. **Roles hardcoded sin catálogo**: cada permiso nuevo sería un deploy. |
| **Multi-tenancy** | **Esquema compartido + `tenant_id` + RLS (dos capas)** | Ver §2.2. | BD/esquema por tenant (ver tabla comparativa §2.2). |
| **Cache** | **Se pospone a Fase 4 (D-020).** Mientras el API corra en una sola instancia de Render: rate limiting en memoria (`express-rate-limit`) y cache en proceso con TTL. Redis (Render Key Value) entra cuando haya colas o más de una réplica. | No pagar ni operar Redis antes de necesitarlo (YAGNI). La verdad siempre es Postgres; el cache es descartable por diseño, así que introducirlo después no cambia arquitectura. | **Redis día 1**: costo y una pieza más que vigilar sin beneficio actual. |
| **Colas** | **Se pospone a Fase 4 (D-020).** Alertas de stock v1 se evalúan en la misma transacción del movimiento (es un `SELECT` barato). BullMQ + Redis entran cuando haya trabajos realmente pesados (exportaciones, agregados nocturnos, correos). | Ídem YAGNI: el diseño ya reserva el punto de corte (los servicios publican "eventos de dominio" internos que hoy se procesan inline y mañana encolan). | **RabbitMQ/Kafka**: potencia y costo operativo injustificados a cualquier escala prevista. |
| **Archivos** | **S3-compatible: Cloudflare R2 (o AWS S3)** | Evidencias de retiros/gastos (fotos), logos, exportaciones CSV/PDF. R2 sin costo de egreso. URLs prefirmadas; el binario nunca pasa por la BD. | **Archivos en disco del VPS**: se pierde con N réplicas y complica backups. **BYTEA en Postgres**: infla la BD y los backups. |
| **Impresión térmica** | **Doble vía: (1) impresión de navegador con CSS para 58/80 mm — universal, cero instalación; (2) agente local QZ Tray para ESC/POS crudo (corte automático, apertura de gaveta) en fase 6** | La vía CSS funciona el día 1 con cualquier impresora instalada en el SO. ESC/POS directo da la experiencia "de verdad" (corte, gaveta, velocidad) donde el cliente instale el agente. El diseño del comprobante es una plantilla única que ambas vías consumen. | **WebUSB**: solo Chrome, permisos frágiles por dispositivo, mantenimiento alto. **App puente propia**: reinventar QZ Tray. |
| **Escaneo de códigos** | **(1) Lector físico USB/Bluetooth en modo HID (teclado) — captura global de ráfagas con sufijo Enter; (2) cámara del dispositivo: `BarcodeDetector` API con fallback a ZXing-JS** | El lector HID no requiere ni un byte de integración de hardware: el POS escucha entrada rápida terminada en Enter. La cámara cubre al tendero que aún no compra lector. | **SDKs comerciales (Scandit)**: licencias caras. **Solo cámara**: más lenta que un lector de Q150 para operación intensiva. |
| **Despliegue** | **Render (web = Static Site, api = Web Service, autodeploy desde GitHub) + PostgreSQL gestionado en Aiven** — decisión del dueño del proyecto (D-016) | Cero operación para un solo dev: TLS, build y deploy automáticos con `git push`; Aiven da backups automáticos + PITR sin administrar nada. El API es stateless desde el día 1: escalar = subir de plan o añadir instancias en Render, sin re-arquitectura. | **VPS + Docker**: más control y menor costo marginal, pero horas de ops que un solo dev no tiene. **Kubernetes**: injustificado. **Serverless**: cold starts en POS + agotamiento de conexiones a Postgres. |
| **Observabilidad** | **Logs estructurados pino con `tenant_id`/`request_id` (visibles en Render Logs) + endpoint `/health`. Sentry (plan gratis) en Fase 6.** | Sin `tenant_id` en cada log, depurar "a mí no me imprime" con cientos de tiendas es imposible. Nivel mínimo viable para un dev solo; se amplía cuando haya clientes reales. | Stack completo de métricas (Prometheus/Grafana) día 1: sobre-ingeniería. |
| **Monorepo** | **npm workspaces (sin Turborepo): `apps/api`, `apps/web`, `packages/shared` (tipos, DTOs Zod, catálogo de permisos, utilidades de dinero)** | Tipos compartidos entre API y frontend eliminan una clase entera de bugs de contrato. npm workspaces viene con Node — cero herramientas extra que instalar o entender (D-017). | **pnpm+Turborepo**: mejor con equipo/CI grande; innecesario para un dev sin pipeline pesado. **Repos separados**: fricción de sincronización de contratos. |
| **Tooling de desarrollo** | **TypeScript estricto + `tsx watch` (dev) + `tsc` (build). Vitest SOLO para rutas críticas: aislamiento multi-tenant, auth, dinero/CPP, caja. Sin Husky, sin pre-commit hooks, sin CI pesado (D-017).** | Trabaja una sola persona: los hooks y pipelines protegen contra otros, y aquí no hay otros. El tipo estricto atrapa en el editor lo que un linter pre-commit atraparía tarde. Los tests se reservan para lo que puede costar dinero o filtrar datos — ahí sí son innegociables. | **ESLint estricto + Husky + CI completa**: fricción diaria sin beneficio proporcional en equipo de uno. Se reevalúa si el equipo crece (registrar en ADR). |

---

## 5. Modelo de datos

> DDL completo de referencia (PostgreSQL): [docs/schema.sql](docs/schema.sql). Este apartado explica el *porqué* de cada entidad; el SQL es la definición exacta de columnas, claves, índices y políticas RLS.

### 5.1 Convenciones

- PK: `id UUID` (v7 — ordenables por tiempo, no enumerables públicamente).
- Todas las tablas tenant-scoped llevan `tenant_id` (denormalizado) + política RLS.
- Dinero: `BIGINT` en centavos. Cantidades de stock: `NUMERIC(12,3)` (productos a granel: libras, litros).
- Soft delete solo en catálogos (`deleted_at`); los **ledgers jamás se borran ni actualizan** (protegido con trigger que rechaza `UPDATE/DELETE`).
- `created_at/updated_at` en UTC en todas las tablas.

### 5.2 Entidades por dominio

**Plataforma (sin RLS de tenant; solo Super Admin):**

| Tabla | Propósito y justificación |
|---|---|
| `plans` | Catálogo de planes: límites (`max_stores`, `max_users`), precio en centavos, flags de features. Separado de `tenants` para cambiar precios sin tocar clientes. |
| `tenants` | El negocio cliente. `status` (ACTIVE/SUSPENDED/CANCELLED) — pilar de la suspensión por mora. `settings JSONB` (régimen fiscal, `allow_negative_stock`, umbrales de PIN). |
| `subscriptions` | Historial de suscripciones del tenant (plan, periodo, estado, notas de pago). Histórico, no un campo en `tenants`: la trazabilidad de cobros lo exige. |
| `platform_users` | Super admins. Tabla separada de `users`: credenciales, políticas (2FA obligatorio) y superficie de ataque distintas. |

**Identidad (tenant-scoped):**

| Tabla | Propósito |
|---|---|
| `users` | Usuarios del tenant. `UNIQUE(tenant_id, email)`. PIN de supervisor (hash) opcional para autorizaciones en POS. |
| `stores` | Tiendas del tenant. Datos de comprobante (nombre comercial, dirección, teléfono, pie de ticket). |
| `store_members` | M:N usuario↔tienda con `role` (OWNER/STORE_ADMIN/WORKER). Un usuario puede tener roles distintos en tiendas distintas. |
| `roles`, `permissions`, `role_permissions` | Catálogo RBAC (seed). Permite auditar "quién puede qué" y habilita roles custom futuros. |
| `refresh_tokens` | Sesiones por dispositivo: rotación, detección de reuso, revocación al despedir personal. |

**Catálogo:**

| Tabla | Propósito |
|---|---|
| `categories` | Categorías de producto por tenant (jerarquía de 1 nivel; suficiente para mini market). |
| `units` | Unidades de medida (seed global + custom por tenant): unidad, libra, litro, docena… |
| `products` | Maestro por **tenant** (no por tienda): `sku` (`UNIQUE(tenant_id, sku)`), nombre, categoría, unidad, `base_price`, flags (`is_active`, vendible sin stock…). El stock NO vive aquí. |
| `product_barcodes` | 1:N — un producto puede tener varios códigos (presentaciones, códigos internos pesables). `UNIQUE(tenant_id, barcode)`. Búsqueda POS: índice directo aquí. |
| `store_products` | **Corazón del inventario**: `UNIQUE(store_id, product_id)`; `stock_qty` (materializado), `avg_cost` (CPP por tienda), `min_stock` (umbral de alerta), `price_override`. Separar producto (catálogo) de su existencia por tienda es lo que hace multi-tienda al sistema. |
| `suppliers` | Maestro de proveedores por tenant (NIT, contacto, condiciones). |
| `product_suppliers` | M:N producto↔proveedor: código del proveedor, último costo. Acelera la recepción de compras. |

**Inventario (ledger):**

| Tabla | Propósito |
|---|---|
| `inventory_movements` | **Kardex inmutable.** Cada cambio de stock es una fila: `type` (PURCHASE, SALE, SALE_VOID, ADJUSTMENT_IN/OUT, WASTE, INTERNAL_USE, RETURN_IN, TRANSFER_IN/OUT), `qty` con signo, `unit_cost`, `balance_after` (snapshot para kardex sin recomputar), referencia polimórfica (`ref_type`, `ref_id`) al documento origen, `user_id`, `note`. Particionada por mes. `stock_qty` en `store_products` es una **vista materializada lógica** de este ledger — el ledger es la verdad; una tarea nocturna verifica consistencia. |

**Ventas:**

| Tabla | Propósito |
|---|---|
| `sales` | Encabezado: `number` (correlativo por tienda), `cash_session_id`, usuario, `status` (COMPLETED/VOIDED), totales (subtotal, descuento, total, desglose informativo de IVA), y si VOIDED: `voided_by`, `voided_at`, `void_reason`, `void_authorized_by`. |
| `sale_items` | Líneas: producto, cantidad, `unit_price` (congelado), `unit_cost_at_sale` (congelado — la utilidad histórica no cambia si el costo cambia después), descuento de línea. |
| `sale_payments` | 1:N pagos por venta (CASH/CARD/TRANSFER) → soporta pago mixto; `amount_tendered`/cambio para efectivo. |
| `counters` | Correlativos transaccionales por tienda y tipo de documento (`SELECT … FOR UPDATE`). |

**Caja:**

| Tabla | Propósito |
|---|---|
| `cash_registers` | Cajas físicas por tienda (una tienda puede tener 2 turnos/terminales). |
| `cash_sessions` | Turno: `opening_amount`, quién abre/cierra, `expected_amount` (calculado al cierre), `counted_amount` (conteo físico, con detalle de denominaciones en JSONB), `difference` (sobrante/faltante), `status` (OPEN/CLOSED). Toda venta en efectivo y todo egreso exige sesión OPEN. |
| `cash_movements` | **Ledger inmutable de caja**: `type` (OPENING, SALE_IN, SALE_VOID_OUT, WITHDRAWAL, EXPENSE_OUT, DEPOSIT_IN, ADJUSTMENT), monto con signo, `reason` (obligatorio en egresos), `evidence_url`, `authorized_by` (PIN admin cuando aplica), referencia al documento origen. |

**Compras y gastos:**

| Tabla | Propósito |
|---|---|
| `purchases` | Encabezado de compra: proveedor, tienda, nº de factura del proveedor, fecha, total, usuario. `status` (RECEIVED/VOIDED). |
| `purchase_items` | Líneas: producto, cantidad, `unit_cost` → dispara recálculo de CPP y entrada al kardex. |
| `expense_categories` | Catálogo de tipos de gasto por tenant (seed inicial editable). |
| `expenses` | Gastos: tienda, categoría, monto, descripción obligatoria, `cash_session_id` opcional (si salió de caja genera `cash_movement` vinculado), evidencia. |

**Auditoría y sistema:**

| Tabla | Propósito |
|---|---|
| `audit_logs` | Append-only, particionada por mes: `tenant_id` (nullable — acciones de plataforma), actor (`user_id`/`platform_user_id`), `action` (catálogo: `sale.void`, `cash.withdrawal`, `product.price_change`…), entidad afectada, `before JSONB`/`after JSONB`, IP, user-agent. |
| `stock_alerts` | Estado de alertas activas por `store_product` (evita re-notificar); histórico de notificación. |
| `notifications` | Bandeja in-app por usuario (stock bajo, cierre con faltante, etc.). |

### 5.3 Relaciones y cardinalidades (resumen)

```
plans 1─N tenants 1─N subscriptions
tenants 1─N stores 1─N cash_registers 1─N cash_sessions 1─N cash_movements
tenants 1─N users N─M stores          (via store_members, con rol)
tenants 1─N products 1─N product_barcodes
products N─M suppliers                 (via product_suppliers)
products N─M stores                    (via store_products: stock, CPP, min_stock)
store_products 1─N inventory_movements (kardex por producto-tienda)
cash_sessions 1─N sales 1─N sale_items / sale_payments
suppliers 1─N purchases 1─N purchase_items
expense_categories 1─N expenses
```

### 5.4 Índices y restricciones clave (justificación)

- Índices compuestos **siempre con `tenant_id` primero** en tablas tenant-scoped (RLS los aprovecha).
- POS caliente: `product_barcodes(tenant_id, barcode)` UNIQUE — búsqueda por escaneo en O(1); `products` con índice trigram (`pg_trgm`) sobre nombre para búsqueda por teclado.
- Kardex: `inventory_movements(store_id, product_id, created_at DESC)`; ventas: `sales(store_id, created_at DESC)`, `sales(cash_session_id)`.
- Integridad de dinero/stock: `CHECK (stock_qty >= 0)` (relajable por tenant vía configuración A4), `CHECK` de montos ≥ 0 donde aplica, `qty <> 0` en movimientos.
- Anti-carrera de stock: decremento atómico `UPDATE store_products SET stock_qty = stock_qty - $1 WHERE id = $2 AND stock_qty >= $1` — si afecta 0 filas ⇒ stock insuficiente (sin lock explícito ni condición de carrera).
- Unicidad por tenant, nunca global: `(tenant_id, sku)`, `(tenant_id, barcode)`, `(tenant_id, email)`.
- FKs con `ON DELETE RESTRICT` en todo lo operativo (nada crítico se borra en cascada); catálogos con soft delete.

---

## 6. Flujos funcionales

### 6.1 Venta (POS)

1. Precondición: usuario con permiso `sales.create` y **sesión de caja OPEN** en su caja.
2. Escaneo (HID o cámara) o búsqueda por nombre → cache Redis / índice de barcode → agrega línea con precio vigente (override de tienda si existe).
3. Totales en vivo: subtotal − descuentos = total (IVA incluido; desglose informativo).
4. Cobro: uno o varios `sale_payments`; efectivo calcula cambio.
5. **Transacción única:** correlativo (`counters` FOR UPDATE) → `sales` + `sale_items` (con `unit_cost_at_sale` copiado del CPP) + `sale_payments` → decremento atómico de stock por línea → `inventory_movements` (SALE) → `cash_movements` (SALE_IN por la parte en efectivo) → `audit_logs`. Cualquier fallo revierte todo.
6. Post-commit: impresión del comprobante (CSS o ESC/POS); si falla la impresión la venta NO se revierte (reimpresión disponible).
7. Si al decrementar stock una línea afecta 0 filas y el tenant no permite negativo → rollback y error claro con el producto exacto.

**Anulación:** permiso `sales.void` (o PIN admin) + motivo → `status=VOIDED`, movimientos compensatorios de inventario (SALE_VOID) y de caja (SALE_VOID_OUT en la sesión abierta actual, con referencia cruzada si la original ya cerró). Nada se borra.

### 6.2 Caja

1. **Apertura:** usuario declara `opening_amount` contado → `cash_sessions` OPEN + `cash_movements` OPENING. Una sola sesión OPEN por caja (índice parcial único).
2. **Operación:** ventas en efectivo suman; retiros (motivo + PIN admin si es trabajador), gastos pagados de caja y depósitos generan movimientos firmados por usuario.
3. **Cierre:** sistema calcula `expected = apertura + Σ entradas − Σ salidas`; usuario cuenta físico (opcionalmente por denominaciones) → `difference` = contado − esperado; sesión CLOSED (inmutable). Diferencias fuera de umbral notifican al admin.
4. **Corte diario** = reporte agregado de las sesiones del día por tienda.

### 6.3 Compra (entrada de inventario)

1. Admin selecciona proveedor + tienda destino; agrega líneas (escaneo o búsqueda; sugiere último costo del proveedor).
2. **Transacción:** `purchases` + `purchase_items` → por línea: **CPP nuevo** = `(stock_actual × cpp_actual + qty × costo) / (stock_actual + qty)` → actualiza `store_products` (stock y `avg_cost`) → `inventory_movements` (PURCHASE) → auditoría.
3. Producto nuevo del proveedor → alta rápida inline (permiso `products.create`).
4. Anulación de compra: compensatoria, con recálculo de CPP y validación de stock disponible.

### 6.4 Ajustes, merma y consumo interno

- Tipos: ADJUSTMENT_IN/OUT (conteo físico), WASTE (merma/vencido), INTERNAL_USE (consumo propio), RETURN_IN (devolución de cliente — repone stock).
- Siempre: motivo obligatorio, permiso de admin, kardex + auditoría. Ajustes negativos grandes (umbral configurable) exigen PIN.

### 6.5 Proveedores

- CRUD (soft delete solo sin compras asociadas; con historial → inactivar).
- Ficha: historial de compras, productos suministrados, último costo, total comprado por periodo.

### 6.6 Usuarios y acceso

- OWNER/STORE_ADMIN crea usuarios y los asigna a tiendas con rol. Alta → invitación con contraseña temporal + cambio forzado.
- Baja de personal: desactivar usuario → revoca todos sus refresh tokens (efecto inmediato en todos sus dispositivos).
- Login: email+contraseña (Argon2id), rate limit por IP y por cuenta, lockout progresivo, todo intento auditado.

### 6.7 Alertas de stock

- Al confirmar cualquier movimiento que baje stock: job BullMQ evalúa `stock_qty <= min_stock` → crea/actualiza `stock_alerts` (sin duplicar) → notificación in-app (email/WhatsApp como mejora futura). La alerta se cierra sola cuando el stock se recupera.

### 6.8 Auditoría (transversal)

- Un helper de auditoría (`audit(tx, …)`) invocado explícitamente por cada servicio registra las acciones del catálogo auditable **dentro de la misma transacción** del cambio (una acción sin su log no puede committear). Explícito y no "mágico" por interceptor: en Express la llamada visible en el servicio es más fiable y más fácil de revisar (D-019).
- Los ledgers (`inventory_movements`, `cash_movements`) son auditoría de dominio por sí mismos; `audit_logs` cubre el resto (quién, qué, antes/después, desde dónde).
- Super Admin: vista global filtrable por tenant/tienda/usuario/acción/fecha.

---

## 7. Validaciones y reglas de integridad

**En base de datos (última línea de defensa):**
- RLS en toda tabla tenant-scoped; rol de app sin `BYPASSRLS`.
- Triggers que rechazan `UPDATE/DELETE` en `inventory_movements`, `cash_movements`, `audit_logs` y `sales` ya commiteadas (solo transición de status permitida vía función).
- `CHECK`s: stock ≥ 0 (según config), montos ≥ 0, `qty ≠ 0`, `difference = counted − expected`.
- Unicidad tenant-scoped e índice parcial único: una sesión OPEN por caja.
- FKs `ON DELETE RESTRICT` en datos operativos.

**En aplicación (dominio):**
- DTOs validados con Zod en el borde (`packages/shared` — mismas reglas en front y back).
- Venta exige sesión de caja OPEN del propio usuario; cierre de caja exige que no haya ventas en vuelo.
- Anulación/retiro/ajuste exigen motivo no vacío (mín. longitud) y permiso/PIN.
- Correlativos solo desde `counters` transaccional.
- Recepción de compra no acepta costos ≤ 0; venta no acepta precio < 0; descuento ≤ subtotal.
- Idempotencia en POS: `client_op_id` UUID por operación de venta — reintentos de red no duplican ventas.

**Job de consistencia (nocturno):** recomputa stock desde el kardex y lo compara con `store_products.stock_qty`; discrepancias → alerta interna (nunca auto-corrige en silencio).

---

## 8. Seguridad y escalabilidad

**Seguridad:**
- TLS en todo (lo gestiona Render, HSTS activo).
- Refresh token: **v1 en `localStorage`** con rotación + detección de reuso (revoca la familia completa al detectar un token viejo). Cookie `httpOnly` compartida no es viable en Render: `onrender.com` está en la Public Suffix List, así que Static Site y Web Service no pueden compartir cookies (D-021). Al tener dominio propio (app y api bajo el mismo sitio) se migra a cookie `httpOnly/secure/sameSite`.
- Argon2id; rate limiting (Redis) por IP+cuenta; lockout progresivo; 2FA TOTP para OWNER/SUPER_ADMIN (fase 6).
- Validación de entrada en el borde (Zod) + queries parametrizadas (Prisma) → SQLi cubierto; CSP y sanitización → XSS; CSRF no aplica en v1 (API con Bearer, sin cookies — ver D-021).
- Secretos en variables de entorno inyectadas por el orquestador (nunca en repo); rotación documentada.
- Backups: WAL continuo + snapshot diario, retención 30 días, **restore ensayado** mensualmente; cifrado at-rest.
- Cabeceras de seguridad (helmet), dependencias auditadas en CI (`pnpm audit`, Dependabot).
- Datos personales mínimos (nombre, email, teléfono) — sin datos sensibles de consumidores finales en v1.

**Escalabilidad:**
- API stateless → réplicas horizontales tras LB sin cambios de código.
- Lecturas pesadas (reportes) → réplica de lectura de Postgres cuando el volumen lo pida; agregados diarios precalculados (`daily_store_stats`) por job nocturno para dashboards instantáneos.
- Particionado mensual de `inventory_movements` y `audit_logs` (las dos tablas que crecen sin límite): el diseño lo contempla ([docs/schema.sql](docs/schema.sql)), pero se aplica vía migración SQL **cuando el volumen lo amerite** — las consultas ya filtran por fecha, así que activarlo después no rompe nada (D-020). Archivado de particiones > 24 meses a storage frío.
- Cache de catálogo POS en Redis con invalidación por evento de cambio de producto.
- Límites por plan (tiendas, usuarios) aplicados en dominio → el crecimiento comercial no degrada tenants vecinos; rate limit por tenant contra vecinos ruidosos.

---

## 9. Plan de implementación por fases

> Cada fase termina con sus criterios cumplidos y `CLAUDE.md` actualizado. No se inicia una fase con la anterior incompleta.

**Fase 0 — Fundaciones (la más crítica) — ✅ COMPLETADA 2026-07-31**

> **Qué se implementó y evidencia:** monorepo npm workspaces (`apps/api` Express 5 + TS, `apps/web` React 19 + Vite, `packages/shared` con permisos/DTOs Zod/utilidades de dinero). Dos migraciones Prisma: `init_platform_identity` (11 tablas de plataforma + identidad + auditoría) y `rls_security` (rol `app_runtime` sin BYPASSRLS, RLS + FORCE con política `tenant_isolation` en tenants/subscriptions/users/stores/store_members/audit_logs, política `admin_bypass` solo para el rol de migraciones, `audit_logs` append-only por trigger). Auth completa (login tenant y plataforma, refresh rotativo con detección de reuso que revoca la familia, logout, `/me`), RBAC por middleware + catálogo seedeado, suspensión de tenant con cache TTL 60 s e invalidación inmediata, auditoría transaccional (D-019). Seeds idempotentes (super admin, 2 planes, 2 tenants demo con owner/worker/tienda; `SEED_DEMO_TENANTS=false` en prod). **14/14 tests en verde** (suite de aislamiento en dos capas + auth/suspensión), typecheck limpio en api y web, y login end-to-end verificado en navegador contra el dashboard. Deploy documentado en [docs/deploy.md](docs/deploy.md).
> **Impacto:** las fases 1+ heredan tenancy, permisos y auditoría resueltos; los módulos nuevos solo agregan `router + service` y sus tablas con la misma política RLS (la migración deja `ALTER DEFAULT PRIVILEGES` listo para tablas futuras).

- **Objetivo:** esqueleto sobre el que todo lo demás es "solo features".
- **Componentes:** monorepo npm workspaces (`apps/api`, `apps/web`, `packages/shared`), esquema base (plataforma + identidad) con migraciones Prisma, RLS activo con **rol de runtime sin BYPASSRLS** (dos connection strings: runtime y admin/migraciones), helpers Prisma de contexto de tenant, auth completa (login, refresh rotativo con detección de reuso, revocación por dispositivo), RBAC (middleware + seed de permisos), helper de auditoría transaccional, seeds (super admin + 2 tenants demo con tiendas y usuarios), logging pino, tests de aislamiento y auth (vitest), esqueleto web con login funcional.
- **Dependencias:** ninguna. **Riesgos:** diseñar mal la tenancy aquí contamina todo — mitigación: **tests de aislamiento automatizados** (tenant A jamás lee/escribe datos de B, con y sin filtro de app, probando que RLS solo también protege).
- **Criterios de finalización:** dos tenants demo con usuarios; suite de aislamiento en verde; login/refresh/revocación probados; auditoría registrando; login end-to-end desde la web local; pasos de deploy a Render/Aiven documentados.

**Fase 1 — Catálogo e inventario**
- **Objetivo:** el tendero carga su tienda.
- **Componentes:** CRUD productos/categorías/unidades/códigos de barras, `store_products`, ajustes/merma/consumo con kardex, vista kardex por producto, importación CSV inicial de productos.
- **Dependencias:** F0. **Riesgos:** modelar mal producto-vs-tienda — ya resuelto en diseño (§5.2).
- **Criterios:** kardex refleja todo movimiento con `balance_after` correcto; job de consistencia en verde; import CSV de 1,000 productos < 30 s.

**Fase 2 — POS y caja (corazón del producto)**
- **Objetivo:** vender de verdad en mostrador.
- **Componentes:** pantalla POS (teclado + lector HID), apertura/cierre/arqueo de caja, venta transaccional completa (§6.1), pagos mixtos, anulación con compensaciones, retiros/gastos de caja con PIN, comprobante imprimible (vía CSS 58/80 mm), reimpresión, idempotencia `client_op_id`.
- **Dependencias:** F1. **Riesgos:** carreras de stock y doble cobro — mitigación: decremento atómico + idempotencia + tests de concurrencia.
- **Criterios:** venta completa < 10 s de principio a fin; arqueo cuadra al centavo en pruebas de turno completo; anulación deja inventario y caja exactamente compensados.

**Fase 3 — Compras, proveedores y gastos**
- **Objetivo:** ciclo completo de reposición y costo real.
- **Componentes:** CRUD proveedores, recepción de compras con recálculo CPP, `product_suppliers`, gastos con categorías y evidencia (S3), anulación de compra.
- **Dependencias:** F1 (kardex), F2 (gastos desde caja). **Riesgos:** CPP con compras retroactivas — v1 solo permite compra a fecha actual (decisión D-011).
- **Criterios:** CPP verificado contra casos calculados a mano; compra de 50 líneas < 5 s; evidencias subiendo a S3 con URLs prefirmadas.

**Fase 4 — Reportes y alertas**
- **Objetivo:** el dueño ve su negocio sin estar en la tienda.
- **Componentes:** dashboard por tienda, reportes: ventas (fecha/usuario/categoría/tienda), utilidades por producto, gastos por tipo, movimientos de caja, ventas anuladas, inventario y stock bajo, compras por proveedor; exportación CSV; alertas de stock (job + notificaciones in-app); agregados `daily_store_stats`.
- **Dependencias:** F2, F3. **Riesgos:** reportes lentos — mitigación: agregados precalculados + índices dedicados + réplica de lectura si hace falta.
- **Criterios:** cualquier reporte de un mes de datos < 2 s; cifras cuadran contra los ledgers en tests de reconciliación.

**Fase 5 — Panel de plataforma (SaaS)**
- **Objetivo:** operar el negocio SaaS.
- **Componentes:** panel Super Admin: CRUD tenants/planes/suscripciones, suspensión/reactivación (guard global), métricas globales, auditoría global, impersonación auditada ("ver como tenant" con banner y registro).
- **Dependencias:** F0 (el modelo ya existe; esto es la UI/operativa). **Riesgos:** impersonación mal auditada — cada acción impersonada se marca en `audit_logs`.
- **Criterios:** suspender un tenant lo bloquea en < 1 min sin afectar a otros; onboarding de tenant nuevo < 5 min.

**Fase 6 — Hardening y experiencia de tienda**
- **Objetivo:** calidad de producto comercial.
- **Componentes:** escáner por cámara (BarcodeDetector/ZXing), ESC/POS vía QZ Tray (corte, gaveta), PWA pulida (instalable, tolerancia a micro-cortes), 2FA TOTP, ensayo de restore de backups, pruebas de carga, revisión de seguridad (checklist OWASP ASVS nivel 1–2).
- **Dependencias:** F2–F5. **Criterios:** impresión con corte automático en al menos 2 marcas de impresora reales; PWA reintenta y no duplica ventas ante corte de red simulado.

**Fase 7 — Comercialización avanzada (post-lanzamiento, priorizar según clientes):** ver §10 Mejoras futuras.

---

## 10. Riesgos técnicos y mejoras futuras

**Riesgos principales:**

| Riesgo | Mitigación |
|---|---|
| Fuga de datos entre tenants (el riesgo existencial del SaaS) | Doble capa app+RLS, tests de aislamiento en CI, revisión obligatoria de toda query cruda. |
| Carreras de stock / ventas duplicadas | Decremento atómico, idempotencia por `client_op_id`, tests de concurrencia. |
| Internet inestable en tiendas | PWA con reintentos idempotentes v1; **offline-first real es la mejora futura #1** (cola local + sincronización — proyecto grande, no improvisar). |
| Crecimiento sin límite de ledgers/auditoría | Particionado mensual día 1 + archivado a frío. |
| Diversidad de impresoras térmicas | Vía CSS universal como base + ESC/POS/QZ para experiencia premium; matriz de hardware probado documentada. |
| Deriva entre stock materializado y kardex | Job nocturno de reconciliación que alerta, nunca corrige en silencio. |
| Regulatorio (FEL/SAT) | Modelo de datos ya reserva campos; integración con certificador como fase dedicada. |
| Bus factor (equipo pequeño) | Este documento + ADRs + CI estricta + código aburrido y estándar. |

**Mejoras futuras (backlog priorizado):**
1. **Modo offline-first** del POS (cola local + sync). 2. **FEL** (facturación electrónica SAT vía Infile/Digifact). 3. **Ventas al crédito / "fiado"** con cuenta por cliente — altísimo valor en tiendas de barrio GT. 4. Cobro de suscripciones con **Recurrente**. 5. Transferencias de stock entre tiendas. 6. Notificaciones por **WhatsApp** (canal dominante en GT). 7. Conteo físico ciclado (inventarios parciales guiados). 8. Promociones/combos y precios por volumen. 9. Roles personalizados por tenant. 10. App móvil nativa para el dueño (solo dashboards). 11. API pública + webhooks. 12. BI multi-tienda comparativo.

---

## 11. Registro de decisiones (ADR)

> Formato: `D-###` | fecha | decisión | contexto/justificación breve. Toda decisión nueva se agrega aquí; si se revierte, se registra la reversión (no se edita la original).

| ID | Fecha | Decisión | Justificación |
|---|---|---|---|
| D-001 | 2026-07-31 | Monolito modular NestJS con Clean Architecture; no microservicios | §2.1: volumen del dominio, transaccionalidad, equipo pequeño. |
| D-002 | 2026-07-31 | Multi-tenancy: esquema compartido + `tenant_id` + RLS, defensa en dos capas | §2.2: costo marginal ~0 por tenant, migración única; RLS cubre bugs de app. |
| D-003 | 2026-07-31 | Tenant = negocio; tiendas como hijas; `tenant_id` denormalizado en tablas operativas | Requisito multi-tienda por cliente; RLS e índices sin joins. |
| D-004 | 2026-07-31 | PostgreSQL 16 + Prisma; dinero en `BIGINT` centavos; stock `NUMERIC(12,3)` | RLS nativo, ACID; sin floats en dinero; granel soportado. |
| D-005 | 2026-07-31 | Auth propia: JWT 15 min + refresh rotativo con detección de reuso; Argon2id | Costo de IdP externo por cajero; revocación por dispositivo. |
| D-006 | 2026-07-31 | Costeo por promedio ponderado por tienda; costo congelado en línea de venta | Estándar retail; utilidad histórica inmutable. |
| D-007 | 2026-07-31 | Ledgers inmutables (kardex, caja, auditoría) con triggers anti UPDATE/DELETE; anulaciones compensatorias | Requisito de trazabilidad total; nada crítico se borra. |
| D-008 | 2026-07-31 | Stock materializado en `store_products` + kardex como fuente de verdad + reconciliación nocturna | O(1) en POS sin sacrificar auditabilidad. |
| D-009 | 2026-07-31 | Impresión en dos vías: CSS 58/80 mm (universal) y ESC/POS vía QZ Tray (fase 6) | Funciona día 1 en todo hardware; experiencia premium después. |
| D-010 | 2026-07-31 | Escaneo: lector HID (principal) + cámara con BarcodeDetector/ZXing (fallback) | HID sin integración; cámara para quien no tiene lector. |
| D-011 | 2026-07-31 | Compras solo a fecha actual en v1 (sin retroactivas) | Evita recálculo retroactivo de CPP; se reevalúa con feedback real. |
| D-012 | 2026-07-31 | Precios con IVA incluido; régimen fiscal solo desglose informativo; FEL pospuesto | Práctica retail GT; FEL es fase dedicada (campos ya reservados). |
| D-013 | 2026-07-31 | Suscripciones: gestión manual v1; Recurrente como pasarela futura; Stripe descartado | Stripe no opera en GT; no bloquear lanzamiento. |
| D-014 | 2026-07-31 | Monorepo pnpm+Turborepo con `packages/shared` (tipos/DTOs/permisos) | Contratos tipados front-back; una fuente de validación (Zod). |
| D-015 | 2026-07-31 | DDL de referencia en [docs/schema.sql](docs/schema.sql); CLAUDE.md explica el porqué, el SQL define el qué | Mantiene este documento legible y el esquema exacto versionado. |
| D-016 | 2026-07-31 | **Stack definitivo por decisión del dueño del proyecto:** Express 5 + TypeScript (sustituye NestJS de D-001), React 19 + Vite SPA (sustituye Next.js), deploy en Render (Static Site + Web Service) con PostgreSQL en Aiven (sustituye VPS+Docker). Monorepo con npm workspaces (ajusta D-014: sin pnpm/Turborepo). | Familiaridad del desarrollador y cero operación de infraestructura — trabaja una sola persona. La arquitectura (monolito modular, Clean Architecture, multi-tenancy RLS) se conserva íntegra; solo cambia el andamiaje. |
| D-017 | 2026-07-31 | Tooling ligero para equipo de uno: sin Husky, sin pre-commit hooks, sin CI/CD pesado; TypeScript estricto + vitest **solo** en rutas críticas (aislamiento de tenants, auth, dinero/CPP, caja); deploy = autodeploy de Render en push | Pedido explícito del dueño: priorizar velocidad. Los tests se concentran donde un bug cuesta dinero o filtra datos. Se reevalúa si el equipo crece. |
| D-018 | 2026-07-31 | `users.email` **único global** (no por tenant) en v1 | Permite login con solo email+contraseña, sin selector de tenant. El caso "misma persona en dos negocios distintos" es raro; si aparece, se migra a `UNIQUE(tenant_id,email)` + selector. Actualizado en schema.sql. |
| D-019 | 2026-07-31 | Auditoría por llamada explícita `audit(tx, …)` en cada servicio, dentro de la misma transacción — no interceptor genérico | En Express, la llamada visible es más fiable (no hay acción auditable sin su línea de audit a la vista) y trivial de revisar. |
| D-020 | 2026-07-31 | Redis/BullMQ pospuestos a Fase 4 (rate limit y cache en memoria mientras haya una sola instancia); particionado de ledgers pospuesto hasta que el volumen lo amerite (se activa por migración SQL sin romper nada) | YAGNI aplicado a infraestructura: el diseño reserva los puntos de corte, el costo se paga cuando el problema existe. |
| D-021 | 2026-07-31 | Refresh token en `localStorage` en v1 (rotación + detección de reuso como mitigación), migrar a cookie `httpOnly` al tener dominio propio | `onrender.com` está en la Public Suffix List: el Static Site y el Web Service no pueden compartir cookies entre subdominios de Render. |

---

## 12. Estructura de proyecto prevista

```
/
├── CLAUDE.md                  ← este documento (mantener SIEMPRE actualizado)
├── docs/
│   ├── schema.sql             ← modelo relacional de referencia (PostgreSQL)
│   └── deploy.md              ← pasos de despliegue Render + Aiven
├── apps/
│   ├── api/                   ← Express: src/modules/{auth,platform,tenancy,audit,
│   │                             catalog,inventory,sales,cash,purchasing,expenses,reports}
│   │                             src/middleware/ · src/lib/ · prisma/ · tests/
│   └── web/                   ← React+Vite: src/{pages,api,auth,components}
└── packages/
    └── shared/                ← tipos, DTOs Zod, catálogo de permisos, utilidades de dinero
```
Dev local: PostgreSQL instalado en la máquina (o instancia dev en Aiven); producción: Aiven. Sin Docker ni CI por decisión D-017 — el deploy es `git push` (autodeploy de Render).

**Reglas de trabajo permanentes (checklist previo a crear cualquier archivo):** ¿es la solución más simple que cumple? ¿escala a miles de tiendas? ¿mantiene aislamiento entre tenants? ¿respeta la separación de módulos (sin imports cruzados de repositorios)? ¿evita duplicación contra `packages/shared`? ¿queda auditado lo que deba auditarse? Si alguna respuesta es no → replantear antes de escribir.
