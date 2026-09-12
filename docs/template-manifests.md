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
| `development` | Local port and base URL. Backends must provide it so the generator can configure a selected frontend without hard-coding framework names. |
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

## Browser-session frontends

A frontend that declares `auth.browser-sessions` must include an
`API_PROXY_TARGET` entry in `.env.example`. When it is generated together with a
backend, the CLI replaces that value with the backend's declared local URL. The
frontend must proxy browser requests under its own origin so `HttpOnly` refresh
cookies and the browser-readable CSRF cookie follow the shared authentication
contract.

Static-first frontends, such as Astro, should not claim
`auth.browser-sessions`. They can be generated independently and should only
add a backend integration when their own documented feature needs one.

## Compatibility

Dynamic frontends declare `compatibility.requiresBackendCapabilities`. The CLI
checks those values against the selected backend before writing a project and
explains any missing capabilities. This keeps a partially implemented backend
discoverable without generating a frontend whose visible routes cannot work.

The CLI may present all discovered manifests, but it must reject a requested
combination when its supported compatibility rules do not cover the selected
backend and frontend. Manifests advertise capabilities; they do not by
themselves promise API compatibility.
