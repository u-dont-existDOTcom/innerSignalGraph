# Current project state

The active governance change adds the exact agent map, Node 24.18.0 pin, documentation index, pull-request template, and hermetic `npm run verify` workflow.

Branch authority remains:

- `main` for development
- `stable` for installation and release
- `runtime-diagnostics` for generated status data only

Next: verify the pull request, merge to `main`, then promote the validated governance files to `stable` through the established release process.
