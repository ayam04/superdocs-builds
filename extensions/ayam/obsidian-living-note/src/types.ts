export interface LivingNoteSettings {
  apiKey: string;
  baseUrl: string;
  targetPath: string;
  sourceFolders: string[];
  maxSources: number;
  refreshIntervalMinutes: number;
  autoSync: boolean;
  previewOnly: boolean;
  enableCrossSessionSearch: boolean;
  enableCrossSessionMemory: boolean;
  memoryKey: string;
  modelTier: "core" | "turbo" | "pro" | "max";
  thinkingDepth: "fast" | "balanced" | "deep";
}

export const DEFAULT_SETTINGS: LivingNoteSettings = {
  apiKey: "",
  baseUrl: "https://api.superdocs.app",
  targetPath: "",
  sourceFolders: [],
  maxSources: 8,
  refreshIntervalMinutes: 30,
  autoSync: false,
  previewOnly: false,
  enableCrossSessionSearch: true,
  enableCrossSessionMemory: true,
  memoryKey: "",
  modelTier: "pro",
  thinkingDepth: "balanced",
};

export interface SourceNote {
  path: string;
  title: string;
  content: string;
  score: number;
  modified: number;
}

export interface SourceFingerprint {
  hash: string;
  files: Array<{ path: string; mtime: number; size: number }>;
}

export interface OwnershipRegion {
  id: string;
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
}

export interface OwnershipValidation {
  regions: OwnershipRegion[];
  errors: string[];
}

export interface PendingChange {
  change_id: string;
  operation: "edit" | "create" | "delete" | string;
  chunk_id?: string | null;
  old_html?: string | null;
  new_html?: string | null;
  insert_after_chunk_id?: string | null;
  ai_explanation?: string;
  document_id?: string;
}

export interface JobResult {
  response?: string;
  document_changes?: {
    updated_html?: string;
    chunk_diffs?: unknown[];
  };
  usage?: Record<string, unknown>;
}

export interface JobStatus {
  status: "pending" | "in_progress" | "awaiting_approval" | "completed" | "failed" | "cancelled" | string;
  result?: JobResult;
  metadata?: {
    awaiting_kind?: "continue_prompt" | string;
    pending_changes?: PendingChange[];
    pending_batch_decisions?: Record<string, { approved: boolean; feedback?: string }>;
  };
  error?: { message?: string; code?: string } | string;
  progress?: unknown;
}

export interface PreviewPlan {
  targetPath: string;
  regions: string[];
  sources: SourceNote[];
  sourceFingerprint: SourceFingerprint;
  prompt: string;
}
