# Next.js SaaS starter

Frontend reutilizable para un SaaS, compatible con los backends que implementen el contrato común del proyecto. Incluye autenticación de navegador basada en refresh cookies `HttpOnly`, protección CSRF, sesión en memoria, rutas protegidas, registro, recuperación de contraseña, verificación de correo, OAuth Google/GitHub y cierre de sesión. No guarda access tokens en `localStorage` ni incorpora identidades de ejemplo.

## Capacidades y compatibilidad

Implementa las capacidades declaradas en `template.manifest.json`: sesión de
navegador, CSRF, recuperación, verificación, OAuth Google/GitHub, analítica con
consentimiento, SEO y Stripe Billing. Requiere un backend con organizaciones y
`billing.stripe`, por lo que es compatible con FastAPI y NestJS.

## Requisitos

- Node.js 20.9 o posterior y pnpm 11.
- Un backend FastAPI o NestJS configurado y accesible desde `API_PROXY_TARGET`.

## Desarrollo local

1. Copia el entorno de ejemplo y apunta el proxy del servidor Next al backend elegido:

```bash
cp .env.example .env.local
# Nest: configura también PORT=3001 en el backend.
```

2. Instala y arranca el frontend:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## Configuración

`API_PROXY_TARGET` es obligatoria y hace que Next reenvíe `/auth/*`, `/users/*`,
`/organizations/*` y `/billing/*` conservando el mismo origen del navegador.
En producción configura el equivalente en el reverse proxy y usa HTTPS con
`COOKIE_SECURE=true`. Define `NEXT_PUBLIC_SITE_URL` con el dominio canónico.

## Verificación

```bash
pnpm build
```

## SEO

Esta plantilla es una aplicación autenticada, no un sitio de marketing. Por eso todas sus rutas se sirven con `noindex, nofollow` y no genera sitemap: evita indexar pantallas privadas, formularios de acceso y URLs con tokens. El archivo `robots.txt` bloquea además las rutas internas de datos. Expón el contenido público e indexable desde una plantilla de sitio público, como la de Astro.

## Contrato API

El proxy selecciona el backend sin acoplar el navegador a su framework. `NEXT_PUBLIC_API_BASE_URL` se deja vacío con el proxy integrado; sólo configúralo cuando esos endpoints se expongan por el mismo origen. La plantilla consume estas rutas y payloads canónicos:

- `POST /auth/register` — `{ name, email, password }`
- `POST /auth/login` y `POST /auth/refresh` — `{ accessToken, user }`; el refresh token permanece en una cookie `HttpOnly`.
- `POST /auth/logout` — requiere la cabecera `X-CSRF-Token` tomada de la cookie pública configurada con `NEXT_PUBLIC_CSRF_COOKIE_NAME`.
- `GET /users/me` — `Authorization: Bearer <accessToken>`.
- `POST /auth/password/reset/request`, `POST /auth/password/reset/confirm`, `POST /auth/email/verify`, `POST /auth/email/resend`.
- OAuth: Nest expone `GET /auth/oauth/:provider`; FastAPI inicia en `GET /auth/oauth/:provider/start`. Ambos vuelven a `/auth/oauth/callback`, donde el frontend restaura la sesión. Requiere un backend con `oauth.pkce`, Google y GitHub configurados.
- Facturación: `/billing` carga las organizaciones, los planes allowlisted y el estado de suscripción. El Checkout y el portal se crean en el backend y el navegador sólo sigue la URL de Stripe que devuelve la API.

El access token se conserva exclusivamente en memoria durante la pestaña. Al cargar, la aplicación intenta renovar la sesión con la refresh cookie; si falla, redirige al login.

## Analítica de producto

PostHog está incluido pero permanece inactivo hasta configurar `NEXT_PUBLIC_POSTHOG_KEY` y `NEXT_PUBLIC_POSTHOG_HOST` con la clave pública y el endpoint de ingestión del proyecto. La primera visita muestra un consentimiento explícito; hasta aceptarlo no se inicializa la captura. La integración desactiva autocapture y session replay, registra páginas, `signup_requested` y `user_signed_in`, e identifica al usuario con su ID interno estable, nunca con su email o nombre. Al cerrar sesión restablece esa identidad. Para añadir eventos de producto usa `captureAnalyticsEvent` desde `app/components/posthog-provider.tsx`; los pagos y otros eventos críticos deben enviarse después desde el backend.

## Extenderla

El dashboard es deliberadamente neutral. Añade las entidades, vistas y navegación propias del producto sin modificar el núcleo de autenticación. Declara cualquier capacidad nueva del template en `template.manifest.json` y valida todos los manifests desde la raíz:

```bash
node scripts/validate-template-manifests.mjs
```

## Límites deliberados

Es un dashboard autenticado y no un sitio público de marketing. No incluye
entidades ni pantallas específicas del producto; añádelas sin cambiar el
contrato de autenticación ni las capacidades declaradas.
