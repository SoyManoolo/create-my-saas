# React Router Framework SaaS starter

Frontend reutilizable para un SaaS dinámico, construido con React Router en Framework Mode y Vite. Incluye renderizado en servidor, rutas públicas y protegidas, sesión de navegador, recuperación de contraseña, verificación de email, OAuth Google/GitHub y cierre de sesión. Es compatible con los backends que implementen el contrato común del proyecto.

El access token sólo vive en memoria de la pestaña. El refresh token permanece en una cookie `HttpOnly`; la cookie CSRF no secreta se lee en el navegador para enviar `X-CSRF-Token` en las operaciones que cambian estado. Nunca se usa `localStorage` para tokens.

## Capacidades y compatibilidad

Implementa las capacidades de `template.manifest.json`: SSR, sesión de navegador,
CSRF, recuperación, verificación, OAuth Google/GitHub, analítica con
consentimiento, SEO y Stripe Billing. Requiere organizaciones y `billing.stripe`,
por lo que es compatible con FastAPI y NestJS.

## Requisitos

- Node.js 20.19 o posterior y pnpm 11.
- Un backend FastAPI o NestJS accesible desde `API_PROXY_TARGET`.

## Desarrollo local

1. Copia el entorno de ejemplo y selecciona el backend:

```bash
cp .env.example .env
# Nest: configura también PORT=3001 en el backend.
```

2. Instala y arranca la aplicación:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## Configuración

`API_PROXY_TARGET` es obligatoria. La ruta de servidor integrada reenvía
`/auth/*`, `/users/*`, `/organizations/*` y `/billing/*` a ese origen y preserva
las cookies del navegador. En producción configura el mismo proxy con HTTPS y
define `VITE_PUBLIC_SITE_URL` con el dominio canónico.

## Verificación

```bash
pnpm typecheck
pnpm build
```

## SEO

La landing (`/`) incluye descripción, canonical, Open Graph, Twitter Card y es la única URL publicada en el sitemap. Las pantallas de autenticación y el área protegida incluyen `noindex, nofollow, noarchive`, de modo que los formularios y la información de cuentas no se indexan.

## Contrato API

La plantilla consume las rutas canónicas:

- `POST /auth/register` — `{ name, email, password }`
- `POST /auth/login` y `POST /auth/refresh` — `{ accessToken, user }`
- `POST /auth/logout` — con `X-CSRF-Token`
- `GET /users/me` — con `Authorization: Bearer <accessToken>`
- `POST /auth/password/reset/request`, `POST /auth/password/reset/confirm`, `POST /auth/email/verify`, `POST /auth/email/resend`
- OAuth Google/GitHub: Nest entrega `authorizationUrl` en `GET /auth/oauth/:provider`; FastAPI inicia el navegador en `GET /auth/oauth/:provider/start`. Los dos regresan a `/auth/oauth/callback` para restaurar la sesión.
- Facturación: `/billing` carga las organizaciones, los planes allowlisted y el estado de suscripción. El Checkout y el portal se crean en el backend y el navegador sólo sigue la URL de Stripe que devuelve la API.

Tras cargar la aplicación se intenta `POST /auth/refresh`; si falla, las rutas protegidas redirigen al login. El proxy de `app/routes/api-proxy.ts` está limitado a las rutas de API declaradas y mantiene el valor de `API_PROXY_TARGET` exclusivamente en el servidor.

## Analítica de producto

PostHog está incluido pero permanece inactivo hasta configurar `VITE_POSTHOG_KEY` y `VITE_POSTHOG_HOST` con la clave pública y el endpoint de ingestión del proyecto. La primera visita muestra un consentimiento explícito; hasta aceptarlo no se inicializa la captura. La integración desactiva autocapture y session replay, registra páginas, `signup_requested` y `user_signed_in`, e identifica al usuario con su ID interno estable, nunca con su email o nombre. Al cerrar sesión restablece esa identidad. Para añadir eventos de producto usa `captureAnalyticsEvent` desde `app/components/posthog-provider.tsx`; los pagos y otros eventos críticos deben enviarse después desde el backend.

## Extenderla

El dashboard es deliberadamente neutral: añade las entidades, vistas y navegación de tu producto sin cambiar el núcleo de autenticación. Si añades capacidades al starter, actualiza `template.manifest.json` y valida todos los manifests desde la raíz:

```bash
node scripts/validate-template-manifests.mjs
```

## Límites deliberados

El dashboard no incluye entidades ni flujos específicos del producto. Mantén el
contrato de autenticación y actualiza `template.manifest.json` al añadir nuevas
capacidades.
