import { Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, type JobStatus, type LivingNoteSettings, type PendingChange } from "./types";
import { createPreviewPlan, eligibleSourceFiles, fingerprintFiles, sourceContext } from "./retrieval";
import { applyApprovedChanges, ownershipPrompt, parseOwnership } from "./ownership";
import { pendingChanges, SuperDocsClient } from "./superdocs";
import { LivingNoteSettingTab, PreviewModal, reviewChanges, showError } from "./ui";

interface PersistedState {
  lastProcessedSourceFingerprint?: string;
  lastSuccessfulRunAt?: number;
}

export default class SuperDocsLivingNotePlugin extends Plugin {
  override settings: LivingNoteSettings = { ...DEFAULT_SETTINGS };
  private state: PersistedState = {};
  private running = false;
  private debounceTimer?: number;
  private statusBar!: HTMLElement;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.statusBar = this.addStatusBarItem();
    this.setStatus("idle");
    this.addSettingTab(new LivingNoteSettingTab(this.app, this));

    this.addCommand({ id: "set-active-note-as-designated", name: "Set active note as designated living note", callback: async () => {
      const file = this.app.workspace.getActiveFile();
      if (!file) return new Notice("Open a Markdown note first.");
      this.settings.targetPath = file.path;
      await this.saveSettings();
      new Notice(`Living note set to ${file.path}`);
    }});
    this.addCommand({ id: "initialize-owned-region", name: "Initialize an owned region in the designated note", callback: () => void this.initializeOwnedRegion() });
    this.addCommand({ id: "preview-living-note", name: "Preview living-note update (no spend)", callback: () => void this.run(true, "manual preview") });
    this.addCommand({ id: "sync-living-note", name: "Sync designated living note now", callback: () => void this.run(false, "manual sync") });

    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!this.settings.autoSync || !(file instanceof TFile) || file.extension !== "md") return;
      if (file.path === this.settings.targetPath) return; // Never self-trigger on our own output.
      if (!this.isEligibleSource(file.path)) return;
      this.scheduleAutomaticRun();
    }));
    this.registerInterval(window.setInterval(() => {
      if (this.settings.autoSync) void this.checkForChangedSources();
    }, Math.max(1, this.settings.refreshIntervalMinutes) * 60_000));
  }

  override async onunload(): Promise<void> {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    await this.saveSettings();
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData() as { settings?: Partial<LivingNoteSettings>; state?: PersistedState } | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(saved?.settings ?? {}) };
    this.state = saved?.state ?? {};
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ settings: this.settings, state: this.state });
  }

  private async initializeOwnedRegion(): Promise<void> {
    const target = await this.targetFile();
    if (!target) return;
    const current = await this.app.vault.read(target);
    if (!parseOwnership(current).errors.every((error) => error === "no owned regions found; add at least one SuperDocs ownership marker")) {
      new Notice("This note already has ownership markers or a malformed marker pair; no changes made.");
      return;
    }
    const block = [
      "",
      "<!-- superdocs:owned:start id=\"vault-summary\" -->",
      "## SuperDocs-owned: vault summary",
      "_This section is maintained by SuperDocs. Edit the surrounding note freely; this block is the agent's boundary._",
      "<!-- superdocs:owned:end id=\"vault-summary\" -->",
      "",
    ].join("\n");
    await this.app.vault.modify(target, current + block);
    new Notice("Added the explicit vault-summary ownership boundary. Add your source notes, then run a no-spend preview.");
  }

  private async targetFile(): Promise<TFile | null> {
    if (!this.settings.targetPath) {
      new Notice("Choose a designated note in Settings or run 'Set active note as designated living note'.");
      return null;
    }
    const file = this.app.vault.getAbstractFileByPath(this.settings.targetPath);
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice(`Designated note not found: ${this.settings.targetPath}`);
      return null;
    }
    return file;
  }

  private isEligibleSource(path: string): boolean {
    if (path === this.settings.targetPath || path.startsWith(".obsidian/") || path.startsWith(".trash/")) return false;
    if (this.settings.sourceFolders.length === 0) return true;
    return this.settings.sourceFolders.some((folder) => path === folder || path.startsWith(`${folder.replace(/\/$/, "")}/`));
  }

  private scheduleAutomaticRun(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = undefined;
      void this.run(false, "source note changed");
    }, 2_000);
  }

  private async checkForChangedSources(): Promise<void> {
    if (this.running) return;
    const files = eligibleSourceFiles(this.app, this.settings.targetPath, this.settings.sourceFolders);
    const fingerprint = fingerprintFiles(files.map((file) => ({ path: file.path, mtime: file.stat.mtime, size: file.stat.size })));
    if (fingerprint.hash && fingerprint.hash !== this.state.lastProcessedSourceFingerprint) {
      await this.run(false, "scheduled source check");
    }
  }

  private async run(preview: boolean, reason: string): Promise<void> {
    if (this.running) {
      new Notice("A living-note run is already in progress; this run was not queued.");
      return;
    }
    this.running = true;
    this.setStatus(preview ? "preview" : "working");
    try {
      const target = await this.targetFile();
      if (!target) return;
      const original = await this.app.vault.read(target);
      const ownership = parseOwnership(original);
      if (ownership.errors.length) throw new Error(ownership.errors.join("; "));

      const plan = await createPreviewPlan(
        this.app,
        target.path,
        this.settings.sourceFolders,
        ownership.regions,
        original,
        this.settings.maxSources,
      );
      if (preview || this.settings.previewOnly) {
        new PreviewModal(this.app, plan).open();
        return;
      }
      if (!this.settings.apiKey.trim()) throw new Error("Set a SuperDocs API key in Settings before starting a paid run.");
      if (plan.sourceFingerprint.hash === this.state.lastProcessedSourceFingerprint && reason !== "manual sync") {
        this.setStatus("idle");
        return;
      }

      const sessionId = `obsidian-living-${safeHash(`${target.path}:${plan.sourceFingerprint.hash}`)}`;
      const client = new SuperDocsClient(this.settings.baseUrl, this.settings.apiKey.trim());
      await client.uploadDocument(sessionId, target.name, original);
      for (const source of plan.sources) await client.uploadReference(sessionId, source.path, source.content);
      await client.waitForAttachments(sessionId);

      const message = [
        ownershipPrompt(ownership.regions),
        `The designated Obsidian note is '${target.path}'. Reconcile it once from the attached vault notes.`,
        `Relevant source files selected locally: ${plan.sources.map((source) => source.path).join(", ") || "none"}.`,
        "Use the attached files as evidence. Do not create a new document, do not change unowned text, and do not run another reconciliation after this one.",
        "If no owned content needs changing, return no proposed changes and say that the note is already current.",
        "The following source index is only a routing hint; the attached files are authoritative:\n" + sourceContext(plan.sources).slice(0, 40_000),
      ].join("\n\n");
      const jobId = await client.startReconciliation({
        sessionId,
        message,
        modelTier: this.settings.modelTier,
        thinkingDepth: this.settings.thinkingDepth,
        crossSessionSearch: this.settings.enableCrossSessionSearch,
        crossSessionMemory: this.settings.enableCrossSessionMemory,
        memoryKey: this.settings.memoryKey || undefined,
      });

      let reviewRounds = 0;
      const approvedChanges: PendingChange[] = [];
      let finalStatus: JobStatus | undefined;
      while (!finalStatus) {
        const status = await client.getJob(jobId);
        if (status.status === "awaiting_approval") {
          if (status.metadata?.awaiting_kind === "continue_prompt") {
            throw new Error("SuperDocs paused for a large-edit continue prompt. The plugin will not spend again automatically; inspect the job in SuperDocs before continuing.");
          }
          const changes = pendingChanges(status);
          if (!changes.length) throw new Error("SuperDocs reported approval without a pending change list.");
          reviewRounds++;
          if (reviewRounds > 3) throw new Error("The review loop reached its three-round stopping condition; no further proposals were requested.");
          const decisions = await reviewChanges(this.app, changes);
          for (const decision of decisions) {
            if (decision.approved) {
              const approved = changes.find((change) => change.change_id === decision.change_id);
              if (approved) approvedChanges.push(approved);
            }
          }
          await client.approveChanges(sessionId, jobId, decisions);
          continue;
        }
        if (["completed", "failed", "cancelled"].includes(status.status)) {
          finalStatus = status;
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
      }
      if (finalStatus.status !== "completed") throw new Error(formatJobError(finalStatus));

      // Export is deliberately part of the contract and is retained as the user's
      // downloadable artifact. SuperDocs strips Markdown comments during parsing,
      // so local application uses the approved proposal fragments, not whole-file export.
      await client.exportMarkdown(sessionId);
      const currentTarget = await this.app.vault.read(target);
      if (currentTarget !== original) throw new Error("The designated note changed while the review was open; nothing was written. Run again against the newer note.");
      const safeUpdated = applyApprovedChanges(original, approvedChanges);
      if (safeUpdated !== original) await this.app.vault.modify(target, safeUpdated);
      this.state.lastProcessedSourceFingerprint = plan.sourceFingerprint.hash;
      this.state.lastSuccessfulRunAt = Date.now();
      await this.saveSettings();
      this.setStatus("idle");
      new Notice(safeUpdated === original ? "Living note is already current; no write was made." : "Living note updated. Human-approved changes were applied only inside owned regions.");
    } catch (error) {
      this.setStatus("error");
      showError(error);
    } finally {
      this.running = false;
    }
  }

  private setStatus(status: "idle" | "preview" | "working" | "error"): void {
    if (!this.statusBar) return;
    this.statusBar.setText(`Living note: ${status}`);
    this.statusBar.setAttr("aria-label", "SuperDocs Living Note status");
  }
}

function safeHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function formatJobError(job: JobStatus): string {
  if (typeof job.error === "string") return `SuperDocs job ${job.status}: ${job.error}`;
  return `SuperDocs job ${job.status}: ${job.error?.message ?? "no additional error details"}`;
}
