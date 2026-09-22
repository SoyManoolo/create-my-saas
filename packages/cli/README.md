# create-my-saas CLI

Generates a project by discovering the individual `template.manifest.json` files
in the `templates` directory.

Extensions are versioned overlays with their own manifests. Select one with
repeatable `--feature <id>` flags; the generator validates the complete stack
before writing files. Discover extensions stored outside the package with a
repeatable `--extensions-dir <path>` flag. The CLI only reads the directories
you provide; it never downloads extensions or executes commands from them.

From this repository, run:

```sh
node packages/cli/bin/create-my-saas.js my-saas --backend nestjs --frontend nextjs
```

Use `--list` to inspect available templates. Select either side independently:

```sh
node packages/cli/bin/create-my-saas.js api-only --backend fastapi
```

The command refuses to use an existing destination directory and writes
`.create-my-saas.json` with the selected template IDs and versions. Local build
and dependency artifacts are deliberately excluded from generated projects.
