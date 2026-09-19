# Astro public-site starter

Plantilla Astro para la parte pública y el área protegida ligera de un SaaS: landing, pricing, documentación, blog, metadatos SEO, `robots.txt`, sitemap y autenticación real de navegador.

## Capacidades y compatibilidad

Implementa las capacidades declaradas en `template.manifest.json`: contenido
público, SEO, analítica con consentimiento y autenticación de navegador con
OAuth. Es compatible con Fastify, FastAPI y NestJS para el área ligera. La
feature `billing` añade organizaciones y Stripe, y requiere FastAPI o NestJS.

## Requisitos

- Node.js 20.9 o posterior y pnpm 11.
- `PUBLIC_SITE_URL` y un backend compatible con el contrato de autenticación.

## Desarrollo local

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev
```

## Configuración

`PUBLIC_SITE_URL` es obligatoria y define las URLs canónicas, `robots.txt` y el
sitemap. El generador rellena `API_PROXY_TARGET` para reenviar `/auth` y
`/users` durante desarrollo. En producción, `PUBLIC_API_BASE_URL` debe ser una
ruta del mismo origen que conserve el alcance de las cookies `HttpOnly` y CSRF.

## Qué incluye

- Páginas públicas de inicio, pricing, documentación y blog, sin precios ni métricas inventadas.
- Etiquetas `description`, canonical, Open Graph y Twitter Card por página.
- Las rutas de autenticación y las áreas protegidas incluyen `noindex, nofollow, noarchive` y se excluyen del sitemap.
- `@astrojs/sitemap` y una ruta `robots.txt`.
- Registro, login, sesión con refresh cookie `HttpOnly`, rutas protegidas, logout, recuperación, verificación de correo y OAuth Google/GitHub.

## Límites deliberados

Requiere un backend que implemente el contrato común de autenticación, CSRF y OAuth PKCE. Fastify, FastAPI y NestJS cumplen ese contrato. Configura las credenciales y URLs de callback de Google/GitHub en ese backend; el navegador nunca recibe secretos OAuth ni el refresh token.

Para añadir organizaciones y Stripe Billing, genera Astro con `--feature billing`. Esa característica sólo es compatible con FastAPI y NestJS; sustituye esta versión ligera por las rutas y proxies de facturación.

## Analítica de producto

PostHog está incluido pero permanece inactivo hasta configurar `PUBLIC_POSTHOG_KEY` y `PUBLIC_POSTHOG_HOST` con la clave pública y el endpoint de ingestión del proyecto. La primera visita muestra un consentimiento explícito; hasta aceptarlo no se inicializa la captura. La integración desactiva autocapture y session replay, registra páginas y `signup_requested`, e identifica al usuario con su ID interno estable, nunca con su email o nombre. Al cerrar sesión restablece esa identidad. Para añadir eventos de producto usa `captureAnalyticsEvent` desde `src/scripts/posthog.ts`; los pagos y otros eventos críticos deben enviarse después desde el backend.

## Verificación

```bash
pnpm check
pnpm build
```
