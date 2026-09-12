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

