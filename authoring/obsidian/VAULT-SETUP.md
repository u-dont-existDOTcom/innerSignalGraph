# Vault setup

Open `authoring/obsidian/` as an Obsidian vault. Obsidian is optional and is never required by CI or runtime.

- Enable the core Properties, Bases, and Canvas features if desired.
- Do not install a community plugin for this workflow.
- Local `.obsidian/` settings are ignored and must not be committed.
- Treat `current/` as immutable generated output.
- Use `proposals/` for reviewed edits.
- Use `scratch/` only for non-authoritative exploratory canvases.
- Keep private case material, transcripts, credentials, prompts, and model output outside this public vault.
- Treat every generated decision preview as review evidence only; approval lives in the existing Guide Packet decision artifact.

Every scratch Canvas must visibly contain:

`NON-AUTHORITATIVE SCRATCH CANVAS — NOT USED BY THE RUNTIME OR COMPILER`

The repository never reads scratch Canvas files.
