# Creating extensions

Extensions are versioned, declarative overlays installed only when selected
with `--feature`. They can live in the package's `extensions/` directory or in
any local directory passed to the 1.0.0 CLI with `--extensions-dir`. The CLI
reads those directories recursively; it never downloads an extension or runs a
command declared by one.

```sh
create-my-saas app --backend fastapi --frontend nextjs \
  --extensions-dir ./my-extensions --feature acme:reports
```

`--extensions-dir` is repeatable. Extension IDs have the form
`namespace:name`, for example `acme:reports`; choose a namespace you control.
An optional unique short alias can make selection more convenient.

## Extension layout

Every extension directory contains an `extension.manifest.json` and any
overlay files it declares:

```text
my-extensions/
  reports/
    extension.manifest.json
    overlays/
      backend/
        src/reports.js
        migrations/001-reports.sql
```

The manifest must conform to
[`extension-manifest.schema.json`](./extension-manifest.schema.json). Its
`schemaVersion` is versioned independently from the extension's own `version`.
The current public manifest version is `1`.

```json
{
  "$schema": "https://create-my-saas.dev/schemas/extension-manifest-v1.json",
  "schemaVersion": 1,
  "id": "acme:reports",
  "version": "1.0.0",
  "displayName": "Reports",
  "description": "Adds report endpoints.",
  "provides": ["reports.api"],
  "requires": {
    "cli": "^1.0.0",
    "capabilities": ["auth.password"],
    "extensions": []
  },
  "supportedStacks": [
    { "backend": { "id": "backend:fastapi", "version": "^0.1.0" } }
  ],
  "targets": [
    {
      "template": "backend:fastapi",
      "overlay": "overlays/backend",
      "replace": [],
      "environment": [],
      "migrations": ["migrations/001-reports.sql"]
    }
  ]
}
```

## Compatibility contract

`requires.cli` accepts an exact semantic version or a caret range. Supported
stacks use the same version syntax for each backend or frontend template. The
generator rejects a selected extension before writing files unless one complete
stack matches, all required capabilities are available, and every required
extension was explicitly selected at a compatible version.

`provides` adds capabilities in dependency order. Use `conflictsWith` when two
extensions cannot coexist. The manifest can also declare `apiPrefixes` for new
HTTP route prefixes; the generator includes them in the generated gateway
configuration.

## Composable integration points

For FastAPI extensions, `integrations.fastapi` declaratively registers router
imports, environment-backed settings (with a minimum-length validation rule),
and allowlisted audit actions. The generator combines those entries into the
base integration registry, so extensions never need to replace `main.py`, the
settings module, or the audit service. `integrations.frontendRoutes` records
Next.js routes in `app/extensions.generated.ts`; the route components remain
ordinary overlay files and therefore compose by path.

```json
"integrations": {
  "fastapi": {
    "routers": ["src.modules.reports.router:router"],
    "settings": [{ "name": "REPORTS_TOKEN", "default": "", "minLength": 32 }],
    "auditActions": [{ "name": "reports.exported", "metadata": ["format"] }]
  },
  "frontendRoutes": ["/settings/reports"]
}
```

## Overlays and migrations

Overlays are copied after the selected base template. New files are allowed.
To replace a base-template file, list its relative path in `replace`; selected
extensions may not write the same path. Paths must remain inside the extension
directory and overlays cannot contain symbolic links.

List every migration relative to the overlay in `migrations`. The CLI copies
migration files but never executes them. An extension must provide the package
manifest and lockfile as explicit overlay replacements when it needs dependency
changes; the CLI never edits package-manager files heuristically.

## Environment variables

`targets[].environment` belongs to that target only: backend values are added
to `backend/.env.example`, and frontend values are added to
`frontend/.env.example`. Frontend variable names must start with
`NEXT_PUBLIC_` and cannot be secrets.

Use root-level `deploymentEnvironment` for values consumed by production
deployment. Those values are added only to `deployment/.env.production.example`.
Each environment item has `name`, `value`, `secret`, and `description`; a
secret must have an empty value. Identical declarations from multiple selected
extensions are emitted once, while conflicting declarations are rejected.

Validate bundled manifests with `pnpm run validate:extensions`, and test each
declared stack by generating a disposable project with the extension selected.
