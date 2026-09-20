# Changelog

Todos los cambios relevantes de `@soymanolo/create-my-saas` se documentan en
este archivo. El proyecto sigue [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Corregido el workflow de releases para validar correctamente la versión del
  tag antes de publicar futuras versiones.

## [1.0.0] - 2026-09-20

Primera versión estable pública de Community.

### Added

- CLI pública bajo el scope `@soymanolo/create-my-saas`, con catálogo de
  plantillas versionadas y generación atómica de proyectos.
- Starters para FastAPI, NestJS, Fastify, Next.js, React Router y Astro, con
  compatibilidad validada por capacidades.
- Autenticación, recuperación de cuenta, OAuth de Google y GitHub,
  organizaciones, roles, invitaciones, auditoría y Stripe Billing en los
  stacks que lo soportan.
- Rate limiting distribuido con Redis, comprobaciones de disponibilidad y
  contratos de seguridad para los backends.
- Host de extensiones Community y extensión opcional de facturación para
  Astro.
- Despliegue reproducible con Docker Compose, PostgreSQL, Redis, migraciones
  separadas y gateway TLS.
- Soporte para que las extensiones declaren secretos de despliegue y se
  incorporen a `deployment/.env.production.example`.

### Security

- Auditoría pública automatizada para detectar secretos, archivos generados,
  dependencias privadas y referencias internas antes de publicar.
- Endurecimiento de sesiones, límites de autenticación, gestión de OAuth y
  acciones sensibles de organizaciones.

### Changed

- El paquete se distribuye con el scope `@soymanolo` para asegurar identidad y
  propiedad en npm.
- La licencia de Community es MIT.

### Verification

- Validación de manifiestos y pruebas de generación para las combinaciones de
  plantillas y extensiones compatibles.

[Unreleased]: https://github.com/SoyManoolo/create-my-saas/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/SoyManoolo/create-my-saas/compare/v0.1.0...v1.0.0
