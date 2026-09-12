# Contrato de infraestructura: FastAPI y Nest

Los dos starters comparten este contrato operativo. La implementación interna puede
usar SQLAlchemy/asyncpg o TypeORM/pg, pero cambiar uno de estos puntos exige cambiar
ambos starters y sus ejemplos de entorno.

| Área | Contrato |
| --- | --- |
| Entorno | `APP_ENV` es `development`, `test`, `staging` o `production`. `NODE_ENV` se acepta temporalmente como alias. |
| PostgreSQL | `DATABASE_URL` debe apuntar a PostgreSQL; FastAPI usa `postgresql+asyncpg://` en ejecución y Alembic traduce sólo para DDL síncrono. Nest usa `postgresql://`. `synchronize` permanece desactivado. |
| TLS de PostgreSQL | `DATABASE_SSL=true` en staging/production; los dos drivers verifican el certificado. |
| Migraciones | Una base nueva se crea únicamente con las migraciones: `alembic upgrade head` y `pnpm migration:run`. Nunca se depende de `create_all` ni de `synchronize` en despliegue. |
| Límite distribuido | `RATE_LIMIT_ENABLED`, `RATE_LIMIT_REQUESTS`, `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_PREFIX` y `REDIS_URL` son compartidos. En staging/production Redis debe ser `rediss://`; si no está disponible, se responde con 503, no se degrada a memoria local. |
| Identidad de cliente | Por defecto la IP es la del socket. `TRUST_PROXY_HEADERS=false` evita confiar en `X-Forwarded-*`. Sólo al activar esa opción se aceptan cabeceras de las IPs explícitas de `TRUSTED_PROXY_IPS`; `*` no es válido. El proxy debe eliminar cabeceras de entrada y reconstruirlas. |
| Resultado del límite | Las peticiones que exceden el límite devuelven `429` y `Retry-After`; cuando el almacén distribuido no está disponible en un entorno protegido devuelven `503` con el código `RATE_LIMIT_UNAVAILABLE`. |

## Verificación desde una base vacía

Usa una base desechable, sin tablas ni `alembic_version`/`migrations` previos. No
apuntes estos comandos a una base compartida:

```powershell
# FastAPI (la URL de ejecución conserva asyncpg)
$env:DATABASE_URL = 'postgresql+asyncpg://postgres:postgres@localhost:5432/fastapi_empty_check'
uv run alembic upgrade head

# Nest
$env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/nest_empty_check'
pnpm migration:run
```

Después, vuelve a ejecutar el mismo comando: debe terminar sin aplicar cambios. La
comprobación de esquema debe comparar entidades con tablas y restricciones, no sólo el
historial de migraciones. En CI provisiona PostgreSQL y Redis reales para esta prueba;
los motores en memoria no validan DDL ni TLS de PostgreSQL.
