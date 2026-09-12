# React Router Framework SaaS starter

Frontend reutilizable para un SaaS dinámico, construido con React Router en Framework Mode y Vite. Incluye renderizado en servidor, rutas públicas y protegidas, sesión de navegador, recuperación de contraseña y verificación de email. Es compatible con los backends que implementen el contrato común del proyecto.

El access token sólo vive en memoria de la pestaña. El refresh token permanece en una cookie `HttpOnly`; la cookie CSRF no secreta se lee en el navegador para enviar `X-CSRF-Token` en las operaciones que cambian estado. Nunca se usa `localStorage` para tokens.

## Primer arranque

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

Abre [http://localhost:5173](http://localhost:5173). La ruta de servidor integrada reenvía `/auth/*` y `/users/*` a `API_PROXY_TARGET`, preservando las cookies en el mismo origen de navegador. En producción configura el mismo comportamiento en el reverse proxy y usa HTTPS con `COOKIE_SECURE=true`.

## Contrato API

La plantilla consume las rutas canónicas:

- `POST /auth/register` — `{ name, email, password }`
- `POST /auth/login` y `POST /auth/refresh` — `{ accessToken, user }`
- `POST /auth/logout` — con `X-CSRF-Token`
- `GET /users/me` — con `Authorization: Bearer <accessToken>`
- `POST /auth/password/reset/request`, `POST /auth/password/reset/confirm`, `POST /auth/email/verify`, `POST /auth/email/resend`

Tras cargar la aplicación se intenta `POST /auth/refresh`; si falla, las rutas protegidas redirigen al login. El proxy de `app/routes/api-proxy.ts` está limitado a las rutas de API declaradas y mantiene el valor de `API_PROXY_TARGET` exclusivamente en el servidor.

## Extenderla

El dashboard es deliberadamente neutral: añade las entidades, vistas y navegación de tu producto sin cambiar el núcleo de autenticación. Si añades capacidades al starter, actualiza `template.manifest.json` y valida todos los manifests desde la raíz:

```bash
node scripts/validate-template-manifests.mjs
```
