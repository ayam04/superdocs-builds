import { requestUrl } from "obsidian";
import type { JobStatus, PendingChange } from "./types";

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  binary?: boolean;
}

export interface UploadedDocument {
  html?: string;
  chunks_count?: number;
  [key: string]: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class SuperDocsError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "SuperDocsError";
    this.status = status;
    this.code = code;
  }
}

export class SuperDocsClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await requestUrl({
      url: `${this.baseUrl}${path}`,
      method: options.method ?? "GET",
      headers: this.headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      let detail = "request failed";
      try {
        const parsed = JSON.parse(response.text) as { detail?: unknown; error?: unknown };
        detail = typeof parsed.detail === "string" ? parsed.detail : typeof parsed.error === "string" ? parsed.error : detail;
      } catch {
        // Avoid exposing response bodies that could contain credentials or provider details.
      }
      throw new SuperDocsError(`${detail} (HTTP ${response.status})`, response.status);
    }
    if (options.binary) return response.arrayBuffer as T;
    try {
      return response.json as T;
    } catch {
      return JSON.parse(response.text) as T;
    }
  }

  async uploadDocument(sessionId: string, filename: string, markdown: string): Promise<UploadedDocument> {
    return this.request<UploadedDocument>("/v1/documents/upload-base64", {
      method: "POST",
      body: {
        filename,
        file_base64: encodeBase64(markdown),
        session_id: sessionId,
        return_html: false,
      },
    });
  }

  async uploadReference(sessionId: string, filename: string, markdown: string): Promise<void> {
    await this.request<Record<string, unknown>>("/v1/attachments/upload-base64", {
      method: "POST",
      body: {
        filename,
        file_base64: encodeBase64(markdown),
        session_id: sessionId,
      },
    });
  }

  async waitForAttachments(sessionId: string, timeoutMs = 90_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.request<unknown>(`/v1/attachments/status/${encodeURIComponent(sessionId)}`);
      const states = attachmentStates(status);
      if (states.some((state) => state === "failed")) {
        throw new SuperDocsError("a reference attachment failed to process; no edit was started", 422, "attachment_failed");
      }
      if (states.length === 0 || states.every((state) => state === "completed")) return;
      await sleep(1_500);
    }
    throw new SuperDocsError("reference attachments did not finish processing before the preview deadline", 408, "attachment_timeout");
  }

  async startReconciliation(args: {
    sessionId: string;
    message: string;
    modelTier: string;
    thinkingDepth: string;
    crossSessionSearch: boolean;
    crossSessionMemory: boolean;
    memoryKey?: string;
  }): Promise<string> {
    const result = await this.request<{ job_id?: string }>("/v1/chat/async", {
      method: "POST",
      body: {
        message: args.message,
        session_id: args.sessionId,
        async_mode: true,
        approval_mode: "ask_every_time",
        response_mode: "full",
        model_tier: args.modelTier,
        thinking_depth: args.thinkingDepth,
        cross_session_search: args.crossSessionSearch,
        cross_session_memory: args.crossSessionMemory,
        ...(args.memoryKey ? { cross_session_memory_key: args.memoryKey } : {}),
      },
    });
    if (!result.job_id) throw new SuperDocsError("SuperDocs did not return a job id", 502, "missing_job_id");
    return result.job_id;
  }

  async getJob(jobId: string): Promise<JobStatus> {
    return this.request<JobStatus>(`/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  async approveChanges(sessionId: string, jobId: string, changes: Array<{ change_id: string; approved: boolean; feedback?: string }>): Promise<void> {
    if (changes.length === 0) return;
    await this.request(`/v1/chat/${encodeURIComponent(sessionId)}/approve`, {
      method: "POST",
      body: {
        job_id: jobId,
        approved: changes[0].approved,
        changes,
      },
    });
  }

  async waitForCompletion(jobId: string, onStatus: (status: JobStatus) => Promise<void> | void, timeoutMs = 15 * 60_000): Promise<JobStatus> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.getJob(jobId);
      await onStatus(status);
      if (["completed", "failed", "cancelled"].includes(status.status)) return status;
      await sleep(1_500);
    }
    throw new SuperDocsError("SuperDocs job exceeded the configured stopping deadline", 408, "job_timeout");
  }

  async exportMarkdown(sessionId: string): Promise<string> {
    const bytes = await this.request<ArrayBuffer>("/v1/documents/export", {
      method: "POST",
      body: { session_id: sessionId, format: "markdown", options: { filename: "living-note.md" } },
      binary: true,
    });
    return new TextDecoder().decode(bytes);
  }
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function pendingChanges(job: JobStatus): PendingChange[] {
  return job.metadata?.pending_changes ?? [];
}

function attachmentStates(value: unknown): string[] {
  const states: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if ((key === "status" || key === "state") && typeof child === "string" && ["pending", "processing", "completed", "failed"].includes(child)) {
        states.push(child);
      } else {
        visit(child);
      }
    }
  };
  visit(value);
  return states;
}
