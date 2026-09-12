# Template manifests

Each starter has a `template.manifest.json` at its root. The future
`create-my-saas` CLI discovers templates by finding those files below
`templates/`; it must not infer support from a directory name or from a
framework-specific package file.

The manifest is deliberately small and uses JSON only, so it can be consumed
without installing a template's dependencies. Version 1 is described by
[`template-manifest.schema.json`](./template-manifest.schema.json) and is
checked by `node scripts/validate-template-manifests.mjs`.

## Contract

Required fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Manifest format version. The current version is `1`. |
| `id` | Stable identifier in the form `<kind>:<slug>`, for example `backend:fastapi`. Do not derive it from a path. |
| `version` | Semantic version of the template's generated-project contract. |
| `kind` | Either `backend` or `frontend`; it must match the prefix of `id`. |
| `displayName`, `description` | Human-readable labels for the CLI's selection UI. |
| `runtime` | Language, package manager, and optionally a runtime version requirement. |
| `capabilities` | Unique, dot-separated feature identifiers exposed by the template. |
| `environment.required` | Values the generated application must explicitly configure. `secret` tells the CLI never to print or commit the value. |

Capabilities describe implemented application behavior, not planned work or a
specific third-party provider. A template that only contains a billing domain
model, for example, declares `billing.subscription-domain`; it must not claim
`billing.stripe` until a usable Stripe integration is included.

## Adding a template

1. Add the starter below `templates/backend/` or `templates/frontend/`.
2. Create `template.manifest.json` at the template root, set an immutable ID,
   and choose the matching `kind`.
3. List only capabilities that are implemented and verified in that starter.
   Reuse an existing capability name when it means the same thing.
4. Declare every generated-project setting that has no safe production default
   in `environment.required`. Do not put values or credentials in the manifest.
5. Run `node scripts/validate-template-manifests.mjs` and add generator matrix
   coverage once the CLI supports the new template.

The CLI may present all discovered manifests, but it must reject a requested
combination when its supported compatibility rules do not cover the selected
backend and frontend. Manifests advertise capabilities; they do not by
themselves promise API compatibility.
