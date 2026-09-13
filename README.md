# create-my-saas

`create-my-saas` es un starter configurable para arrancar nuevos productos SaaS
sin volver a construir las partes comunes en cada proyecto. Genera un directorio
con un backend y/o un frontend versionados, seleccionados explícitamente desde
la terminal.

El objetivo no es ocultar las decisiones de arquitectura: cada plantilla sigue
siendo un proyecto independiente y sustituible. La CLI sólo compone opciones
compatibles, configura su conexión local y deja registrada la selección hecha.

## Estado actual

La CLI y el catálogo de plantillas funcionan desde este repositorio. El paquete
todavía **no está publicado en npm**, por lo que el comando `npx` mostrado más
abajo describe el uso previsto tras la publicación.

Actualmente hay seis plantillas:

| Capa | Opción | Estado y propósito |
| --- | --- | --- |
| Backend | `fastapi` | API Python completa: sesiones de navegador, CSRF, usuarios, organizaciones, RBAC, recuperación/verificación, OAuth y modelos de billing. |
| Backend | `nestjs` | API TypeScript modular con el mismo contrato funcional que FastAPI. |
| Backend | `fastify` | API TypeScript ligera con PostgreSQL, sesiones, CSRF, recuperación, verificación de email y OAuth de Google/GitHub. No incluye todavía organizaciones ni Stripe Billing. |
| Frontend | `nextjs` | Dashboard con sesión de navegador, rutas protegidas y flujos de cuenta. |
| Frontend | `react-router` | Dashboard React con renderizado Framework Mode, rutas protegidas y proxy de API same-origin. |
| Frontend | `astro` | Sitio rápido de marketing, documentación y blog; también puede activar la zona autenticada al combinarse con un backend completo. |

Las capacidades de cada starter están declaradas en su
`template.manifest.json`. La CLI las compara antes de escribir archivos: los
dashboards que requieren organizaciones y Stripe Billing necesitan FastAPI o
NestJS. Fastify puede generarse solo o con Astro, porque cubre el contrato de
sesión, recuperación, verificación y OAuth que usa su área autenticada.

## A dónde pretende llegar

El proyecto pretende ser la base para crear un SaaS mediante una decisión de
terminal, por ejemplo: elegir FastAPI, NestJS o un backend futuro; y elegir un
dashboard Next.js/React Router, un sitio Astro o un frontend futuro. Añadir una
opción debe consistir en crear una plantilla autosuficiente, declarar su
contrato de capacidades y ampliar las pruebas de compatibilidad, no en acoplar
los frameworks entre sí.

La base común buscada incluye autenticación segura para navegador, usuarios y
organizaciones, permisos, configuración de PostgreSQL y migraciones, límites de
peticiones, flujos de cuenta y una interfaz lista para empezar un producto. Las
integraciones específicas de cada SaaS —proveedor de pagos, emails reales,
dominio de negocio y despliegue— permanecen configurables o pendientes de la
plantilla correspondiente.

## Uso

Mientras el paquete no esté publicado, ejecútalo desde este checkout:

```sh
node packages/cli/bin/create-my-saas.js my-saas --backend nestjs --frontend nextjs
```

También se puede generar una sola capa:

```sh
node packages/cli/bin/create-my-saas.js api-only --backend fastapi
node packages/cli/bin/create-my-saas.js public-site --frontend astro
```

Para ver el catálogo disponible:

```sh
node packages/cli/bin/create-my-saas.js --list
```

Tras publicar el paquete, el mismo flujo será:

```sh
npx create-my-saas@latest my-saas --backend nestjs --frontend nextjs
```

La CLI no sobrescribe directorios existentes. Cada proyecto generado incluye
`.create-my-saas.json` con los IDs y versiones de las plantillas elegidas, y no
copia dependencias, entornos virtuales ni artefactos de compilación locales.

## Combinaciones

| Necesidad | Combinación recomendada |
| --- | --- |
| Dashboard TypeScript con API completa | `--backend nestjs --frontend nextjs` |
| Dashboard Python con API completa | `--backend fastapi --frontend nextjs` |
| App React con SSR/Framework Mode y billing | `--backend nestjs --frontend react-router` o `--backend fastapi --frontend react-router` |
| Landing, blog o documentación sin área privada | `--frontend astro` |
| Sitio Astro con área privada | `--backend nestjs --frontend astro`, `--backend fastapi --frontend astro` o `--backend fastify --frontend astro` |
| API ligera con autenticación completa | `--backend fastify` |

Los frontends de sesión usan un proxy same-origin configurado mediante
`API_PROXY_TARGET`. Después de generar un proyecto, copia sus archivos de
entorno de ejemplo, configura secretos, URL de PostgreSQL y proveedores que
uses; consulta el README de cada starter para los detalles propios del runtime.

## Desarrollo y comprobaciones

```sh
npm run validate:templates
npm test
```

Estas comprobaciones validan los seis manifiestos y la CLI, incluidas las reglas
de compatibilidad, la generación, el contenido del paquete y la exclusión de
artefactos locales. Las verificaciones de cada starter viven dentro de su
propio directorio.

La distribución de npm ya está preparada para incluir la CLI, las plantillas y
la documentación, y excluir dependencias y compilados. La publicación y las
releases automatizadas forman parte del trabajo pendiente.

## Documentación adicional

- [Contrato de los manifiestos](./docs/template-manifests.md)
- [Contrato operativo común de FastAPI y NestJS](./templates/backend/backend-infrastructure-contract.md)
- [FastAPI](./templates/backend/fastapi-starter/README.md), [NestJS](./templates/backend/nestjs-starter/README.md) y [Fastify](./templates/backend/fastify-starter/README.md)
- [Next.js](./templates/frontend/nextjs-starter/README.md), [React Router](./templates/frontend/react-router-starter/README.md) y [Astro](./templates/frontend/astro-starter/README.md)

