# Astro public-site starter

Plantilla Astro estática para la parte pública de un SaaS: landing, pricing, documentación, blog, metadatos SEO, `robots.txt` y sitemap. Está diseñada para funcionar sin backend y no incluye dashboard ni autenticación.

## Arranque

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev
```

Abre [http://localhost:4321](http://localhost:4321). Configura `PUBLIC_SITE_URL` con el dominio canónico antes del despliegue: se usa para los enlaces canónicos, `robots.txt` y el sitemap.

## Qué incluye

- Páginas estáticas de inicio, pricing, documentación y blog de ejemplo.
- Etiquetas `description`, canonical, Open Graph y Twitter Card por página.
- `@astrojs/sitemap` y una ruta `robots.txt`.
- Un formulario de contacto con validación de navegador y un script aislado; todavía no envía datos. Conéctalo a un endpoint o proveedor de formularios cuando el producto lo necesite.

## Límites deliberados

Esta plantilla no consume el contrato de autenticación común ni requiere backend. Para un dashboard autenticado usa `frontend:nextjs` o un futuro starter de aplicación. Mantén las páginas de marketing y el contenido público aquí para conservar una carga inicial mínima.

## Verificación

```bash
pnpm check
pnpm build
```
