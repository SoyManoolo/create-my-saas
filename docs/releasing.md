# Publicar la CLI

Las releases de `@soymanolo/create-my-saas` se publican automáticamente desde
un tag Git. El workflow valida la versión, ejecuta las comprobaciones de la
CLI, inspecciona el contenido de npm, publica el paquete y crea la GitHub
Release con notas generadas a partir de los commits. La excepción es el tag de
arranque `v0.1.0`, detallado abajo.

## Configuración única antes de la primera publicación

1. Inicia sesión en npm con la cuenta u organización propietaria del scope
   `@soymanolo` y activa 2FA.
2. Crea el paquete público `@soymanolo/create-my-saas` mediante la primera
   publicación manual. npm exige que el paquete exista antes de configurar una
   relación de confianza. No uses el token de npm en el repositorio ni en
   GitHub Actions.
3. En npm, abre **Packages → @soymanolo/create-my-saas → Settings → Trusted
   Publisher** y registra GitHub Actions con estos valores:

   | Campo | Valor |
   | --- | --- |
   | Organización o usuario | `SoyManoolo` |
   | Repositorio | `create-my-saas` |
   | Workflow | `publish.yml` |
   | Environment | dejar vacío |
   | Acción permitida | `npm publish` |

   Esta relación usa credenciales OIDC de corta duración. El workflow necesita
   `id-token: write` para solicitarlas, pero no guarda credenciales de npm.

4. Verifica que el paquete sea público. El `publishConfig.access` del
   `package.json` ya lo establece así para las publicaciones con scope.

La primera vez es necesario que el paquete exista para poder configurar el
proveedor de confianza. Publica `0.1.0` manualmente desde un checkout limpio:

```sh
npm login
npm publish
```

No copies el token de npm a este repositorio, a secretos de GitHub ni a un chat.
Después de esa publicación inicial, configura el proveedor de confianza y crea
el tag `v0.1.0`. El workflow confirma que `0.1.0` ya existe en npm y crea la
GitHub Release sin volver a publicar. Desde `0.1.1`, las publicaciones serán
automáticas.

## Crear una release

1. Elige una nueva versión SemVer y actualiza `version` en `package.json`.
2. Ejecuta localmente las mismas comprobaciones:

   ```sh
   pnpm install --frozen-lockfile
   pnpm run validate:templates
   pnpm test
   npm pack --dry-run
   ```

3. Integra el cambio de versión en `main` y crea el tag anotado con esa misma
   versión:

   ```sh
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```

4. El workflow **Publish CLI** comprueba que `X.Y.Z` coincide exactamente con
   `package.json`. Si las verificaciones pasan, publica `@soymanolo/create-my-saas`
   con la etiqueta `latest` y crea la GitHub Release `vX.Y.Z`.

No reutilices ni muevas tags publicados: npm no permite reemplazar una versión
existente. Para corregir una release, publica una nueva versión SemVer.

## Verificación posterior

Comprueba la versión publicada e instala la CLI sin usar el checkout:

```sh
npm view @soymanolo/create-my-saas version
npx @soymanolo/create-my-saas@latest example-saas --backend nestjs --frontend nextjs
```

La publicación con Trusted Publishing genera automáticamente la procedencia
de npm cuando el repositorio y el paquete son públicos.
