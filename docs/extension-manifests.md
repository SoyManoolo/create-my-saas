# Extension manifests

An extension is a separately versioned overlay that the Community CLI installs
only when selected with `--feature`. Community extensions ship below
`extensions/`; Pro extensions may be supplied later through an explicit local
extension directory. The CLI never downloads an extension or runs a command
declared by one.

Each extension has an `extension.manifest.json` validated against
[`extension-manifest.schema.json`](./extension-manifest.schema.json). Version 1
uses IDs such as `community:astro-billing` and `pro:api-keys`. An optional,
unique short alias such as `billing` preserves a friendly CLI interface.

The manifest declares the CLI version, supported complete stacks, template
targets, required and provided capabilities, extension dependencies, conflicts,
template and deployment environment variables, migration files and any public API prefixes. API prefixes
are incorporated into the generated gateway configuration; an extension with
new HTTP routes must declare them. Version constraints intentionally
support only an exact semantic version or a caret range (for example,
`^1.0.0`); this keeps the contract deterministic without accepting an
incomplete imitation of npm range syntax.

Overlays are copied after their base template. New files are allowed. Replacing
a Community file must be explicitly listed in the target's `replace` array;
two selected extensions may never write the same path. Environment variables
are merged into the generated `.env.example` instead of copying that file from
an overlay. Migration paths are declared so a release can be reviewed; the CLI
only copies them and never executes migrations.

## Runtime and deployment environment

`targets[].environment` belongs exclusively to the template named by that
target. A backend target writes to `backend/.env.example`. A frontend target may
only declare variables whose names start with `NEXT_PUBLIC_`; those values are
written to `frontend/.env.example` and are public at build time. Never use a
frontend target for a secret.

Use the root-level `deploymentEnvironment` array for variables consumed by the
production Compose deployment. The generator appends them to
`deployment/.env.production.example`, preserving the file's existing comments.
Each entry has `name`, `value`, `secret`, and `description`. A secret must use
an empty `value`, and is emitted empty so the deployer must provide it. Reusing
an identical variable across extensions writes it once; conflicting values are
rejected.

```json
{
  "deploymentEnvironment": [
    {
      "name": "STRIPE_WEBHOOK_SECRET",
      "value": "",
      "secret": true,
      "description": "Signing secret for Stripe webhook verification."
    },
    {
      "name": "DEPLOYMENT_REGION",
      "value": "eu-west-1",
      "secret": false,
      "description": "Region used by the release integration."
    }
  ]
}
```

This separation is intentional: deployment variables never appear in a
template `.env.example`, backend variables never move into the deployment
example, and frontend variables are permitted only under `NEXT_PUBLIC_`.

An extension that needs a package dependency supplies the compatible package
manifest and lockfile as explicit replacements in its target overlay. This is
deliberate: the CLI does not guess how to edit npm, pnpm, uv, or another
package-manager lockfile. The extension author owns and tests that compatible
dependency update for each declared stack.

Selected extensions are resolved in dependency order and recorded with their
canonical IDs and exact versions in `.create-my-saas.json`. A dependency is
explicit: selecting an extension does not silently select another one.
