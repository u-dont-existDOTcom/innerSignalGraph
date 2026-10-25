# Stable updater npm configuration hotfix — 25 October 2026

**Status: production installer blocked safely; code-only hotfix staged, not yet merged.**

After explicit owner release approval, the reading-first importer was merged to stable as `2e00caa643c608d599d07eeee10a0ad8b820b849`. The initial transactional install returned `FAILED_SAFE / candidate-dependencies / KEEP_CURRENT_RUNTIME`. The prior installed marker remained `110ee5342e27d8f1bd3d11cc2be4d85926c255b1`. No private journal contents were read or model calls made.

The installer passed the existing code and package gates but exposed a configuration defect on the owner's actual npm: both user and global npm config paths were set to `/dev/null`, so npm aborted before dependency resolution with a double-loading config error.

**Fix:** Keep the user config path `/dev/null`; direct the global config path to a separate nonexistent file under the disposable candidate HOME. This preserves the same credentials-excluded validation boundary and allows npm to parse configuration correctly. The updated regression executes the real npm config parser inside the credential-scrubbed environment, in addition to asserting immutable lockfile usage and two-phase clean staging.

**Evidence:** The original failed config was reproduced in a credential-free isolated npm invocation. Changing only the global path succeeded with fresh locked `npm ci --ignore-scripts --omit=dev` on the desktop. Previous importer stable package tests passed 307/307 on Node 24 and Node 26. The hotfix must receive its own exact-head checks and independent review before another installation attempt.

**Rollback and data:** A separate protected code-only rollback backup was created on the desktop; the initial private-byte preservation baseline covers 2,932 existing files. Private filenames, content and hashes were not uploaded. The owner’s deployment approval continues to apply to this same release; it does not authorize retrying previously refused journal content.
