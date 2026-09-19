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
environment variables, migration files and any public API prefixes. API prefixes
are incorporated into the generated gateway configuration; an extension with
new HTTP routes must declare them. Version constraints intentionally
support only an exact semantic version or a caret range (for example,
`^0.1.0`); this keeps the contract deterministic without accepting an
incomplete imitation of npm range syntax.

Overlays are copied after their base template. New files are allowed. Replacing
a Community file must be explicitly listed in the target's `replace` array;
two selected extensions may never write the same path. Environment variables
are merged into the generated `.env.example` instead of copying that file from
an overlay. Migration paths are declared so a release can be reviewed; the CLI
only copies them and never executes migrations.

An extension that needs a package dependency supplies the compatible package
manifest and lockfile as explicit replacements in its target overlay. This is
deliberate: the CLI does not guess how to edit npm, pnpm, uv, or another
package-manager lockfile. The extension author owns and tests that compatible
dependency update for each declared stack.

Selected extensions are resolved in dependency order and recorded with their
canonical IDs and exact versions in `.create-my-saas.json`. A dependency is
explicit: selecting an extension does not silently select another one.
