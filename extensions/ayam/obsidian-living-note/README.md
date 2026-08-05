# SuperDocs Living Note for Obsidian

> Built by Ayam for the SuperDocs task.

An Obsidian plugin that keeps a designated Markdown note current from the rest of a vault through the SuperDocs API. The key design decision is visible ownership: the agent can write only between `superdocs:owned` markers. Human prose remains outside that boundary and is preserved byte-for-byte.

## What it does

1. Select a designated note, or run **Set active note as designated living note**.
2. Add one or more explicit ownership regions:

   ```md
   <!-- superdocs:owned:start id="vault-summary" -->
   ## SuperDocs-owned: vault summary
   <!-- content maintained by the agent -->
   <!-- superdocs:owned:end id="vault-summary" -->
   ```

   The marker comments are part of the file contract. The plugin refuses to run if markers are missing, duplicated, nested, or unclosed.
3. Configure optional source folders. With no folder configured, all Markdown notes except the target are eligible.
4. Run **Preview living-note update (no spend)** first. Preview performs only local retrieval and reports the source fingerprint; it never calls SuperDocs or spends an operation.
5. Run **Sync designated living note now**. The plugin locally ranks relevant vault notes, uploads the target as the active SuperDocs document, uploads selected notes as read-only reference attachments, and starts one asynchronous `ask_every_time` edit.
6. Review each proposed change in Obsidian. Approve or reject changes item by item. A maximum of three approval rounds is enforced.
7. The plugin exports the reviewed document as Markdown for the finished artifact, then applies the approved proposal fragments against the original Markdown. SuperDocs strips HTML ownership comments during parsing/export, so the plugin does not trust a whole-document export for write-back. It re-reads the target before writing; if the target changed while review was open, it aborts instead of overwriting the user's work.

## Setup

### 1. Get a key

Create an API key at [use.superdocs.app](https://use.superdocs.app), or use the builder promotion code supplied with the task in the web app. Never put the key in this repository. The plugin stores it in Obsidian's local plugin data and never logs it.

### 2. Build

Requirements: Node.js 18+ and an Obsidian desktop/mobile development vault.

```bash
npm install
npm test
npm run typecheck
npm run build
```

For local development:

```bash
npm run dev
```

Copy `manifest.json` and `main.js` into `<vault>/.obsidian/plugins/superdocs-living-note/`, enable the plugin, and open its settings. A packaged release should include exactly those two files (plus this README and any license material).

## Commands

- **Set active note as designated living note** — points the plugin at the currently open Markdown note.
- **Initialize an owned region in the designated note** — adds a safe starter region only when the note has no ownership markers.
- **Preview living-note update (no spend)** — local retrieval and plan only.
- **Sync designated living note now** — one bounded API reconciliation with human review.

Automatic sync is opt-in. When enabled, only changes to eligible source notes schedule a run. The designated target is explicitly ignored by the modify listener, so the plugin never triggers itself from its own output. A source fingerprint is persisted after a successful run; the automatic path will not run twice for the same source state. A run is one reconciliation, not an open-ended agent loop.

## SuperDocs surfaces used

- **API**: base64 document upload, reference attachment upload, async chat, HITL approval, and Markdown export.
- **Search**: local deterministic vault retrieval selects relevant notes; optional `cross_session_search` lets SuperDocs search prior documents and chats owned by the configured key.
- **Memory**: optional owner-scoped `cross_session_memory`, with an optional `memoryKey` for separating multiple vaults.
- **Review**: `approval_mode: "ask_every_time"`; a denial with feedback can produce a new review round.
- **Export**: final Markdown is exported only after approval and is never used to replace the whole Obsidian file.

The API session id is derived from the target path and source fingerprint. This prevents stale reference attachments from being reused across source states while allowing the API's cross-session search/memory features to work.

## Safety and stopping rules

- **Ownership boundary**: malformed or missing boundaries stop the run before an API call.
- **Human gate**: no proposed change is committed until the reviewer decides it.
- **Second safety check**: approved HTML fragments are matched against exactly one occurrence inside an original owned region; ambiguous or unlocatable changes fail closed, and `assertNoUnownedChange` rejects any candidate that differs outside the markers. SuperDocs' export is treated as a deliverable, not a whole-file write source, because the service strips Markdown comments.
- **Concurrent edit protection**: the target is re-read before write and the run aborts if a user changed it during review.
- **Prompt-injection resistance**: vault notes are labelled untrusted source material; instructions in them are evidence to summarize, never commands.
- **No self-trigger**: target modifications are excluded from automatic scheduling and the source fingerprint excludes the target.
- **Bounded loop**: one reconciliation per source fingerprint and at most three approval rounds. Large-edit continue prompts are not auto-continued.
- **No-spend mode**: preview performs no network call and no API operation.

## Test claims

The tests run without a live API key and cover the dangerous part of this integration: valid markers, malformed boundaries, exact preservation of human bytes, omitted-marker rejection, and unowned-change rejection. The integration is deliberately not presented as tested against a live account in CI.

## Honest limitations

- Obsidian's Markdown renderer and SuperDocs' Markdown export are external formatters. SuperDocs also strips HTML comments during parsing/export; the plugin uses approved proposal fragments for safe write-back. Its guarantee is about vault bytes outside owned regions, not about byte-identical formatting inside an owned region.
- The first version searches Markdown notes with a local lexical ranker. It does not claim semantic retrieval over every Obsidian plugin data type. SuperDocs search/memory are opt-in account-scoped features and do not automatically index an entire local vault.
- Attachments are uploaded to the configured SuperDocs account for the session. Use synthetic/public notes for demos and follow the account's data-hosting judgement.
- A large-edit continue prompt is surfaced rather than automatically continued. This is intentional: continuing spends more work and crosses the plugin's explicit stopping boundary.
- The plugin does not sign, publish, or send documents. Human review remains required.

## Demo checklist

Use `examples/living-note.md` and a small synthetic vault. Record:

1. Preview with zero spend.
2. A source-note edit producing a proposal.
3. One approved and one rejected proposal.
4. The final note showing the owned block changed and both human paragraphs unchanged.
5. A source edit containing a prompt-injection-like sentence; show it treated as source data.
6. A second run with no source change; show the persisted fingerprint prevents an automatic duplicate.

Screenshot/demo link: add after recording.
