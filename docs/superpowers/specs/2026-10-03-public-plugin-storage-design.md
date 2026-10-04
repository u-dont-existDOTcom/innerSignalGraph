# Public plugin storage

Date: 2026-10-03
Status: PROPOSED DESIGN for a direction the owner approved on 2026-10-03 (quoted below). Nothing here is implemented, deployed, or connected to real data. It grants no deployment, installation, release, `stable`, therapy-policy or product-policy authority. The owner answered every storage question on 2026-10-04 (below), including where the records are kept, after the hosting vendors' data-processing terms were read.
Classification: public design; contains no private data.

## In plain words

Today the InnerSignal plugin in ChatGPT and Claude can only read. Nothing a person says in those chats is saved by InnerSignal. The private data InnerSignal holds today sits in its existing encrypted case store: owner-authorized cases and the journal import, one encrypted file per case, written by the local app or by a one-shot backend job and read by the hosted connector. GitHub holds code, design documents, invented test data and content-free status records. It has never held private data, so writes do not "go into GitHub" today; for the plugin they go nowhere.

This design adds:

- InnerSignal accounts that anyone can create, through the sign-in service the connector already uses (Keycloak);
- a database on InnerSignal's server that keeps each person's saved conversations, journal entries, settings and handoffs, encrypted with keys that belong to that one person;
- plugin tools that save, list, read and delete those records;
- a consent step at sign-up, an account page for export and deletion, retention rules, and a legal-review checklist that has to be completed before anyone other than the owner uses it.

One finding changes how the approved plan can launch. OpenAI's current rules for listed ChatGPT apps say the server "must not pull, reconstruct, or infer the full chat log", and Anthropic's directory policy says a connector "must not collect extraneous conversation data" and "must not query or extract data from Claude's memory, chat history, conversation summaries, or user-generated or uploaded files". Saving every turn automatically is that kind of collection, so a listed plugin that does it is likely to be rejected. The storage is the same either way; what changes is when the plugin sends turns. Owner question 1 asks how to handle this.

## Owner decision (2026-10-03)

The owner's words: "ok i approve the storage recommendation".

What he approved: the public plugin saves everything on InnerSignal's server for every user: past conversations (every turn), journal entries, settings and handoffs, so people can see all their past conversations the way apps like this normally work. It comes with write tools for the plugin, encryption per user, the user's consent, and a legal review before launch.

Background, in his words: ChatGPT reported it "can't write anything via the innersignal plugin"; "how are we writing things now, just into github right, so we need to fix it so it works for a public plugin, we need to write everything, the turns the journal, the settings, i think this is mostly already mapped out but wasn't implemented for the public?" He first considered storing data locally in each user's ChatGPT, then chose server storage for everyone.

**What this supersedes.** The 2026-09-26 design `2026-09-26-care-channels-supervision-and-learning-governance.md` recorded owner requirement 8, "Free users store locally", its "Local storage for free users" section, and the channel-table row saying the server keeps nothing for free users by default. This decision replaces those three parts. The rest of that design stands, including its consent rules for sharing with supervisors, the separate escalation packages, and their 30-day-after-review retention. A person's own saved records are never shown to a supervisor without the consent that design requires.

## Owner decisions (2026-10-04)

The owner answered at 01:55 UTC, and answered question 2 again at 05:39 UTC after the vendors' terms were read. Question numbers are this design's; his owner page numbered them 3 to 8, with question 2 as page question 4.

1. **Saving inside ChatGPT and Claude: B.** His words: "B sounds fine just remind people on each turn 'tell me save to save this turn, only the web app can auto-save' (and link to the web app) that's fine a little friction for free users is ok." Saves in the plugin follow the person's request; the web app saves every turn. The reminder: OpenAI's plugin guidelines say "Do not insert unrelated content, attempt to redirect the interaction, or collect data beyond what is reasonably necessary", and Anthropic's directory policy says "When possible, users should be given options to exclude unnecessary text in the response." Neither forbids a reminder about the app's own saving. So the reminder goes in every reply, as he asked, with the link to the web app and no prices or upgrade wording; because of Anthropic's rule, a person can switch it off. A directory reviewer could still call a link in every reply redirecting, so before the listing submissions (phase 4) the agent puts that risk to the owner, with a fallback of the first reply of each conversation plus right after a save. The fallback is not used unless he chooses it. Since no letter to the platforms is planned under B, the age question below needs its own letter to OpenAI.
2. **Where the records are kept: A.** His first answer: "not sure, i guess A. you didn't explain why you don't rec C. check the data-processing terms tho." The terms were read (see "Hosting vendors' data-processing terms") and the question was put again with A recommended; he answered "4a" at 05:39 UTC. So: build and test on Railway with invented data only. Before any real person's records go in, ask Railway in writing to add health data and EU-only processing, logs included, to its DPA; an agent drafts the letter and the owner sends it from the Railway account. If Railway declines, the records move to Supabase in Frankfurt; the code is the same Postgres either way. Because the connector also handles decrypted records on Railway, a refusal also brings the owner the choice of where the connector runs (see the phase 1 gate). The privacy consultant checks the result.
3. **Retention: B.** Until deleted, or 24 months after the last sign-in, with warnings at 23 months and 30 days before.
4. **Legal review: C.** A privacy consultant first (impact assessment, policies, records), with a lawyer reviewing only the consent text and the privacy policy.
5. **Legal entity:** "Mayan Roots, LLC. that's my LLC in USA. or if it would create less legal burden can be me in Senegal idk." So Mayan Roots, LLC is the controller unless the consultant finds the owner as an individual in Senegal simpler; the consultant gets that question.
6. **Minimum age: A,** 18 and over. OpenAI requires listed apps to be "suitable for general audiences, including users aged 13–17", so OpenAI's view is needed before submission.

## Goals

1. Every signed-in person can save their InnerSignal conversations, journal entries, settings and handoffs on InnerSignal's server from ChatGPT, Claude and the future web app, and find them again in any later chat or on an account page.
2. Each person's records are encrypted under that person's own key, separately from everyone else's, and one record can be deleted without touching the others.
3. Nothing is saved without the person's recorded, explicit consent, and withdrawing it is as easy as giving it.
4. People can export everything and delete anything, including their whole account.
5. The design meets the published rules of both plugin platforms and is ready for a legal review before any non-owner data is stored.
6. Existing private cases move into the new store without loss, each to the account of the person it belongs to.

## Non-goals

