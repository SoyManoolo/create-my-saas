# Astro public-site starter

Plantilla Astro para la parte pública y el área protegida de un SaaS: landing, pricing, documentación, blog, metadatos SEO, `robots.txt`, sitemap y autenticación real de navegador.

## Arranque

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev
```

Abre [http://localhost:4321](http://localhost:4321). Configura `PUBLIC_SITE_URL` con el dominio canónico antes del despliegue: se usa para los enlaces canónicos, `robots.txt` y el sitemap. El generador rellena `API_PROXY_TARGET` para que Astro reenvíe `/auth`, `/users`, `/organizations` y `/billing` durante desarrollo. En producción, `PUBLIC_API_BASE_URL` debe ser una ruta del mismo origen que reenvíe esos prefijos; esto conserva el alcance de las cookies `HttpOnly` y CSRF.

## Qué incluye

- Páginas públicas de inicio, pricing, documentación y blog, sin precios ni métricas inventadas.
- Etiquetas `description`, canonical, Open Graph y Twitter Card por página.
- `@astrojs/sitemap` y una ruta `robots.txt`.
- Registro, login, sesión con refresh cookie `HttpOnly`, rutas protegidas, logout, recuperación, verificación de correo y OAuth Google/GitHub.
- Una ruta protegida `/billing/` que consulta las organizaciones, planes allowlisted y suscripción. Checkout y el portal de cliente se crean en el backend; el navegador sólo sigue la URL segura devuelta por Stripe.

## Límites deliberados

Requiere un backend que implemente el contrato común de autenticación, CSRF y OAuth PKCE. Configura las credenciales y URLs de callback de Google/GitHub en ese backend; el navegador nunca recibe secretos OAuth ni el refresh token.

## Verificación

```bash
pnpm check
pnpm build
```
