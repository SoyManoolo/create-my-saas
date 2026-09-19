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
| Backend | `fastapi` | API Python completa: sesiones de navegador, CSRF, usuarios, organizaciones, RBAC, audit log, recuperación/verificación, OAuth y billing. |
| Backend | `nestjs` | API TypeScript modular con el mismo contrato funcional que FastAPI. |
| Backend | `fastify` | API TypeScript ligera con PostgreSQL, sesiones, CSRF, recuperación, verificación de email y OAuth de Google/GitHub. No incluye todavía organizaciones ni Stripe Billing. |
| Frontend | `nextjs` | Dashboard con sesión de navegador, rutas protegidas y flujos de cuenta. |
| Frontend | `react-router` | Dashboard React con renderizado Framework Mode, rutas protegidas y proxy de API same-origin. |
| Frontend | `astro` | Sitio rápido de marketing, documentación y blog, con zona autenticada ligera compatible con los tres backends. La facturación por organización es opcional. |

Las capacidades de cada starter están declaradas en su
`template.manifest.json`. La CLI las compara antes de escribir archivos: los
dashboards que requieren organizaciones y Stripe Billing necesitan FastAPI o
NestJS. Fastify puede generarse solo o con Astro ligero, porque cubre el
contrato de sesión, recuperación, verificación y OAuth de esa área autenticada.
Para añadir billing a Astro se selecciona explícitamente `--feature billing`;
la CLI lo limita a FastAPI y NestJS.

## A dónde pretende llegar

El proyecto pretende ser la base para crear un SaaS mediante una decisión de
terminal, por ejemplo: elegir FastAPI, NestJS o un backend futuro; y elegir un
dashboard Next.js/React Router, un sitio Astro o un frontend futuro. Añadir una
opción debe consistir en crear una plantilla autosuficiente, declarar su
contrato de capacidades y ampliar las pruebas de compatibilidad, no en acoplar
los frameworks entre sí.

La base común buscada incluye autenticación segura para navegador, usuarios y
organizaciones, permisos, configuración de PostgreSQL y migraciones, límites de
peticiones, flujos de cuenta y una interfaz lista para empezar un producto.

## Requisitos para producción

Antes de poner un SaaS real en línea todavía hay que conectar las integraciones
del producto final. No es código ausente de los starters: son servicios y
credenciales que pertenecen a cada despliegue. Configura PostgreSQL, Redis con
TLS, la entrega transaccional de correo y las credenciales OAuth de los
proveedores que ofrezcas. Si vas a cobrar, configura también Stripe, los precios
permitidos y el endpoint de webhooks.

FastAPI, NestJS y Fastify exigen explícitamente los servicios de los que
dependen en `staging` y `production` y fallan de forma segura si faltan o no se
pueden usar. En particular, los límites de petición requieren Redis mediante
`rediss://` y los flujos de cuenta requieren una entrega de correo autenticada.
FastAPI y NestJS también dejan Checkout, Portal y webhooks de Stripe
deshabilitados hasta que se proporcione una configuración válida. Consulta el
README y el archivo `.env.example` del starter generado para los nombres de
variables y los callbacks registrados.

## Uso

Mientras el paquete no esté publicado, ejecútalo desde este checkout:

```sh
node packages/cli/bin/create-my-saas.js my-saas --backend nestjs --frontend nextjs
node packages/cli/bin/create-my-saas.js my-saas --backend nestjs --frontend astro --feature billing
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
npx saas-starter@latest my-saas --backend nestjs --frontend nextjs
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
| Sitio Astro con área privada ligera | `--backend nestjs --frontend astro`, `--backend fastapi --frontend astro` o `--backend fastify --frontend astro` |
| Sitio Astro con organizaciones y Stripe | `--backend nestjs --frontend astro --feature billing` o `--backend fastapi --frontend astro --feature billing` |
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

El E2E de navegador genera el proyecto y ejecuta el flujo completo contra una
instancia aislada de PostgreSQL y Redis. La matriz compatible es FastAPI y
NestJS con Next.js, React Router y Astro; Fastify con Astro; y Astro con
`billing` para FastAPI y NestJS. Selecciona una entrada de la matriz mediante
`E2E_BACKEND`, `E2E_FRONTEND` y, para la variante opcional, `E2E_FEATURES`:

```powershell
$env:E2E_BACKEND = 'nestjs'
$env:E2E_FRONTEND = 'astro'
$env:E2E_FEATURES = 'billing'
pnpm test:e2e:browser
```

Cada ejecución comprueba registro, recuperación y sesión. Cuando la
combinación expone sus proxies, también comprueba organizaciones, invitaciones,
permisos y el estado de billing sin Stripe. Astro sin la feature `billing` no
expone rutas de organizaciones ni facturación; Fastify + Astro cubre sólo los
flujos que declara ese backend.

La distribución de npm incluye la CLI, las plantillas y la documentación, y
excluye dependencias y compilados. Los tags `vX.Y.Z` publican la misma versión
en npm y crean su GitHub Release; `v0.1.0`, que arranca el paquete y la relación
de confianza, comprueba la publicación manual y crea solo la Release. Consulta
la [guía de releases](./docs/releasing.md).

## Documentación adicional

- [Contrato de los manifiestos](./docs/template-manifests.md)
- [Publicar una release de la CLI](./docs/releasing.md)
- [Despliegue reproducible](./docs/deployment.md)
- [Contrato operativo común de FastAPI, NestJS y Fastify](./templates/backend/backend-infrastructure-contract.md)
- [FastAPI](./templates/backend/fastapi-starter/README.md), [NestJS](./templates/backend/nestjs-starter/README.md) y [Fastify](./templates/backend/fastify-starter/README.md)
- [Next.js](./templates/frontend/nextjs-starter/README.md), [React Router](./templates/frontend/react-router-starter/README.md) y [Astro](./templates/frontend/astro-starter/README.md)

## Licencia

`create-my-saas`, su CLI y las plantillas incluidas se distribuyen bajo la
[licencia MIT](./LICENSE). Los proyectos generados pueden usarse, modificarse y
distribuirse, también como productos comerciales o propietarios, conservando el
aviso de copyright y la licencia en las partes procedentes de estas plantillas.
Las dependencias mantienen sus licencias respectivas.