- No change to therapy behavior, the therapy map, graphs, guides, or the served protocol content. Where storage touches therapy text (the plugin skill's sentences about read-only continuity), the change follows the existing authoring gates and owner approval.
- No supervisor queue, spot checks or lesson ladder. Those stay in the 2026-09-26 design and get their own phases.
- No end-to-end encryption. The host model has to read the text, and InnerSignal's server returns it to the host, so the server holds the keys (see "What the encryption protects").
- No payments, no admin console beyond what deletion, export and consent need.
- No move away from Keycloak, Node 24, PostgreSQL as the relational default, or Railway as the default host without an owner decision (2026-09-19 stack decision).
- Not legal advice. The legal section lists what a qualified reviewer must decide.

## Current state

### Where things are stored today

| What | Where | Written by | Read by |
|---|---|---|---|
| Code, schemas, invented fixtures, design documents | GitHub repository | developers, through pull requests | anyone |
| Content-free failure and progress records | GitHub `runtime-diagnostics` branch | the local launcher | owner and developers |
| Owner-authorized private cases: transcript turns, state, journal entries, tracker entries, candidate replies, source artifacts | One AES-256-GCM encrypted file per case under a private directory: on the owner's computer for the local app, and a copy mounted read-only into the hosted connector (`docs/PRIVATE-CASE-CONTINUITY.md`) | the local app's private turn controller (`/v1/therapy/respond`); the one-shot operator (`npm run private-case:operations`) | the hosted connector's read-only tools; the local app |
| Immutable handoffs | Separate encrypted files beside the case, plus private locator files (`src/storage/private-case-handoff.mjs`, `src/storage/private-artifact-locator.mjs`) | the operator and the local app | `load_handoff` and the other read tools |
| Imported journal corpus | Encrypted objects under the vault's `.journal-corpora/` (`src/storage/private-journal-corpus.mjs`) | the journal import runtime, published through the operator | the journal read tools |
| Journal import work items and answers | Encrypted exchange files on the import host (`src/journal-import/work-exchange.mjs`) | the runtime (items); `submit_journal_work_result` (answers) | the runtime |
| What a person says in ChatGPT or Claude | Only in OpenAI's or Anthropic's own storage, under their policies | — | — |

### What the connector exposes today

`src/server/private-case-mcp.mjs` (started by `npm run private-case:mcp:hosted`) serves:

- 2 public read-only protocol tools that need no sign-in: `get_therapy_protocol_manifest`, `load_therapy_protocol`;
- 10 read-only case tools, all annotated `readOnlyHint: true`: `load_handoff`, `load_case_context`, `get_state_diff`, `get_recent_verbatim`, `retrieve_case_evidence`, `get_pending_candidate`, `get_tracker_window`, `get_journal_entries`, `get_candidate_response`, `get_source_artifact`. They need `case:read`, and five of them also `case:audit`;
- optionally, 4 read-only journal tools (`search_journal_graph`, `get_journal_subgraph`, `resolve_journal_evidence`, `get_journal_timeline`);
- optionally, 2 journal work tools for the import pipeline: `get_journal_work_packet` and `submit_journal_work_result`. The second is the only write tool. Its scope `journal:submit` "opens no case store and grants no other write" (`src/storage/private-case-access.mjs`), and it accepts only schema-checked answers to work items the import runtime published, for one configured case.

### Why ChatGPT can't write

1. **No tool saves a person's own words.** The one write tool accepts import answers only.
2. **No write scope reaches the connector.** The hosted loader advertises `case:read` and `case:audit` only (`loadHostedPrivateCaseProvidersFromEnvironment` in `src/storage/hosted-private-case-providers.mjs`). `case:write` exists only for the operator, which "is not an MCP server, has no listening port, registers no tools" (`docs/PRIVATE-CASE-OPERATOR.md`).
3. **The vault is mounted read-only** into the connector (`docs/PRIVATE-CASE-CONTINUITY.md`, hosted evidence item 3; `2026-09-27-journal-work-exchange.md`, deployment step 3).
4. **Accounts and keys are a hand-edited list.** `INNER_SIGNAL_CASE_ACL_JSON` maps sign-in subjects to case IDs and `INNER_SIGNAL_CASE_KEYS_JSON` holds each case's keys; both are read once at startup. A new ChatGPT user has no case, no grant and no key, so even the read tools refuse them. The 2026-09-26 design: "Onboarding a client is a manual settings change plus a brief restart of the private server."
5. **The store suits one writer.** "Only one writer changes a vault at a time" (`docs/PRIVATE-CASE-OPERATOR.md`); the coordinator is an in-process lock (`src/storage/shared-case-coordinator.mjs`), and the journal design notes "the current in-process Map is not a multi-process or distributed lock". Each case is one encrypted file rewritten in full on every change (`src/storage/private-case-store.mjs`), so each saved turn would rewrite a person's whole history.
6. **It was designed that way.** Private Continuity was built read-only for auditors (`2026-09-10-private-case-mutation-orchestration.md`), and the 2026-09-26 design kept free users' data off the server.

### Already mapped out, not built

- **Journal API and deletion lifecycle** (`2026-09-19-high-retention-journal-import.md`, sections 9 and 10): import jobs, search, corrections, visibility, deletions and export, described as "new proposals, not existing deployed endpoints"; deletion through tombstones and visibility epochs, removal of derived data, a backup purge schedule, per-object keys, and the rule that "cryptographically erased" is not claimed while a recovery wrap or backup can still decrypt.
- **Three separate permissions** for journals: archive, organize/search, and use in future sessions (same document, section 3).
- **Accounts later in PostgreSQL, sign-in kept in Keycloak**, with "No password resets" because access is keyed by Keycloak account IDs (`2026-09-26-care-channels-supervision-and-learning-governance.md`).
- **Recording the protocol version and hash** in every session and handoff InnerSignal keeps (same document, phase 1).
- **Personal-learning items as validated fixed fields**, never free-text rules (same document).
- **PostgreSQL as the multi-user default, Railway as the host**, sensitive logic kept server-side (`2026-09-19-web-app-stack-direction.md`).
- **The locator mapping in an authenticated private database** in production (`docs/PRIVATE-CASE-CONTINUITY.md`).
- **Deletion with its own authority and lifecycle**: "Deletion is intentionally absent from this operator surface" (`docs/PRIVATE-CASE-OPERATOR.md`).

None of the public pieces exist: self-service sign-up, a case per person, per-person keys, write tools for a person's own records, deletion, export, or consent records.

## Platform and legal facts this design depends on

All sources were read on 2026-10-03; links are listed under "Sources". Quotes are exact. Text marked *secondary* comes from a law firm or listing site rather than the rule-maker.

### OpenAI (ChatGPT apps and plugins on MCP)

- **Write tools are allowed and must be labeled.** Plugin guidelines: `readOnlyHint` "Use `false` for external-state changes, persisting artifacts, starting stateful jobs"; `destructiveHint` "Use `true` for potentially destructive or irreversible effects, such as deletion, overwriting, cancellation" and "Use `false` only for additive writes without destructive or irreversible effects"; `openWorldHint` "A tool confined to a bounded private account...may use `false`". App submission guidelines: "Incorrect or missing action labels are a common cause of rejection."
- **Confirmation.** Developer-mode guide: "Write actions by default require confirmation", and users can "choose to remember the approve or deny choice for a given tool for a conversation". Help article on apps (updated about 2026-10-01): "ChatGPT may ask for approval before reading information or completing an action. Review the request before approving it." Permission options "may include" "Always ask", "Allow read actions", "Allow low-risk actions" and "Allow all actions", for an eligible app or account; "Sensitive actions may require approval or be denied." Whether an additive save counts as low-risk is not documented.
- **Chat-log rule.** Plugin guidelines, "Minimal and purpose-driven inputs": "Do not request the full conversation history, raw chat transcripts, or broad contextual fields 'just in case.'" "Tool data handling": "Your MCP server must not pull, reconstruct, or infer the full chat log from the client or elsewhere. Operate only on the explicit snippets and resources the client or model chooses to send." The app submission guidelines carry both rules in nearly the same words ("Your app must not pull, reconstruct, or infer the full chat log from the client or elsewhere.").
- **Restricted and sensitive data.** "Do not collect, solicit, or process the following categories of Restricted Data", including "Protected health information (PHI)". "Do not collect personal data considered 'sensitive' or 'special category' in the jurisdiction in which the data is collected unless collection is strictly necessary to perform the plugin's stated function".
- **Listing requirements.** A published privacy policy covering "the categories of personal data collected, the purposes of use, the categories of recipients, data retention timelines, and any controls offered"; "a login and password for a fully featured demo account that includes sample data"; extra login steps are rejected; "All plugin submissions must come from verified individuals or organizations"; a support contact; "Plugins must be suitable for general audiences, including users aged 13–17" and "may not explicitly target children under 13".
- **Unlisted use.** The developer-mode guide says it is "Available to Pro, Plus, Business, Enterprise, and Education accounts on the web." The help article on custom apps describes workspace publishing for Business, Enterprise and Edu, and says the builder is "responsible for verifying the MCP server and app are safe and appropriate for your organization before publishing".
- **OAuth.** The authentication guide requires the authorization server to publish `code_challenge_methods_supported` with `S256`, a protected-resource metadata endpoint, and a `WWW-Authenticate` challenge on 401. It calls Client ID Metadata Documents (CIMD) "the preferred client registration method", supports Dynamic Client Registration (DCR) and pre-registered clients, and says ChatGPT appends `resource=` to authorization and token requests, which the authorization server should copy into the access token (commonly the `aud` claim). Redirect URIs: `https://chatgpt.com/connector/oauth/{callback_id}` and `https://chatgpt.com/connector_platform_oauth_redirect`.

### Anthropic (Claude connectors)

- **Annotations and permissions.** Review criteria: "Every tool must include a `title` and the applicable hint: `readOnlyHint: true` for read-only tools, and `destructiveHint: true` for tools that modify or delete data. These determine auto-permissions in Claude. Read-only tools can run without per-call confirmation, and destructive tools always prompt." The default for a write tool that is neither read-only nor destructive is not documented. Team and Enterprise owners can set "Always allow", "Needs approval" or "Blocked".
- **Conversation data.** Software Directory Policy (dated April 15, 2026), section 1.D: "Software must only collect data from the user's context that is necessary to perform their function. Software must not collect extraneous conversation data, even for logging purposes." Section 1.F: "Software must not query or extract data from Claude's memory, chat history, conversation summaries, or user-generated or uploaded files." The review criteria also reject tool descriptions that "Instruct Claude to call external software or tools the user didn't request".
- **Submission.** The portal asks "whether the connector handles personal health data" and requires acknowledgments that include "conversation data collection", a privacy policy URL, and test credentials "for a fully populated account".
- **OAuth.** Supported out of the box: OAuth with DCR and OAuth with CIMD; Anthropic-held client credentials by arrangement. Claude picks CIMD only when the authorization server advertises `"client_id_metadata_document_supported": true` and `"none"` in `token_endpoint_auth_methods_supported`. For high-traffic directory servers, "prefer CIMD or `oauth_anthropic_creds` over DCR" because "DCR causes Claude to register a new client on every fresh connection". Callback `https://claude.ai/api/mcp/auth_callback`; PKCE S256 on every request; refresh tokens rotated for public clients; 10-second limit on discovery, registration and token endpoints.
- **Plans.** One support article says custom connectors are available "for users on free, Pro, Max, Team, and Enterprise plans", with Free "limited to one custom connector"; another lists only paid plans. The sources disagree.

### MCP authorization specification

The specification's "latest" page links to the version dated 2026-07-28; this design also read the 2025-11-25 version. The connector today declares protocol version `2025-06-18`.

- MCP servers "MUST implement OAuth 2.0 Protected Resource Metadata (RFC9728)".
- Authorization servers and clients "SHOULD support OAuth Client ID Metadata Documents". In 2026-07-28, Dynamic Client Registration "is deprecated and retained for backwards compatibility".
- Clients "MUST" send the `resource` parameter (RFC 8707); servers "MUST validate that access tokens were issued specifically for them as the intended audience" and "MUST NOT accept or transit any other tokens".
- Clients "MUST implement PKCE" with `S256`; "For public clients, authorization servers MUST rotate refresh tokens".
- Missing scopes: the server "SHOULD respond with" `HTTP 403 Forbidden` and `error="insufficient_scope"`.
- 2026-07-28 adds issuer identification (RFC 9207): authorization servers "SHOULD include the `iss` parameter in authorization responses".

**Keycloak.** Keycloak's MCP guide lists full support for the 2025-03-26 authorization spec and experimental support for 2025-06-18, 2025-11-25 and 2026-07-28; CIMD "is an experimental feature" enabled with `--features=cimd`; resource indicators are experimental. DCR is supported.

### Data protection

**EU GDPR** (text as adopted):

- Applies to a controller outside the EU when processing relates to "the offering of goods or services" to people in the EU (Art. 3(2)).
- "Data concerning health" means "personal data related to the physical or mental health of a natural person, including the provision of health care services, which reveal information about his or her health status" (Art. 4(15)). Processing it "shall be prohibited" (Art. 9(1)) unless an exception applies, such as "explicit consent ... for one or more specified purposes" (Art. 9(2)(a)).
- The controller "shall be able to demonstrate that the data subject has consented"; withdrawal is possible "at any time" and "shall be as easy to withdraw as to give consent" (Art. 7(1), 7(3)).
- Children: processing on consent is lawful "where the child is at least 16 years old"; Member States may set a lower age "not below 13 years" (Art. 8(1)).
- Requests: answered "without undue delay and in any event within one month" (Art. 12(3)); erasure "without undue delay", including when consent is withdrawn (Art. 17(1)); portability "in a structured, commonly used and machine-readable format" (Art. 20(1)).
- A controller outside the EU "shall designate in writing a representative in the Union" (Art. 27(1)); the exemption excludes processing that includes, "on a large scale, processing of special categories of data" (Art. 27(2)(a)).
- Only processors "providing sufficient guarantees" (Art. 28(1)).
- Breach notice to the supervisory authority "not later than 72 hours after having become aware of it", unless unlikely to result in a risk (Art. 33(1)).
- An impact assessment is required "prior to the processing" when high risk is likely, including "processing on a large scale of special categories of data" (Art. 35(1), 35(3)(b)).
- Transfers to the US: the General Court upheld the EU-US Data Privacy Framework on 3 September 2025 (*secondary*, IAPP), and an appeal (C-703/25 P) was filed on 31 October 2025 (*secondary*, Digital Policy Alert).

**UK GDPR** has the same Article 9 wording with "domestic law", amended by the Data (Use and Access) Act 2025. A controller outside the UK designates "a representative in the United Kingdom" (Art. 27(1)). The ICO: "you must identify both a lawful basis under Article 6 and a condition for processing special category data under Article 9", and "You must do a data protection impact assessment (DPIA) for any type of processing which is likely to be high risk."

**Washington, My Health My Data Act** (RCW 19.373):

- "Consumer health data" is "personal information that is linked or reasonably linkable to a consumer and that identifies the consumer's past, present, or future physical or mental health status".
- A "regulated entity" includes one that "produces or provides products or services that are targeted to consumers in Washington". A "small business" includes one that handles data of "fewer than 100,000 consumers during a calendar year".
- The House bill report on the Senate-amended bill: "A consumer's consent for the sharing of consumer health data must be separate and distinct from the consumer's consent for the collection of consumer health data", and consent must disclose categories, purpose, recipients and "how the consumer can withdraw consent".
- Deletion covers "archived or backup systems"; a backup deletion may be delayed but "may not exceed six months"; requests are answered "within 45 days", extendable once by 45.
- The Attorney General: violations are "a per se violation of the Washington Consumer Protection Act", enforced "by the Attorney General as well as through private action". A link to a "consumer health data privacy policy" must appear on the homepage. Effective 31 March 2024, and 30 June 2024 for small businesses.

**Other US states.** Nevada SB 370, effective 31 March 2024, requires consent to collect or share consumer health data and has no private right of action (*secondary*, Bass Berry). Connecticut's amendments, effective 1 October 2023, require consent before processing consumer health data, regardless of size thresholds (*secondary*, Orrick). California Civil Code 56.06(d): "Any business that offers a mental health digital service to a consumer for the purpose of allowing the individual to manage the individual's information, or for the diagnosis, treatment, or management of a medical condition of the individual, shall be deemed to be a provider of health care subject to the requirements of this part." New York's Health Information Privacy Act was vetoed in December 2025 (New York State Senate statement); a revised 2026 bill exists, status not verified.

**HIPAA.** HHS: "Only health plans, health care clearinghouses and most health care providers are covered entities". When a consumer uses an app on her own, the developer is "not creating, receiving, maintaining or transmitting protected health information (PHI) on behalf of a covered entity", so HIPAA does not apply. When a provider directs patients to an app on the provider's behalf, "the developer is a business associate of the provider".

**FTC.** The Health Breach Notification Rule covers health apps outside HIPAA: a "mobile app, website, Internet-connected device or similar technology that holds consumers' health information" (FTC guidance, July 2024), with penalties stated then as "up to $51,744 per violation". The FTC's 2023 BetterHelp order required "online counseling service BetterHelp to pay $7.8 million" over sharing health data for advertising.

### Hosting vendors' data-processing terms (read 2026-10-04)

Quotes come through a page-reading tool that returns text, not the page bytes; the ones below were returned the same way twice.

- **Railway** ([DPA](https://railway.com/legal/dpa)): the description of processing says "Sensitive Data or Special Categories of Data: None"; "Customer acknowledges that Company's primary processing operations take place in the United States"; "Company may provide options for certain local data storage to Customer if Customer is receiving Paid Services pursuant to the Agreement." The DPA is executed through a self-service DocuSign form, and the parties "are deemed to have signed the EU SCCs". Its regions page lists EU West in Amsterdam, and volumes follow the service's region. *Secondary:* a Railway staff reply on its community forum says logs are stored in US West whatever the deploy region, and that no plan has a contractual single-country commitment. A HIPAA BAA needs a $1,000-a-month committed-spend tier.
- **Supabase** ([DPA](https://supabase.com/legal/dpa), version 1, 1 August 2026): "Sensitive Data" includes "data concerning health"; "Where Customer directs Supabase to Process Covered Data in a specific geographical region, Supabase shall ensure that such Covered Data is stored and primarily Processed in that region unless otherwise required to comply with Customer's additional instructions, applicable law or as necessary to provide Services requested by Customer"; "acceptance of the Agreement shall have the same effect as signing the SCCs". HIPAA data needs a BAA and a paid add-on on the Team plan (from $599 a month) or Enterprise. EU regions include Frankfurt, Ireland, Paris and Stockholm; where backups and logs are kept is not stated.
- **Cloudflare R2** offers an EU jurisdiction fixed at bucket creation; the DPA text read does not name R2, and Cloudflare's BAA is for enterprise customers. **AWS KMS** and **Google Cloud KMS** keep single-region key material in the chosen region, under each provider's DPA.

What it means: as written, Railway's terms don't cover health records or EU-only processing, so records shouldn't go onto Railway until it confirms both in writing; Supabase's terms cover both for stored records. In either option the connector runs on Railway and handles decrypted records while it answers, so Railway's terms matter either way, and the connector's logs must stay free of content.

### What these facts mean for the design (inferences, not legal advice)

1. Write tools are allowed on both platforms if every tool is labeled accurately.
2. A listed plugin should not collect whole chat logs on its own initiative. OpenAI's rule is explicit; Anthropic's is close. Saves in a listed plugin should follow the person's explicit request (owner question 1).
3. Saves will often show a confirmation, so the tools let one confirmation cover a whole save request.
4. Saved InnerSignal conversations reveal mental health, so they are special-category data under the EU and UK GDPR and consumer health data in Washington. That calls for explicit consent, a separate consent for any sharing, an impact assessment, EU and UK representatives if InnerSignal is not established there, and deletion that reaches backups.
5. HIPAA is unlikely to apply while people use InnerSignal on their own; it may apply if a covered-entity therapist directs clients to it (the supervisor channel). The FTC breach rule and California's medical-information law may apply. The legal review decides.
6. OpenAI lists "PHI" as restricted data. PHI is a HIPAA term, and InnerSignal's records are not PHI while HIPAA does not apply, but together with the special-category rule this needs OpenAI's written view before submission.

## Design overview

```text
ChatGPT / Claude (host model)                Account page (browser)
        |  MCP over HTTPS + OAuth token             |  sign-in, consent, history,
        v  (audience = InnerSignal resource)        v  export, deletion
InnerSignal connector (existing server, new records tools)
        |  account from token subject; consent, scope, limits
        v
Records service (new module)  --- per-account keys --->  Key service (cloud KMS, two root keys)
        |
        v
PostgreSQL: accounts, metadata, ciphertext      Object storage: large encrypted blobs and backups
Keycloak: sign-up, sign-in, consent step (one realm, as today)
```

- The connector keeps every existing tool. New tools are account-scoped: they take no account or case ID, and the server finds the caller's own records from the token.
- PostgreSQL holds account rows, metadata and ciphertext. Content is encrypted by the records service before it reaches the database, so a database copy alone reveals no content.
- Large blobs (journal imports, attachments, handoff artifacts) go to object storage, encrypted the same way.
- A cloud key service (KMS) holds the two root keys. They never leave it; the server asks it to unwrap a person's key when needed.

## Data model

Every table carries `account_id`. Content columns hold AES-256-GCM ciphertext; everything else is plaintext metadata the server needs to list and limit. Server timestamps are plaintext; dates a person supplies are encrypted.

### Accounts and identity

| Field | Stored as | Notes |
|---|---|---|
| `account_id` | random UUID | internal; never shown to the host model |
| `idp_subject` | text, unique | Keycloak `sub`; how a token finds its account |
| `case_id` | text | one private case per account, created at sign-up; links to existing case-shaped code |
| `status` | enum | `active`, `deletion_pending`, `deleted` |
| `paused_scopes` | set of enum | `conversations`, `journal`; empty when nothing is paused. Survives restarts; see `pause_saving` |
| `created_at`, `last_seen_at` | timestamps | `last_seen_at` drives the inactivity rule |
| `adult_confirmed_at` | timestamp | age confirmation at sign-up (owner question 6) |
| `quota_bytes_used` | integer | limits |

Email and password stay in Keycloak only. `host_links` records `(account_id, host, first_seen, last_seen)` with host `chatgpt`, `claude` or `web`, taken from the OAuth client, so a person can see where they connected from. No host-side user ID is stored.

### Conversations and turns

`conversations`: `conversation_id` (server-assigned UUID), `origin` (`chatgpt`, `claude`, `web`, `import`), `title_ct` (encrypted, up to 120 characters), `save_mode` (`every_turn` or `user_selected`), `started_at`, `last_turn_at`, `turn_count`, `protocol_version` and `protocol_sha256` (the served therapy protocol when the conversation started, which meets the 2026-09-26 phase-1 recording rule for stored sessions), `status`, `deleted_at`.

`turns`: `conversation_id`, `turn_index` (1-based position in the host chat), `role` (`user` or `assistant`), `text_ct`, `text_hmac` (keyed hash under the account's index key, for duplicate detection; never a plain hash), `capture` (`host_reported` for plugin saves, `runtime_exact` for web-app turns), `batch_id`, `byte_length`, `created_at`. Turns are append-only. A correction is a separate amendment row that points at the original, following the existing transcript-amendment pattern (`src/storage/transcript-amendments.mjs`).

Plugin-saved turns are what the host model sent. The server cannot check them against what was shown on screen, so they are never treated as verified exact quotations. This matches the existing rule that proposed evidence is not a verified quote (`src/case-state/evidence-authority.mjs`).

### Journal entries

`journal_entries`: `entry_id`, `kind` (`journal` or `dream`), `entry_date_ct` (optional, encrypted), `title_ct`, `origin`, `use_in_sessions` (the journal design's session-use permission), `current_version`, `created_at`, `updated_at`, `deleted_at`. `journal_entry_versions` holds `text_ct` per version, up to 40,000 characters, the existing per-entry limit (`PRIVATE_RECORD_LIMITS.journal_text`). Earlier versions stay until the entry is deleted, so an edit can be undone.

Bulk journal imports keep the existing encrypted corpus format. Their corpus keys are wrapped under the account key instead of being listed in server settings.

### Settings

`settings_versions`: `version`, `fields_ct`, `created_at`, `source` (`chat`, `account_page`). Settings are fixed fields that the server validates; unknown fields are rejected and free-text rules are never stored. The initial set comes from existing designs: `language`; the invitation preferences for inner-child and spiritual suggestions (`unset`, `welcome`, `user_initiated_only`, `do_not_suggest`, from `2026-09-05-companion-foundations-design.md`); the inner-speech screen answer named in the therapy skill; `save_mode`; the default for `use_in_sessions`. Personal-learning items join later with the 2026-09-26 design. Each change creates a new version; the newest is current.

### Handoffs

Handoffs keep the existing immutable encrypted format and the `handoff:<uuid>` ID (`src/storage/private-case-handoff.mjs`). A handoff created from a host chat is a new kind, `host_session`. It carries the selected saved conversations, current settings, the protocol identity, and an optional continuation note of up to 8,000 characters. It holds no InnerSignal candidate or audit state, so the existing continuation gate for runtime candidates does not apply to it, and it says so in its header. Handoffs from the web runtime keep schema v3 and its gate. The locator mapping moves into the database, as `docs/PRIVATE-CASE-CONTINUITY.md` recommends.

### Consent records

`consent_records` are append-only: `consent_id`, `purpose`, `policy_version` (hash of the exact text shown), `action` (`granted` or `withdrawn`), `at`, `channel` (`signup`, `account_page`, `chat`). Purposes:

- `save_records`: storing conversations, journal entries, settings and handoffs;
- `use_in_sessions`: letting later sessions read saved records;
- `share_with_supervisor`: reserved for the 2026-09-26 design, always separate;
- `age_confirmation`: recorded with sign-up.

A withdrawal is a new row; nothing is edited. Records hold no IP address and no content.

### Deletion log and access log

`tombstones` hold `(object_type, object_id, deleted_at, shred_at)` and no content. They let a restored backup re-apply deletions before it opens. `access_events` record who touched which object and when (`user`, `system` or `operator`), without content, so people and auditors can see access.

## Plugin tools

### Common rules

- The tools act only on the caller's own account, found from the token subject. No tool accepts an account ID or a case ID. A wrong or foreign ID returns the same `NOT_FOUND` as a missing one, so IDs cannot be probed.
- New scopes: `records:read`, `records:write`, `records:delete`. The first sign-in asks for all three, so no host has to handle a later scope upgrade, whose host support is unverified. The existing `case:*` scopes keep serving the legacy case tools unchanged.
- Every write that stores something checks consent first. Without `save_records` the tool returns `CONSENT_REQUIRED` with the account-page link and stores nothing. `delete_saved_item`, `pause_saving` and `withdraw_consent` store nothing new, so they stay callable without current consent; a person who has withdrawn can still delete in chat. When the write's scope is paused it returns `SAVING_PAUSED` with that scope, and writes in other scopes go through.
- Errors are codes with schema paths, never content: `CONSENT_REQUIRED`, `SAVING_PAUSED`, `TURN_CONFLICT`, `VERSION_CONFLICT`, `NOT_FOUND`, `QUOTA_EXCEEDED`, `RATE_LIMITED`, `INVALID_INPUT`, `ACCOUNT_DELETION_PENDING`.
- Responses do not echo saved text back.
- Every tool has a `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint: false` (the records stay inside one private account).

### Write tools

| Tool | What it does | Scope | Read-only | Destructive | Idempotent |
|---|---|---|---|---|---|
| `save_conversation_turns` | Append exchanges to a conversation; starts one when `conversation_id` is omitted | `records:write` | false | false | true |
| `save_journal_entry` | Create a journal or dream entry | `records:write` | false | false | true |
| `update_journal_entry` | Replace an entry's text with a new version | `records:write` | false | true (overwrites the current text) | true |
| `update_settings` | Change validated settings fields | `records:write` | false | true (overwrites current values) | true |
| `create_handoff` | Freeze an immutable handoff from saved records | `records:write` | false | false | true |
| `delete_saved_item` | Move a conversation, journal entry or handoff to "Recently deleted" | `records:delete` | false | true | true |
| `pause_saving` | Stop new saves now, for conversations, journal entries or both | `records:write` | false | false | true |
| `withdraw_consent` | Withdraw consent to saving or to use in later sessions, and stop what it covered | `records:write` | false | false | true |

**`save_conversation_turns`.** Inputs: `conversation_id` (optional), `title` (optional, only when starting, up to 120 characters), `save_mode` (`every_turn` or `user_selected`), `batch_id` (UUID, required), `turns` (1 to 20 items of `{turn_index, role, text}`, each `text` up to 100,000 characters, at most 400 KB per call, under the server's existing 1,000,000-byte request limit). Idempotency:

- Re-sending the same `batch_id` returns the first result.
- A turn whose `(conversation_id, turn_index)` already holds the same keyed hash is reported as `already_saved`.
- The same index with different text is refused with `TURN_CONFLICT` and the server's `next_turn_index`. Nothing is overwritten.
- Gaps are allowed and shown as "not saved" ranges.

The response gives the `conversation_id`, counts, and `next_turn_index`. Limit: 5,000 turns per conversation.

**How turns get sent.** The instructions the plugin gives the host depend on owner question 1:

- *User-selected saves:* when the person asks ("save this conversation", "save from here"), the model sends the exchanges they chose in batches, under one confirmation where the host allows it.
- *Every-turn saves:* at the start of each new turn the model saves the previous exchange. A reply cannot be saved after it is shown in the same turn, so the last exchange of a chat is saved only when the person sends another message or asks to save.

In both modes the model copies text exactly. A lost `conversation_id`, for example after the host trims a long chat, is recovered with `list_conversations`.

**`save_journal_entry`.** Inputs: `kind`, `text` (1 to 40,000 characters), `entry_date`, `title` and `use_in_sessions` (all optional; `use_in_sessions` defaults to the person's setting), `client_request_id` (required). The same `client_request_id` within 24 hours returns the first result; the same text within 10 minutes without an ID is reported as a likely duplicate rather than saved twice.

**`update_journal_entry`.** Inputs: `entry_id`, `expected_version`, `text`, optional `entry_date` and `title`. A version mismatch returns `VERSION_CONFLICT`.

**`update_settings`.** Inputs: `expected_version` and `changes` (known fields only). Settings changes are rare, so a confirmation each time is acceptable.

**`create_handoff`.** Inputs: `conversation_ids` (1 to 5; default the current one), `note` (optional, up to 8,000 characters, written with the person), `include_journal` (references only), `client_request_id`. Returns `handoff_id`, which the existing `load_handoff` opens in a new chat.

**`delete_saved_item`.** Inputs: `item_type` (`conversation`, `journal_entry` or `handoff`) and `item_id`. The item disappears from every read tool and session at once and can be restored from the account page for 7 days, after which it is destroyed (see "Deletion"). Account deletion is not a chat tool; it happens only on the account page after signing in again.

**`pause_saving`.** Inputs: `scope` (`conversations`, `journal`, `all`). It adds the scope to the account's `paused_scopes` (`all` adds both), which survives restarts. `conversations` blocks `save_conversation_turns` and `create_handoff`, since a handoff is a note about conversations; `journal` blocks journal writes; `all` blocks both. Settings changes and deletions stay allowed during any pause, because the person may need them. A pause is not a consent withdrawal and changes no consent record. Stopping takes one sentence in chat. Turning a scope back on happens on the account page, where consent is recorded with its exact text.

**`withdraw_consent`.** Inputs: `purpose` (`save_records` or `use_in_sessions`). It appends a `withdrawn` row to `consent_records` with `channel` `chat` and the current policy hash, then applies it at once: withdrawing `save_records` stops every write, and withdrawing `use_in_sessions` stops sessions from reading saved records. Nothing is deleted; the reply offers deletion as a separate step. Granting again happens only on the account page, with the exact text shown. A pause, by contrast, keeps consent and changes no consent record.

### Read tools

All annotated `readOnlyHint: true`, `destructiveHint: false`, with scope `records:read`:

| Tool | Returns |
|---|---|
| `get_saving_status` | consent state, save mode, pause state, account-page link |
| `list_conversations` | newest first: ID, title, origin, dates, turn count; paged, up to 50 per page |
| `get_conversation` | turns by index range, up to 200 turns or 200 KB per page |
| `search_saved_records` | matching turns and journal entries for a query, up to 25 results; the server decrypts the person's records in memory and keeps no plaintext index |
| `list_journal_entries` / `get_journal_entry` | entries and their current text |
| `get_settings` | current validated settings |

`load_handoff` is extended to open account-owned handoffs. The existing case tools stay unchanged for legacy cases until their migration is verified.

`use_in_sessions` decides whether a later session may pull a record in uninvited. `search_saved_records` leaves out records with `use_in_sessions = false` unless the call sets `include_excluded`, which the plugin instructions allow only when the person asks for those records.

### Confirmation per host

| Host | Read tools | Additive saves | Overwrites and deletions |
|---|---|---|---|
| ChatGPT | can be allowed for the app ("Allow read actions") | "Write actions by default require confirmation"; can be remembered per tool per conversation; may fall under "Allow low-risk actions" (not documented) | confirmation; "Sensitive actions may require approval or be denied" |
| Claude | "can run without per-call confirmation" | default not documented | "always prompt" |

Every-turn saving may therefore ask for approval on every turn unless the person widens the app's permission. User-selected saves ask about once per request.

### Limits

Per account: 300 write calls an hour and 60 a minute; 1 GB of stored text before a `QUOTA_EXCEEDED` warning; 10,000 conversations. Per IP: sign-up and sign-in limits in Keycloak.

## Storage and per-user encryption

### Algorithms

The design reuses what the repository already uses and invents no new primitive, as the journal design requires:

- AES-256-GCM with random 96-bit nonces and 128-bit tags (`src/storage/vault-crypto.mjs`, `src/storage/journal-object-crypto.mjs`);
- HKDF-SHA-256 for derived keys;
- HMAC-SHA-256 for keyed hashes;
- associated data built with the existing length-prefixed `frame()` from suite ID, `account_id`, object type, object ID, version or `turn_index`, and field name, so ciphertext copied to another row or account fails to decrypt.

Each item key encrypts at most a few thousand messages (a conversation is capped at 5,000 turns), which keeps random nonces far from the point where a repeat becomes a risk. New object crypto and the migration need a focused security review before real data, as the journal design already requires.

### Key hierarchy

1. **Root keys.** Two keys in a cloud key service (KMS), in two regions or two providers. Each wraps every account key. As with today's routine and recovery wraps, losing one key service does not lose data. The root keys never leave the KMS.
2. **Account key.** One random 32-byte key per person, stored only as its two wraps in a separate `account_keys` table.
3. **Item keys.** One random 32-byte key per conversation, journal entry (all versions), handoff, and settings history, wrapped by the account key and stored beside the item. Deleting an item key makes that item unreadable in the live database at once, and in backups once the last backup holding the key expires (30 days).
4. **Index key.** Derived from the account key with HKDF (`inner-signal:records:index:v1`) for keyed duplicate detection. It never leaves the server.

To open a record, the server verifies the token, finds the account, asks the KMS to unwrap the account key (kept in memory for at most 5 minutes after last use, then zeroized, as current code zeroizes keys), unwraps the item key, and decrypts.

### What the encryption protects

It protects against a stolen database copy, backup, disk or log; against one person's records being returned to another person by a query mistake; and it makes deleting one item final without touching the rest.

It does not protect against InnerSignal's running server, anyone who controls it, or a legal order served on InnerSignal: the server holds what it needs to decrypt while serving a person. The host model also sees everything sent to it, under OpenAI's or Anthropic's policies. The privacy policy has to say this plainly; "encrypted" must not be presented as "unreadable by InnerSignal".

### Key management

- Only the production service identity may ask the KMS to decrypt. Key administration needs the owner's account with multi-factor sign-in. No person decrypts data in routine work.
- KMS request logs are watched for unusual volume. The emergency brake removes the production service's decrypt permission on both root keys, or disables both keys: either root key alone unwraps every account key, so acting on one stops nothing. Account keys already unwrapped stay in memory for up to 5 minutes after last use, so the brake also stops the service. Lifting the brake restores the permission and needs the owner's account with multi-factor sign-in.
- Root keys rotate on the provider's schedule. An account key can be replaced by re-wrapping its item keys, without re-encrypting content.
- Support access to a person's content needs that person's explicit request, or a documented legal or security reason, and is logged in `access_events`. Supervisor access follows the 2026-09-26 consent rules.

### Backups

- A daily full backup plus continuous write-ahead logs, sent to a different provider from the database and encrypted with a separate backup key. Retention: 30 days.
- The `account_keys` table is backed up separately with the same 30-day cap. After deletion, no backup can decrypt the deleted data once 30 days have passed. That is inside Washington's six-month limit for backups; the legal review confirms it for GDPR.
- A restore goes into an isolated environment and applies the tombstones before anything opens, as the journal design requires.
- Restore drills: before invited testers, then quarterly.

### Deletion

- **One item.** It disappears from reads and sessions at once and sits in "Recently deleted" for 7 days. The person can restore it, or choose "delete now". Then its item key and ciphertext rows are removed within 24 hours, derived data goes with it (a handoff that contains the item is deleted too, and the deletion preview says so), and its backups become unreadable within 30 days.
- **Account.** Requested on the account page after signing in again, with a 7-day cancel window or "delete now". Every item is shredded, both account-key wraps are destroyed, and the Keycloak user is deleted. What survives is a content-free record that consent was given and withdrawn and when, for as long as the legal review says.
- **Imported journal corpus.** Deleted by destroying its corpus key wraps and its encrypted objects, with the same 7-day and 30-day windows; the journal design's tombstone and visibility-epoch rules apply.
- **Limits, stated to the person.** InnerSignal cannot delete the copies OpenAI or Anthropic keep of the chats; the person deletes those in ChatGPT or Claude. Downloaded exports and replies already sent cannot be recalled.

### Export

The account page offers "Download my data" after signing in again. It builds a ZIP with machine-readable JSON, as Art. 20 describes, and readable HTML: conversations, journal entries with all versions, settings history, handoffs, and consent history. The file is encrypted at rest on the server, available through a link for 24 hours, then deleted.

## Authentication and accounts

- **One Keycloak realm, as today, with self-registration turned on**: email verification and optional passkeys, with social sign-in left for later. Keeping one realm keeps every existing subject ID, so no one resets a password, as the 2026-09-26 design requires. Legacy cases stay protected by their existing static ACL.
- **Clients.** ChatGPT through its CIMD client (today's pre-registered identifier, or Keycloak's experimental CIMD). Claude through CIMD or, for a directory listing, Anthropic-held credentials; custom-connector users can keep the static client in `docs/CLAUDE-CONNECTOR.md`. DCR is avoided because Claude creates a client per connection and the 2026-07-28 spec deprecates it.
- **Tokens.** Short-lived access tokens (5 to 15 minutes); rotating refresh tokens; audience equal to the connector's resource identifier (the current audience mapper, until Keycloak's resource indicators leave experimental status); `iss` in authorization responses. As the 2026-07-28 spec advises, the connector's own `scopes_supported` leaves out `offline_access`; the authorization server lists it, which is where Claude looks before asking for a refresh token.
- **Account lookup** replaces the hand-edited ACL for public users: token `sub` to `accounts.idp_subject` to records. A first sign-in with no account row creates the account, its case ID and its key wraps in one transaction, after consent is recorded.
- **Mixed sign-in.** The protocol tools stay `noauth`; records tools are `oauth2`. Someone who never signs in still gets the therapy protocol, and nothing is stored.
- **Protocol version.** Negotiate newer MCP versions once both hosts accept them; until then keep `2025-06-18`.

## Consent flow

1. **At first sign-in**, on InnerSignal's own page inside the OAuth flow, before any token is issued, the page says plainly:
   - what is saved: conversations the person saves (or every turn, if that mode exists), journal entries, settings, handoffs;
   - where: InnerSignal's servers, in the region chosen under owner question 2, encrypted per person;
   - who can read it: the person, and InnerSignal's systems when serving them; no one else without a separate choice;
   - how long it is kept (owner question 3);
   - that ChatGPT and Claude keep their own copies under their own policies.
2. **Separate, unticked choices:**
   - "Save my InnerSignal records on InnerSignal's server" (needed for any saving; the explicit consent under GDPR Art. 9(2)(a) and the collection consent in Washington);
   - "Let future InnerSignal sessions use my saved records";
   - "I am 18 or older" (owner question 6).
   Sharing with a supervisor is never bundled here; the 2026-09-26 design asks for it separately, which also meets Washington's separate-consent rule for sharing.
3. **Recorded** with the policy-text hash and time, and confirmed on screen.
4. **In chat**, a write without consent returns `CONSENT_REQUIRED` with the account-page link. The model passes the link on and never pressures.
5. **Withdrawal** takes one sentence in chat (`withdraw_consent`, which appends the `withdrawn` record) or one click on the account page. It stops what it covered at once and offers deletion of what exists as a separate choice. Someone who only wants a break uses `pause_saving`, which keeps consent.
6. **Changes** to purposes, recipients or processors need fresh consent; earlier consent covers only what its version described.
7. **One flow for everyone**, built to the strictest rules found (GDPR explicit consent; Washington's separate consents), instead of branching by location. Fewer branches mean fewer mistakes.

## Retention

| Data | Default | Decided by |
|---|---|---|
| Saved conversations, journal entries, settings, handoffs | until the person deletes them or the account, or the inactivity rule | owner question 3 |
| Inactive accounts | proposed: email warning at 23 months and 30 days before, deletion 24 months after the last sign-in | owner question 3 |
| "Recently deleted" items | 7 days, or "delete now" | this design |
| Backups and the key-table backup | 30 days | this design, confirmed by the legal review |
| Tombstones | 60 days (backup retention plus margin); for a migrated account, at least until 30 days after its legacy rollback copy is destroyed, whichever is later | this design |
| Consent records | content-free; for the account's life plus a period the legal review sets | legal review |
| Access and security logs | content-free; proposed 1 year | legal review |
| Request logs | never contain request bodies; 30 days | this design |
| Supervisor escalation packages | unchanged: 30 days after review | 2026-09-26 design |

## Threat model

| Threat | Example | Mitigation | What remains |
|---|---|---|---|
| Stolen database or backup | dump leaked from the host or backup bucket | ciphertext only; account keys wrapped by KMS keys the thief lacks; separate backup key | metadata (timestamps, counts) is readable |
| Server compromise | attacker runs code on the connector | least-privilege service identity, pinned dependencies, no shell access, short key caching, alerts on KMS volume, the emergency brake on both root keys | every account is exposed, inactive ones included: the service identity can ask the KMS to unwrap any account key, and the 5-minute cache limits only honest use. The privacy policy says so. The security review before phase 2 decides whether to add a key broker that unwraps an account key only for a valid access token of that account, which would limit a compromise to people signed in during it |
| One person reads another's records | ID guessing, wrong ID, query bug | no account or case IDs in tools; account from token; associated data binds ciphertext to its account; cross-account tests | — |
| Token theft or misuse | token replayed, or a token meant for another service | audience check, short lifetimes, refresh rotation, no token passthrough (MCP spec) | a stolen live token works until it expires |
| Prompt injection through the host | a web page tells the model to delete or overwrite records | destructive tools are labeled so hosts prompt; 7-day recovery; deletion is never silent | a person may approve a malicious prompt; recovery covers it for 7 days |
| Exfiltration through other connectors | the model passes read results to another enabled tool | bounded read results; `use_in_sessions` limits uninvited reads | the host controls tool routing; disclosed in the privacy policy |
| Insider access | an operator browses content | no routine decrypt path, break-glass logged and disclosed | a determined operator with server control |
| Legal demand | court order to InnerSignal | minimal data, a stated region, transparency in the policy | InnerSignal can be compelled to hand over what it can decrypt |
| Wrong saved text | the model saves a paraphrase or a wrong turn | `host_reported` label; person can view, correct by amendment, delete | the server cannot verify host text |
| Abuse and flooding | scripted saves | per-account and per-IP limits, quotas | — |
| Data loss | provider outage, operator mistake | daily backups, write-ahead logs, two root keys in different places, restore drills | up to minutes of writes in a disaster |
| Children | a minor signs up | age confirmation; deletion when discovered | self-declared age can be false |

## Migration from today's storage

This section is an outline. Before phase 2, the migration gets its own design and review, which has to meet every requirement below, including the cutover rules in steps 3 to 6.

1. **Build alongside.** The new store and tools ship behind a setting that is off by default. The existing case tools, static ACL and read-only vault keep serving their current grants unchanged.
2. **Accounts for existing people.** The owner's existing Keycloak subject gets an `accounts` row, with no password reset. Every existing case belongs to a specific person; it moves only to that person's account, after that person has an account and has given consent, and the owner confirms the case-to-account mapping. A case whose person has not consented stays in the legacy store.
3. **Move each case.** Two steps keep today's isolation. First, a one-shot operator job, networkless as today's operator is, decrypts a legacy case with its existing keys and writes a staging file: its turns, journal entries and the full content of its existing handoffs, encrypted with AES-256-GCM under a one-time migration key and bound by associated data to the case and the target account. Second, a separate importer with network access but no legacy keys reads the staging file with the same migration key and writes the records through the records service, which encrypts them under that person's account key. Each step compares counts and keyed hashes of every turn and entry and logs only counts and pass or fail. The migration key and the staging file are destroyed once the import is verified.
4. **Handoffs.** Existing immutable handoffs move with their case, content included, and become account-owned handoffs that keep their IDs, so an existing handoff link still opens. Until a case's move is confirmed, its handoffs stay readable from the legacy store, and `load_handoff` looks in both stores only for cases not yet migrated. New handoffs are created in the new store.
5. **Journal corpus.** The networkless job carries the case's corpus keys and corpus references in the staging file; the importer has them re-wrapped under the account key of the person the corpus belongs to, through the records service. The encrypted corpus objects are not rewritten, and opening a sample of them with the re-wrapped keys is part of the verification.
6. **Rollback window.** A move is confirmed only when every turn, journal entry, handoff and corpus key of the case has been imported and verified. Every other kind of record the legacy case tools read (state, tracker entries, candidate responses, source artifacts and evidence) either moves the same way or keeps its legacy read path for that case until the new store has a place for it; the migration design lists each kind and which applies. Once it is confirmed, no tool reads that case from the legacy vault any more: the connector refuses legacy reads for migrated cases, including handoffs. The vault stays read-only for 90 days as a rollback copy, then is deleted only on the owner's say-so. A rollback to it is possible only until the person's first write in the new store; after that, recovery uses the new store's own backups, so nothing written after the move can vanish. Every item deleted in the new store during that time is recorded as a tombstone (item ID and time, no content), and a rollback applies the tombstones before anything is served again, so a deletion stays deleted.
7. **Code and text that must change in reviewed pull requests:**
   - the server instructions sentence "The private case tools are read-only" (`serverInstructions` in `src/server/private-case-mcp.mjs`) and the tests that pin it (`tests/journal-work-tools.test.mjs`);
   - the continuity skill's "It is read-only" (`plugins/inner-signal-therapy/skills/inner-signal-private-continuity/SKILL.md`) and `tests/inner-signal-plugin-unification.test.mjs`;
   - the therapy skill sentence about "read-only private continuity tools" (`plugins/inner-signal-therapy/skills/inner-signal-therapy/SKILL.md`). This file is part of the served protocol, so its hash changes; it follows the authoring and sync gates and needs owner approval;
   - the Codex plugin manifest capabilities `["Advisory", "Read"]` and its long description's "read-only private continuity" (`plugins/inner-signal-therapy/.codex-plugin/plugin.json`);
   - the protected-resource metadata `scopes_supported` and the hosted loader's scope list.
8. **New runtime dependencies** (a PostgreSQL client and a KMS client) go through the existing dependency policy.
9. **The web app** later writes through the same records service; until then its runtime keeps the file vault.

## Cost per user

### Assumptions

- A message averages about 1,500 characters, about 1.6 KB as UTF-8, so an exchange is about 3.2 KB.
- A typical active user has 12 sessions a month of 25 exchanges: about 0.94 MB of text. Fifteen journal entries of 3 KB add 0.05 MB. Storage overhead (encryption, rows, indexes) is taken as 2.5 times: about 2.5 MB a month, 30 MB a year.
- A heavy user has 30 sessions a month of 60 exchanges: about 14 MB a month, 170 MB a year.
- KMS: about 150 unwrap requests a month per active user, with 5-minute key caching.
- Model costs are not InnerSignal's: the host runs the model. Saving does use the person's own ChatGPT or Claude allowance, because the model writes the text into the tool call.
- Capacity per server is not measured; the load test in the verification plan measures it.

### Published unit prices (read 2026-10-03)

- Railway: memory "$10 / GB / month", vCPU "$20 / vCPU / month", volume "$0.15 / GB / month", egress "$0.05 / GB"; Pro plan "$20 / month" including "$20 of resource usage". EU region "EU West Metal", Amsterdam.
- AWS KMS: "$1/month" per key, "$0.03 / 10,000 requests", 20,000 free requests a month.
- Cloudflare R2: "$0.015 / GB-month", no egress charge.
- Supabase: Pro "from $25/month" with "8 GB disk size per project", 7-day backups; Team "from $599/month"; HIPAA "Available as paid add-on" on Team and Enterprise.
- Netcup RS 1000 G12 (4 vCPU, 8 GB, 256 GB): 14.87 € a month (*secondary*, vpsbenchmarks, July 2026; not checked on netcup's own site).

### Estimates

Monthly base cost, if the resources below are in use all month:

| Item | Railway (EU) | Dedicated Netcup server |
|---|---|---|
| Connector and records service: 1 GB, 0.5 vCPU | $20 | on the one server |
| PostgreSQL: 1 GB, 0.25 vCPU, 10 GB volume | $16.50 | on the one server |
| Keycloak: 1.5 GB, 0.25 vCPU | $20 | on the one server |
| Server | (above) | about $17.40 (14.87 €) |
| KMS: 2 keys plus requests | about $2.50 | about $2.50 |
| Backups on R2 | $1–5 | $1–5 |
| **Base total** | **about $60–65** | **about $21–25** |

Per active user, adding about $0.01 a month of storage, backup, KMS and egress:

| Active users | Railway | Netcup |
|---|---|---|
| 100 | about $0.62 | about $0.23 |
| 1,000 | about $0.07 with the same base, $0.14 if the base doubles for capacity | about $0.03 with the same server, $0.06 if it doubles |
| 10,000 | about $0.04–0.07 (rough; needs the load test) | similar, with several servers |

Storage itself stays small: 1,000 typical users add about 30 GB a year, about $4.50 a month on a Railway volume.

Not estimated: the legal review, EU and UK representatives, a UK registration fee, company formation, insurance, and email sending (Keycloak needs email for verification anyway). The Netcup figures leave out the owner's or agents' time for patching, monitoring and recovery, and a single server has no failover. Health data should get its own server rather than share one with other automation.

## Legal-review checklist

A qualified reviewer must settle these before anyone other than the owner stores data (owner question 4):

1. **Controller and establishment.** Which legal person runs InnerSignal and from which country (owner question 5); that country's data-protection law, registration duties, health-data rules and rules on sending data abroad.
2. **EU and UK.** Special-category status of saved records; Art. 9(2)(a) explicit consent wording and evidence; whether Art. 27 representatives are required in the EU and the UK; DPIA (Art. 35) and the UK appropriate-policy document if relevant; records of processing.
3. **Rights.** Access, erasure, portability and objection processes within one month (Art. 12(3)); whether the 7-day "Recently deleted" window and the 30-day backup expiry are acceptable; what consent proof may be kept after deletion, and for how long.
4. **Processors and transfers.** Data-processing terms with the host (Railway or Netcup), KMS provider, backup storage and email sender; region choice; transfer mechanism for any US processor, and the status of the Data Privacy Framework appeal.
5. **United States.** Washington: privacy-policy link on the homepage, separate consents, 45-day responses, deletion including backups, private right of action. Nevada and Connecticut consent rules; California CMIA 56.06(d) and CPRA sensitive data; other state laws in force at launch.
6. **HIPAA and FTC.** Confirm HIPAA does not apply to direct use; check the supervisor channel, where a covered-entity therapist directing clients could make InnerSignal a business associate. FTC Health Breach Notification Rule duties and the incident plan.
7. **Breach response.** 72-hour GDPR notice, US state and FTC notices, who decides and how.
8. **Platform terms.** OpenAI's "PHI", special-category and chat-log rules; Anthropic's conversation-data rules; the honest description of saving in each listing; demo accounts with invented data only.
9. **Age.** Minimum age versus OpenAI's 13–17 suitability rule and GDPR Art. 8 (owner question 6).
10. **Wording.** Privacy policy, consent text, account-page text and the description of what encryption does and does not protect.
11. **Health-service rules.** Whether storing therapy-like conversations, or later supervision by therapists, triggers health-care or licensing rules where people live. The 2026-09-26 design already requires this review before supervision.
12. **Insurance and incident costs.**

## Rollout phases

Each phase ships as its own pull request with tests and a review, and needs owner approval before merge and deploy. A cross-family check of the central conclusions comes before phase 2.

| Phase | What | Gate before the next phase |
|---|---|---|
| 0. Decide | Owner answers the questions; legal reviewer engaged; impact assessment started; written questions sent to OpenAI and Anthropic | answers recorded |
| 1. Build with invented data | Records service, data model, encryption, tools, account page (consent, history, export, delete), all off by default; staging with invented data only | security review of the crypto and key management; synthetic tests green; the hosting agreement settled under owner decision 2: Railway's written DPA amendment covering health data and EU-only processing, logs included, received and checked by the privacy consultant. The connector runs on Railway and handles decrypted records under either storage option, so moving only the database to Supabase is not enough: if Railway declines, the agent brings the owner the choice of where the connector runs (a host whose terms cover health data in the EU, or Supabase for both), and no real record is processed anywhere until that is settled. No real record, the owner's included, goes into the store before this |
| 2. Owner only | The owner's account is created and his existing records migrated; he uses ChatGPT and Claude with it. No one else's records are stored or migrated in this phase | fresh-chat retrieval, deletion, export and a restore drill pass; the owner confirms the migration; legal review signed off; privacy policy and consent text published; incident plan ready |
| 3. Invited testers (up to 20) | Unlisted connector, save mode per owner question 1. Other existing cases move only now, each after its person has an account and has consented | OpenAI's and Anthropic's written answers to the listing questions |
| 4. Public listing | Submissions to OpenAI and Anthropic per their answers | listing approval; monitoring in place |
| 5. Web app | The paid web app saves every turn through the same store | its own design and owner approval |

## Verification plan

**Automated (synthetic data only):**

- Crypto: round trip; wrong account, wrong row or wrong field fails to decrypt; nonces are unique; both root-key wraps open; a shredded item key makes every copy unreadable.
- Idempotency: the same `batch_id` saves once; the same index and text reports `already_saved`; a different text gives `TURN_CONFLICT` and overwrites nothing; journal `client_request_id` replay.
- Access: no token gets 401 with `resource_metadata`; a missing scope gets 403 `insufficient_scope`; account A's token cannot read, list, find or delete B's items, and gets the same `NOT_FOUND` for foreign and missing IDs.
- Consent: no consent means `CONSENT_REQUIRED` and zero rows; a paused account stores nothing; withdrawal in chat takes effect at once.
- Deletion: invisible at once; restorable for 7 days; shredded afterwards; derived handoffs removed; a restored backup re-applies tombstones before opening.
- Export: everything saved comes back, and the export matches the store.
- Limits and validation: oversize input, too many turns, unknown settings fields, rate limits.
- Tool list: every tool has a `title` and correct hints (both platforms check this); per-tool security schemes; protected-resource metadata scopes.
- Privacy: a sentinel string in saved text never appears in logs, errors or diagnostics.
- Existing tests updated where they pin read-only wording; the complete package gate passes.

**Live, owner-gated:**

- In new ChatGPT and Claude chats: sign up, consent, save, list, open in another new chat, delete, export.
- Record which confirmations each host actually shows, for which tools.
- Count conflicts and gaps in `turn_index` across real hosts, because models can miscount long chats.
- Load test: 100 concurrent saves, measuring p95 latency (target under 500 ms per save) and capacity per server.
- Restore drill on staging.

**Not run for this document:** a cross-family reasoning check (owner rule for heavy, costly-if-wrong conclusions); it comes before phase 2.

## Owner questions

None open. All were answered on 2026-10-04; see "Owner decisions (2026-10-04)".

## Owner tasks (no decision needed)

- Create the Railway project in the EU region and a KMS account with multi-factor sign-in (phase 1, invented data only).
- Before any real data: send Railway the drafted letter on health data and EU-only processing, and send OpenAI the drafted letter on the 18-and-over age limit.
- Engage the privacy consultant (question 4: C) and share this design, the checklist and the entity question.

## Coming up (defaults unless you say otherwise)

- Your existing records move into the new store in phase 2; any other existing case moves only to its own person's account, with that person's consent. The old store stays read-only for 90 days and is deleted only when you say so.
- No routine human access to anyone's saved content.
- Single items can be deleted in chat, with the host's confirmation and 7 days to restore; whole accounts only on the account page.
- One EU region for everyone.
- Every saved conversation records the protocol version and hash it started with.

## Not verified

- Whether ChatGPT treats an additive save as a "low-risk" action, and Claude's default for non-destructive write tools.
- How OpenAI applies "PHI" and "strictly necessary" to a mental-health storage app, and whether its chat-log rule permits user-requested whole-conversation saves.
- ChatGPT app availability by region; which ChatGPT plans can add unlisted apps today. The repository records the owner's 2026-09-27 check that Plus and Pro can create custom apps with OAuth.
- Claude plan eligibility for custom connectors (sources disagree).
- Netcup's price on its own site; Railway capacity per service; real storage and request volumes.
- Nevada and Connecticut details (secondary sources only); New York's 2026 bill; the outcome of the Data Privacy Framework appeal.
- Legal-review, representative, registration and company-formation costs.
- Whether Keycloak's experimental CIMD and resource indicators are stable enough for production.
- Where Railway stores logs (a forum reply only) and where Supabase keeps backups and logs (not stated); whether either vendor accepts mental-health records that are not PHI.

## Sources

Read on 2026-10-03.

OpenAI:

- Plugin guidelines: https://developers.openai.com/plugins/plugin-guidelines
- App submission guidelines: https://developers.openai.com/apps-sdk/app-submission-guidelines
- Authentication: https://developers.openai.com/apps-sdk/build/auth
- ChatGPT Developer mode: https://developers.openai.com/api/docs/guides/developer-mode.md
- Apps in ChatGPT: https://help.openai.com/en/articles/11487775-apps-in-chatgpt
- Developer mode and MCP apps: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt

Anthropic:

- Submit a connector: https://claude.com/docs/connectors/building/submission.md
- Connector pre-submission checklist: https://claude.com/docs/connectors/building/review-criteria.md
- Authentication for connectors: https://claude.com/docs/connectors/building/authentication.md
- Software Directory Policy: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy
- Use connectors: https://support.claude.com/en/articles/11176164
- Building custom connectors: https://support.claude.com/en/articles/11503834

MCP and Keycloak:

- Authorization, 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization.md
- Authorization, latest (2026-07-28): https://modelcontextprotocol.io/specification/latest/basic/authorization
- Keycloak MCP guide: https://www.keycloak.org/securing-apps/mcp-authz-server

EU and UK:

- GDPR Arts. 3 and 4, as adopted: https://www.legislation.gov.uk/eur/2016/679/chapter/I/adopted/data.htm
- Art. 7: https://www.legislation.gov.uk/eur/2016/679/article/7/adopted/data.htm
- Art. 8: https://www.legislation.gov.uk/eur/2016/679/article/8/adopted/data.htm
- Art. 9: https://www.legislation.gov.uk/eur/2016/679/article/9/adopted
- Art. 12: https://www.legislation.gov.uk/eur/2016/679/article/12/adopted/data.htm
- Arts. 17 and 20: https://www.legislation.gov.uk/eur/2016/679/chapter/III/section/3/adopted/data.htm
- Arts. 27 and 28: https://www.legislation.gov.uk/eur/2016/679/chapter/IV/section/1/adopted/data.htm
- Art. 33: https://www.legislation.gov.uk/eur/2016/679/article/33/adopted
- Art. 35: https://www.legislation.gov.uk/eur/2016/679/article/35/adopted
- UK GDPR Art. 9: https://www.legislation.gov.uk/eur/2016/679/article/9
- UK GDPR Art. 27: https://www.legislation.gov.uk/eur/2016/679/article/27/data.htm?view=plain
- ICO, special category data: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-rules-on-special-category-data/
- Data Privacy Framework ruling (secondary): https://iapp.org/news/a/european-general-court-dismisses-latombe-challenge-upholds-eu-us-data-privacy-framework
- Appeal C-703/25 P (secondary): https://digitalpolicyalert.org/event/35459-latombe-filed-appeal-against-general-court-dismissal-of-challenge-to-european-unionunited-states-data-protection-framework-adequacy-decision-in-latombe-v-commission

United States:

- RCW 19.373.010: https://lawfilesext.leg.wa.gov/law/RCW/RCW%20%2019%20%20TITLE/RCW%20%2019%20.373%20%20CHAPTER/RCW%20%2019%20.373%20.010.htm
- RCW 19.373.040: https://lawfilesext.leg.wa.gov/law/RCWArchive/2023/htm/RCW%20%2019%20%20TITLE/RCW%20%2019%20.373%20%20CHAPTER/RCW%20%2019%20.373%20.040.htm
- ESHB 1155 bill report: https://lawfilesext.leg.wa.gov/biennium/2023-24/Htm/Bill%20Reports/House/1155-S.E%20HBR%20SA%2023.htm
- Washington Attorney General: https://atg.wa.gov/protecting-washingtonians-personal-health-data-and-privacy
- Nevada SB 370 (secondary): https://www.bassberry.com/news/nevada-consumer-health-data-law-takes-effect-on-march-31-2024/
- Connecticut amendments (secondary): https://www.orrick.com/en/Insights/2023/07/The-Consumer-Health-Data-Amendments--to-the-Connecticut-Data-Privacy-Act
- California Civil Code 56.06: https://california.public.law/codes/civil_code_section_56.06
- California AB 2089 analysis: https://sjud.senate.ca.gov/sites/sjud.senate.ca.gov/files/ab_2089_bauer-kahan_sjud_analysis.pdf
- New York veto statement: https://www.nysenate.gov/newsroom/press-releases/2025/liz-krueger/statement-senator-liz-krueger-and-assemblymember-linda
- HHS health app scenarios: https://hhs.gov/sites/default/files/ocr-health-app-developer-scenarios-2-2016.pdf
- FTC breach rule basics: https://www.ftc.gov/business-guidance/resources/health-breach-notification-rule-basics-business
- FTC BetterHelp order: https://www.ftc.gov/news-events/news/press-releases/2023/07/ftc-gives-final-approval-order-banning-betterhelp-sharing-sensitive-health-data-advertising

Prices:

- Railway plans: https://docs.railway.com/pricing/plans.md
- Railway regions: https://docs.railway.com/deployments/regions.md
- AWS KMS: https://aws.amazon.com/kms/pricing/
- Cloudflare R2: https://developers.cloudflare.com/r2/pricing
- Supabase: https://supabase.com/pricing.md
- Netcup RS 1000 G12 (secondary): https://www.vpsbenchmarks.com/hosters/netcup/plans/rs-1000-g12
