# InnerSignal in Claude (connector, no plugin)

Claude uses InnerSignal as one custom MCP connector: the hosted private-case MCP. That connector carries both halves of the InnerSignal plugin:

- **Therapy.** `load_therapy_protocol` returns the therapy skill's instructions and its reference files, including the inner-child therapy map. `get_therapy_protocol_manifest` returns only the version and SHA-256 hashes. Both tools are public and read-only; the content is the public packaged skill.
- **Private continuity.** The ten read-only case tools (`load_handoff`, `load_case_context`, …) keep the existing OAuth, scopes and subject-to-case ACL.

The server's `initialize` instructions tell the host to call `load_therapy_protocol` before any inner-child, younger-self or self-relationship therapy response, and to say the protocol is unavailable rather than improvise it if the call fails.

## Why a connector instead of a Claude plugin

The Codex plugin bundles the map and rules inside its skill folder. A personal Claude account installs a custom plugin as an uploaded file, so every map or rule fix would need a rebuild and re-upload. Served over MCP, the protocol comes from the deployed build: a fix reaches Claude on the next conversation after the server is redeployed, with nothing to reinstall.

The packaged skill (`plugins/inner-signal-therapy/skills/inner-signal-therapy/`) stays the single source. `tests/protocol-provenance.test.mjs` keeps its map byte-identical to `docs/INNER-CHILD-THERAPY-MAP.md`, and `tests/therapy-protocol-mcp.test.mjs` checks that the served files are the packaged ones byte for byte. The MCP image copies the packaged skill (`Dockerfile.private-case-mcp`).

## Updating the map or rules

1. Change the canonical source and the packaged skill copy as the existing authoring and sync gates require, on a task branch with a pull request.
2. Merge, then redeploy the hosted MCP image through the normal release path, keeping the prior image for rollback.
3. Confirm the change is live: `GET /health` reports `therapyProtocol.version` and `therapyProtocol.protocolSha256`, and `get_therapy_protocol_manifest` returns the same hash.

The version comes from the plugin manifest; the hash changes with any content change, so it is the identity to record. `load_therapy_protocol` asks the host to record `version` and `protocol_sha256` with any continuity handoff.

## Connecting Claude (one-time)

Claude signs in with OAuth against the same Keycloak realm that ChatGPT uses.

1. **Keycloak client for Claude.** Create a confidential client for Claude with redirect URI `https://claude.ai/api/mcp/auth_callback`, the authorization-code grant with PKCE S256, refresh tokens allowed, the same identity provider as the ChatGPT client, an audience mapper for the MCP resource, and the optional scopes `case:read` and `case:audit`.
2. **Resource URL.** Claude requires the connector URL to equal the `resource` value that `/.well-known/oauth-protected-resource` returns (`INNER_SIGNAL_MCP_RESOURCE`) exactly. The server answers MCP at both `/mcp` and the root, so when the resource is the bare origin (as in the hosted deployment), use the origin itself as the Claude connector URL; ChatGPT can keep using `/mcp`.
3. **Claude.** Add a custom connector with that URL and enter the Claude client's ID and secret under Advanced settings. Hand the secret to the owner privately, never through Git or GitHub.
4. **Check.** In a new Claude conversation: the therapy tools answer without sign-in; the first private-case tool call returns HTTP 401 with a `WWW-Authenticate` `resource_metadata` challenge, and Claude should start sign-in. If Claude does not start sign-in from that tool-call challenge, the fallback is a Claude-only path that challenges at connection time, as AskRigor's `/mcp/claude` does; that needs a subject-level token check and its own audience.

Connecting the private case tools sends private case content to Anthropic as well as OpenAI. That is an owner-authorized provider boundary; do not connect a case whose owner has not authorized it.
