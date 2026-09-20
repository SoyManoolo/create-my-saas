# Public repository boundary

This repository contains only the Community edition of create-my-saas. It is
MIT-licensed and self-contained: every dependency required by the CLI and its
starter templates must be obtainable from public package indexes.

Commercial extensions are developed and distributed separately. Their source,
overlays, license enforcement, credentials, package sources, release
configuration, infrastructure details, and implementation plans do not belong
in this repository or in the published npm package.

Before publishing, run `npm run audit:public`. The check examines tracked
files and every reachable Git revision for secrets, private references,
non-public dependency sources, and generated or local-only files. It is also
required by the verification workflow.

Community extension manifests and overlays must identify themselves with the
`community:` namespace and remain independently installable from this public
repository.
