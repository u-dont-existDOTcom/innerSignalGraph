# Current project state

The governance branch now contains the exact agent map, Node 24.18.0 pin, documentation index, pull-request template, and hermetic `npm run verify` workflow.

Final-head workflow run `31757793394` passed the complete verifier and the post-verification clean-worktree check. The verifier now restores tracked generated fixtures after each run.

Branch authority remains:

- `main` for development
- `stable` for installation and release
- `runtime-diagnostics` for generated status data only

Next: merge the verified pull request to `main`, then promote the governance files to `stable` through the established release process before protecting both authority branches where the GitHub plan permits.
