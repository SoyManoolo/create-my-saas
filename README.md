# create-my-saas

Genera un proyecto SaaS a partir de una combinación explícita de plantillas
backend y frontend versionadas.

Tras publicar el paquete, crea un proyecto completo con:

```sh
npx create-my-saas@latest my-saas --backend nestjs --frontend nextjs
```

También puedes generar sólo una de las capas:

```sh
npx create-my-saas@latest api-only --backend fastapi
```

## Plantillas disponibles

| Capa | Opción | Uso previsto |
| --- | --- | --- |
| Backend | `fastapi` | API Python completa con sesiones, organizaciones y dominios SaaS. |
| Backend | `nestjs` | API TypeScript modular con la misma base funcional. |
| Backend | `fastify` | API TypeScript ligera con sesión, CSRF, usuarios y migración PostgreSQL; amplíala con recuperación y verificación antes de usarla con un dashboard autenticado. |
| Frontend | `nextjs` | Dashboard SaaS autenticado con Next.js. |
| Frontend | `react-router` | Aplicación React flexible con SSR o despliegue SPA. |
| Frontend | `astro` | Sitio público rápido para marketing, documentación y blog. |

Astro puede crearse sin backend, o junto al starter Fastify para mantener sitio
público y API como capas separadas:

```sh
npx create-my-saas@latest public-site --backend fastify --frontend astro
```

Los frontends de dashboard declaran las capacidades de API que necesitan. La
CLI rechaza una combinación incompatible antes de crear el directorio; consulta
`--list` para ver el catálogo instalado.

Consulta las opciones disponibles antes de generar:

```sh
npx create-my-saas@latest --list
```

El comando no sobrescribe directorios existentes. Cada salida incluye
`.create-my-saas.json` con los IDs y versiones de las plantillas elegidas. Los
artefactos de dependencias y compilación locales no se copian.

Para probar la CLI desde este repositorio sin publicar el paquete:

```sh
node packages/cli/bin/create-my-saas.js my-saas --backend nestjs --frontend nextjs
```

La distribución publica incluye la CLI, las plantillas y su documentación, pero
excluye las dependencias, entornos virtuales y compilados locales; se puede
inspeccionar con `npm pack --dry-run`.

