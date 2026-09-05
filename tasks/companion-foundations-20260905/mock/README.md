# Companion foundations: fictional-data interface

This is a standalone design prototype, not a live therapist, model integration, memory system, or installed InnerSignal feature. It is scoped to the owner's instruction to continue with the synthetic, non-persistent interface described in the companion-foundations checkpoint.

## Use

Build with the repository's supported Node 24 runtime:

```bash
node tasks/companion-foundations-20260905/mock/build.mjs /tmp/InnerSignal-companion-preview.html
```

The output is a single HTML file with its own styles and script. Open it in a browser; no server, package installation or network connection is needed by the page. The builder refuses to overwrite an existing output. The prepared downloadable HTML is a generated artifact, not another source of product-policy authority.

The interface demonstrates separate inner-child/spiritual invitation preferences; reflection consent; five fictional histories; source-linked tentative readings; disagreement, withdrawal and explicit fictional reset; optional self-guidance versus concrete help; and unconditional exit with cleared session state.

One history includes greater control alongside lost connection and enjoyment. Another credits learning through friends without therapy. Missing-history and repeated-event examples must abstain. A source withdrawal invalidates the entire prewritten comparison, including when the removed source was complicating evidence. A rejected reading stays rejected across example switching until an explicit builder-only reset.

The invitation buttons only demonstrate permission results; they do not start therapy. An unprompted check-in is manually simulated to inspect the preference rule, never scheduled. No free-text intake is provided. Do not enter real personal data through developer tools or adapt this prototype for real histories without the separately reviewed privacy boundary.

## Architecture and limitations

`model.mjs` contains frozen fictional fixtures and pure state transitions using the existing `../policy.mjs`. `view.mjs` renders text with DOM textContent, not dynamic HTML. `build.mjs` performs a narrow deterministic build and hashes both inline script and style into the page's Content Security Policy. No runtime imports, fetches, telemetry, cookies or persistent storage APIs are used.

Reflections and supportive replies are prewritten, explicitly labeled examples. The metadata is hand-authored. These checks do not demonstrate that a model can extract reliable evidence, avoid sycophancy, detect deterioration, conduct therapy, or honor real-data deletion. `safetyClear: true` belongs solely to the fictional fixture; it is not a clinical safety assessment or a production default.

All user interactions are page-memory only. Ending the preview clears active state and rendered content, but the fictional examples remain in the source file. Reloading starts fresh. This is not a guarantee of secure erasure of real information. There is no connection to the application, vault, provider, graph packet, plugin, clinician care or stable release.

## Tests

```bash
node --test tasks/companion-foundations-20260905/mock/model.test.mjs
```

Optional browser test requires an already installed Python Playwright and Chromium:

```bash
python tasks/companion-foundations-20260905/mock/browser-smoke.py /tmp/InnerSignal-companion-preview.html --browser /usr/bin/chromium --out /tmp/innersignal-browser-check
```

The browser harness injects the exact generated HTML with `set_content`. It checks interactions, invalidation, focus, mobile overflow, absence of network requests and JavaScript/CSP errors. It does not test file-scheme navigation, which is blocked by administrator policy in the development environment. No browser policies were changed.

Actual results and exact source identities are in `verification.json`. The local environment was Node 22.16.0, not the repository-required Node 24. Full-repository and hosted checks must be assessed independently. The original 16 model behavior cases remain unevaluated.
