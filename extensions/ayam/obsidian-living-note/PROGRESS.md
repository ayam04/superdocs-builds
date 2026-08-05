# Progress log

## 2026-08-05

- Read the engineer task, growth task, open-task-list families, and SuperDocs API/MCP documentation.
- Chose the assigned Obsidian build instead of an optional extra so the core acceptance bar is clear.
- Decided that ownership must be a visible note-level contract, not only plugin settings.
- Implemented explicit start/end markers, strict validation, and a right-to-left owned-region replacement function.
- Implemented local source ranking, persisted source fingerprinting, no-spend preview, and opt-in source-change scheduling.
- Implemented REST client calls for base64 document upload, reference attachment upload/status, async chat, approval, job polling, and Markdown export.
- Implemented a human review modal with per-change decisions and a three-round stopping condition.
- Added target re-read protection before writing and prompt-injection language for vault source material.
- Added tests for marker integrity and preservation guarantees.
- Verified locally: `npm test` (6 passed), `npm run typecheck`, and `npm run build`.
- Live smoke-tested the authenticated SuperDocs API with synthetic data: upload, attachment processing, async edit, approval, and export all succeeded.
- Found and fixed a real integration edge: SuperDocs strips HTML ownership comments during Markdown export. The plugin now applies approved proposal fragments to the original Markdown and fails closed on ambiguous/unowned matches.

## Open verification work

- Run the plugin in a real Obsidian test vault with a SuperDocs account.
- Capture a demo showing preview, approval/rejection, a source edit, and a no-op repeat.
- Report any SuperDocs API or export issues through the task's bug channel rather than hiding them.
