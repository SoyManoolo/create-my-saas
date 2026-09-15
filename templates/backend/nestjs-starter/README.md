# NestJS SaaS starter

API SaaS modular en NestJS con PostgreSQL, sesiones seguras para navegador,
usuarios, organizaciones con RBAC, invitaciones y audit log, recuperación y verificación
de cuenta, OAuth de Google/GitHub y facturación opcional con Stripe. Las
migraciones son la única forma de crear o modificar el esquema: TypeORM no usa
`synchronize` fuera de las pruebas.

## Requisitos

- Node.js 22.14 o posterior (la imagen de producción usa Node 22.14).
- pnpm 11 (`corepack enable` activa la versión fijada por el proyecto).
- PostgreSQL accesible desde la API.
- Redis para límites compartidos. En desarrollo puede no estar disponible y el
  límite usa memoria local; en `staging` y `production` debe ser Redis con TLS.

Desde el directorio de este starter, prepara el entorno e instala las
dependencias:

```sh
corepack enable
cp .env.example .env
pnpm install --frozen-lockfile
```

En PowerShell, sustituye el segundo comando por:

```powershell
Copy-Item .env.example .env
```

Edita como mínimo estas variables de `.env` antes de arrancar:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nestjs_starter
SECRET_KEY=un-secreto-aleatorio-largo-y-unico
CORS_ORIGINS=http://localhost:3000
FRONTEND_URL=http://localhost:3000
REDIS_URL=redis://localhost:6379
```

`SECRET_KEY` firma JWT y protege los tokens de un solo uso. No reutilices el
valor de ejemplo ni lo guardes en el repositorio. `FRONTEND_URL` es la URL a la
que terminan los callbacks OAuth y los enlaces de cuenta; `CORS_ORIGINS` es una
lista separada por comas de orígenes de navegador autorizados.

## Arranque local

Con PostgreSQL creado y la URL de `.env` apuntando a esa base:

```sh
pnpm migration:run
pnpm start:dev
```

La API queda en `http://localhost:3001` con el `.env.example`. `GET /health`
es liveness puro; `GET /ready` comprueba PostgreSQL y, si el rate limiting está
activo, Redis con timeout corto. Una dependencia requerida no disponible
devuelve `503 SERVICE_NOT_READY` estructurado. `pnpm start` inicia Nest sin
modo watch y `pnpm start:debug` abre el depurador de Node.

Para reconstruir desde una base vacía, usa una base desechable, ejecuta
`pnpm migration:run` y repite el comando: la segunda ejecución no debe aplicar
cambios. No apuntes esa comprobación a una base compartida. Para deshacer sólo
la última migración existe `pnpm migration:revert`.

## Compilar y ejecutar en producción

El proceso de migración necesita las dependencias de desarrollo, por lo que se
ejecuta como etapa de despliegue antes del runtime con dependencias de
producción:

```sh
pnpm install --frozen-lockfile
pnpm migration:run
pnpm build
APP_ENV=production pnpm start:prod
```

En PowerShell, el último comando es:

```powershell
$env:APP_ENV = 'production'; pnpm start:prod
```

`pnpm start:prod` ejecuta `node dist/main`; no compila ni migra por sí mismo.
La imagen incluida sigue la misma separación: construye con `Dockerfile`, usa
el target `migrate` para ejecutar `pnpm migration:run` con las variables de
despliegue y el target final expone el puerto 8000. Mantén las credenciales en
el gestor de secretos de la plataforma, no dentro de la imagen.

## Pruebas y comprobaciones

```sh
pnpm test
pnpm test:e2e
pnpm build
```

Los scripts de prueba ya incluyen la opción de Node necesaria para las
dependencias ESM de Nest. Las unitarias cubren servicios aislados. Las E2E
fijan `NODE_ENV=test` y emplean una base `sql.js` efímera; no validan
PostgreSQL, TLS, Redis ni proveedores OAuth/Stripe reales. Valida esos
servicios en un entorno de integración antes de promocionar un despliegue.

## Cookies, CORS y proxy inverso

La sesión de navegador usa dos cookies:

- La cookie de refresh (`REFRESH_COOKIE_NAME`, por defecto `refresh_token`) es
  `HttpOnly`, está limitada a `/auth` y no se devuelve en JSON.
- La cookie CSRF (`CSRF_COOKIE_NAME`, por defecto `csrf_token`) es legible por
  el frontend y está limitada a `/`. El cliente debe enviarla como
  `X-CSRF-Token` en `POST /auth/refresh` y `POST /auth/logout`.

Configura `COOKIE_SECURE=true` bajo HTTPS. `COOKIE_SAME_SITE` admite `lax`,
`strict` o `none`; `none` exige `COOKIE_SECURE=true`. Para frontend y API en
orígenes diferentes, usa HTTPS, `COOKIE_SAME_SITE=none`, una lista explícita
en `CORS_ORIGINS` y solicitudes de navegador con credenciales. La API habilita
credenciales CORS y sólo permite los métodos `GET`, `POST`, `PUT`, `PATCH`,
`DELETE`, `OPTIONS` y las cabeceras `Authorization`, `Content-Type`,
`X-CSRF-Token` y `X-Request-ID`.

