# Despliegue reproducible

Cada proyecto creado por la CLI incluye un directorio `deployment/`. Contiene
imágenes multi-stage para el backend y el frontend seleccionados, un gateway
TLS de mismo origen, `compose.yaml`, un override local con PostgreSQL y Redis,
y un ejemplo de variables de producción.

La receta de producción mantiene PostgreSQL y Redis fuera de Compose para que
se usen servicios gestionados y cifrados. Copia
`deployment/.env.production.example` a `deployment/.env`, reemplaza los
secretos y las URL de ejemplo, entrega el certificado TLS al gateway y ejecuta
el contenedor `migrate` como trabajo de release antes de arrancar la API.

La API conserva `/health` como liveness local y expone `/ready` como
readiness con timeout corto para PostgreSQL y Redis cuando el límite distribuido
está activo. Compose usa `/ready` como healthcheck y el gateway espera a que la
API esté healthy antes de enrutar tráfico.

Consulta el `deployment/README.md` generado para los comandos exactos y los
requisitos de proxy, copias de seguridad y restauración. La receta local de
`compose.dev.yaml` usa datos efímeros sin TLS y no debe usarse como producción.
