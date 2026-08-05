# Build task

## Assigned build

Obsidian agent-maintained living note: maintain a designated note from the rest of the vault, editing only explicitly owned sections.

## Acceptance criteria

- [x] Human paragraphs outside ownership markers are preserved byte-for-byte.
- [x] Ownership boundary is explicit in the file and malformed boundaries stop before network use.
- [x] Uses SuperDocs API upload → async edit → human approval → Markdown export.
- [x] Local source retrieval plus optional SuperDocs cross-session search and memory.
- [x] Preview mode makes no network calls and spends zero operations.
- [x] Automatic sync is opt-in, source-change driven, debounced, fingerprinted, and never triggered by target output.
- [x] One bounded reconciliation per source fingerprint; no automatic continuation of a large-edit prompt.
- [x] Tests run without a live key.

## Deliberate cuts

- First release supports Markdown vault notes and lexical local retrieval rather than every Obsidian data type or a vector index.
- A large-edit continue prompt is surfaced for explicit inspection rather than auto-continued.
- Review UI is an Obsidian modal rather than a custom inline editor diff.