Por defecto no se confía en `X-Forwarded-For` ni `X-Forwarded-Proto`. Si hay un
proxy inverso que termina TLS, añade y activa:

```dotenv
TRUST_PROXY_HEADERS=true
TRUSTED_PROXY_IPS=10.0.0.10,10.0.0.11
```

Lista sólo las IP de los proxies que conectan directamente con la API; nunca
uses `*`. El proxy debe descartar las cabeceras `X-Forwarded-*` enviadas por
internet y reconstruirlas. Sin esa configuración, la IP que usa el límite de
peticiones es la del socket de conexión.

## Rate limiting y servicios de producción

`RATE_LIMIT_ENABLED=true`, `RATE_LIMIT_REQUESTS=30`,
`RATE_LIMIT_WINDOW_SECONDS=60` y `RATE_LIMIT_PREFIX=rate-limit` controlan el
límite general. Login, registro, solicitud de recuperación y confirmación usan
buckets independientes por IP con `AUTH_RATE_LIMIT_REQUESTS=5` y
`AUTH_RATE_LIMIT_WINDOW_SECONDS=60`. En `development`, si Redis no responde, hay un
fallback por proceso. En `staging` y `production` configura
`REDIS_URL=rediss://...` y deja el límite activado: la aplicación rechaza al
arrancar una URL no TLS o un limitador desactivado. Una indisponibilidad de
Redis en un entorno protegido se trata de forma restrictiva; inspecciona la
conectividad, el certificado TLS y las credenciales de la URL.

Para producción y staging son obligatorios además:

```dotenv
APP_ENV=production
DATABASE_SSL=true
DATABASE_URL=postgresql://usuario:clave@host:5432/base
CORS_ORIGINS=https://app.example.com
FRONTEND_URL=https://app.example.com
COOKIE_SECURE=true
REDIS_URL=rediss://usuario:clave@redis.example.com:6380
RATE_LIMIT_ENABLED=true
EMAIL_DELIVERY_URL=https://mail-adapter.example.com/send
EMAIL_DELIVERY_TOKEN=token-del-adaptador
```

`DATABASE_SSL=true` verifica el certificado del servidor PostgreSQL. El
adaptador de correo recibe un `POST` autenticado con Bearer a
`EMAIL_DELIVERY_URL`, con JSON `{ to, subject, text }`, y tiene un límite de
10 segundos. En local puede dejarse sin configurar; entonces no se entrega
correo. En `staging`/`production` faltarlo, que no sea HTTPS o que el adaptador
responda con error impide el arranque o devuelve
`EMAIL_DELIVERY_UNAVAILABLE` (`503`) cuando se intenta entregar.

## OAuth: Google y GitHub

OAuth está desactivado hasta configurar `OAUTH_ENABLED=true`, las credenciales
del proveedor y una URL de callback por proveedor. Para Google:

```dotenv
OAUTH_ENABLED=true
OAUTH_GOOGLE_CLIENT_ID=...
OAUTH_GOOGLE_CLIENT_SECRET=...
OAUTH_GOOGLE_REDIRECT_URI=https://api.example.com/auth/oauth/google/callback
```

Registra exactamente esa última URL como *Authorized redirect URI* en Google.
Para GitHub, registra y configura de igual forma:

```dotenv
OAUTH_GITHUB_CLIENT_ID=...
OAUTH_GITHUB_CLIENT_SECRET=...
OAUTH_GITHUB_REDIRECT_URI=https://api.example.com/auth/oauth/github/callback
```

Las URLs de autorización, token, perfil y scopes de ambos proveedores tienen
valores por defecto en `.env.example`; sólo cámbialas si el proveedor o el
entorno lo exige. El frontend empieza el flujo en `GET /auth/oauth/google` o
`GET /auth/oauth/github`. Tras el callback, la API establece la sesión en
cookies y redirige, sin token en la URL, a
`FRONTEND_URL/auth/oauth/callback`. La implementación usa state de un solo uso
y PKCE; el proveedor debe devolver una dirección de correo válida y verificada.
El primer acceso crea una vinculación `oauth_accounts` entre el sujeto inmutable
del proveedor y el usuario local; los accesos posteriores resuelven esa
vinculación antes que el email. Si ambos identificadores apuntan a usuarios
distintos, el callback devuelve `OAUTH_ACCOUNT_CONFLICT` y no fusiona cuentas.

## Stripe Billing

Stripe es opcional. Sin configuración, las rutas de Checkout y Portal devuelven
un resultado explícito con `configured=false` y no generan URL. Para activarlo,
configura conjuntamente:

```dotenv
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PLANS={"price_pro_monthly":{"name":"pro","entitlements":{"api_requests":10000,"projects":25}}}
BILLING_FREE_ENTITLEMENTS={"api_requests":100,"projects":1}
# Opcional: sólo si se ha creado ese meter event en Stripe Billing.
STRIPE_USAGE_EVENT_NAME=api_requests
# Opcional, para una configuración concreta del Customer Portal.
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
```

`STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` deben existir juntos; con Stripe
activo, `STRIPE_PRICE_PLANS` debe ser un objeto JSON no vacío que sólo incluya
los Price IDs permitidos. No aceptes precios arbitrarios enviados por el
navegador. Registra en Stripe el endpoint:

```text
https://api.example.com/billing/webhooks/stripe
```

Suscríbelo como mínimo a `checkout.session.completed` y a los eventos
`customer.subscription.*` que correspondan a altas, cambios, cancelaciones y
pagos. Copia el secreto de firma de ese endpoint en `STRIPE_WEBHOOK_SECRET`.
La API verifica `Stripe-Signature` sobre el cuerpo crudo, rechaza firmas no
válidas y deduplica entregas por ID de evento. El proxy no debe descomprimir,
reescribir ni reconstruir el cuerpo del webhook antes de que llegue a Nest.

Los administradores u owners de una organización usan `POST
/organizations/:organizationId/billing/checkout` y `/portal`. Checkout vuelve
al `FRONTEND_URL` configurado. Los entitlements se actualizan por webhook; el
  uso facturable se registra sólo desde código de servidor de confianza mediante
  un idempotency key, nunca desde una mutación HTTP del navegador.

## Audit log de acciones sensibles

Nest registra en la tabla append-only `audit_logs` las invitaciones emitidas y
aceptadas, cambios de rol, bajas de miembros, transferencias de ownership y la
creación efectiva de Checkout o Portal. Sólo owners y administradores pueden
consultarlo con `GET /organizations/:organizationId/audit-logs`. `limit` vale 50
por defecto (máximo 100) y `cursor` continúa desde `nextCursor`.

El registro está activo por defecto. Usa `AUDIT_LOG_ENABLED=false` para dejar
de guardar eventos nuevos sin afectar las operaciones de negocio, borrar la
tabla ni ocultar el histórico. Al devolverlo a `true` se reanuda el registro
sin migraciones.

Cada evento conserva organización, actor, acción, objetivo, fecha y metadatos
específicos permitidos por una allowlist. Nunca se guardan tokens o hashes,
payloads de petición/proveedor, credenciales, IDs de cliente/sesión/suscripción
de Stripe, medios de pago ni tarjetas. El email invitado sí se conserva para
investigación de incidencias; antes de usar este registro para enterprise o
compliance, define la retención y exportación exigidas por el producto.

## Diagnóstico de fallos

La configuración se valida al iniciar y el proceso sale con un mensaje
concreto. Estas son las causas habituales:

| Síntoma | Comprobación y corrección |
| --- | --- |
| `DATABASE_URL must be set` al migrar o arrancar | Carga `.env`, confirma la URL PostgreSQL y crea la base de datos. Ejecuta `pnpm migration:run` antes de servir tráfico. |
| `SECRET_KEY` o `CORS_ORIGINS` rechazados en producción | Usa un secreto distinto de al menos 32 caracteres y orígenes HTTPS explícitos, sin comodines. |
| Error de `DATABASE_SSL`, Redis o cookies al inicio | En staging/producción usa `DATABASE_SSL=true`, `rediss://`, límite activo y `COOKIE_SECURE=true`; para SameSite `none`, HTTPS también es obligatorio. |
| La IP de todos los clientes es la del proxy | Revisa `TRUST_PROXY_HEADERS`, `TRUSTED_PROXY_IPS` y que el proxy limpie/recree `X-Forwarded-*`. |
| `EMAIL_DELIVERY_UNAVAILABLE` | Comprueba la URL HTTPS, el Bearer token, la respuesta del adaptador y su disponibilidad. Los tokens de recuperación, verificación e invitación nunca salen en la respuesta API. |
| OAuth devuelve `OAUTH_PROVIDER_UNAVAILABLE` o falla el callback | Activa `OAUTH_ENABLED`, revisa client ID/secret, registra una callback idéntica y confirma que `FRONTEND_URL` apunta al frontend público. |
| Checkout/Portal informa que Stripe no está configurado | Añade a la vez key, webhook secret y un JSON de precios permitido; confirma que los Price IDs pertenecen al modo test o live de la clave usada. |
| Webhook Stripe devuelve `400 INVALID_WEBHOOK_SIGNATURE` | Revisa el secreto del endpoint, la cabecera `Stripe-Signature` y que ningún proxy haya cambiado el cuerpo crudo. |
| Se alcanza el límite de peticiones | Ajusta límites sólo con intención; verifica que Redis TLS responde y que el prefijo no colisiona con otra aplicación. |

Las respuestas de error de aplicación tienen la forma
`{ "error": { "code": "...", "message": "..." } }`. Consulta primero el
`code`; no expongas secretos, tokens ni cuerpos de webhooks en los logs. Para
el contrato común de infraestructura y una comprobación de migraciones desde
una base vacía, consulta
[`../backend-infrastructure-contract.md`](../backend-infrastructure-contract.md).
