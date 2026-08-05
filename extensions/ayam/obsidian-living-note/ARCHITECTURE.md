# Architecture

```mermaid
flowchart LR
  V[Obsidian vault] -->|source note changed| W[bounded watcher]
  W --> F[source fingerprint]
  F --> R[local lexical retrieval]
  R --> P{no-spend preview?}
  P -- yes --> PM[preview modal; zero API calls]
  P -- no --> U[SuperDocs document upload]
  R --> A[SuperDocs reference attachments]
  U --> C[async chat_async\nask_every_time]
  A --> C
  C --> J[job polling]
  J --> H[Obsidian review modal\napprove/reject each change]
  H --> J
  J --> E[SuperDocs Markdown export]
  E --> S[ownership + concurrency safety checks]
  S -->|owned regions only| T[modify target note]
  S -->|unsafe / stale| X[abort, write nothing]
  M[(persisted fingerprint + settings)] --- F
  M --- W
  C -. optional opt-in .-> MS[(cross-session search + memory)]
  T -. target change ignored .-> W
```

## Invariants

1. The watcher is triggered by source changes only; target output never feeds its own trigger.
2. A source fingerprint is processed at most once on the automatic path.
3. SuperDocs receives an explicit ownership prompt and untrusted-source warning.
4. Human approval precedes export and local write.
5. `replaceOwnedRegions` requires all original markers in the exported response and preserves all bytes outside their content ranges.
6. The target is re-read before write; concurrent human edits abort the commit.
