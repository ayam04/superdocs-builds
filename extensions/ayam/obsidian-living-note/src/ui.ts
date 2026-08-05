import { App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import type { LivingNoteSettings, PendingChange, PreviewPlan } from "./types";

export interface ReviewDecision {
  change_id: string;
  approved: boolean;
  feedback?: string;
}

export class ReviewModal extends Modal {
  private readonly changes: PendingChange[];
  private readonly resolveDecision: (decisions: ReviewDecision[]) => void;
  private settled = false;
  private checked = new Set<string>();

  constructor(app: App, changes: PendingChange[], resolveDecision: (decisions: ReviewDecision[]) => void) {
    super(app);
    this.changes = changes;
    this.resolveDecision = resolveDecision;
    for (const change of changes) this.checked.add(change.change_id);
  }

  override onOpen(): void {
    this.titleEl.setText("Review SuperDocs living-note changes");
    this.contentEl.createEl("p", {
      text: "Only explicitly owned regions may be committed. The plugin will run a second ownership check before writing to the vault.",
      cls: "mod-warning",
    });
    const list = this.contentEl.createDiv({ cls: "superdocs-review-list" });
    for (const change of this.changes) {
      const row = list.createDiv({ cls: "superdocs-review-row" });
      const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = true;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.checked.add(change.change_id);
        else this.checked.delete(change.change_id);
      });
      const title = row.createEl("strong", { text: `${change.operation} · ${change.change_id}` });
      title.style.display = "block";
      row.createEl("small", { text: change.ai_explanation || "SuperDocs proposed a targeted change." });
      if (change.old_html || change.new_html) {
        const diff = row.createDiv({ cls: "superdocs-review-diff" });
        const before = diff.createDiv();
        before.createEl("strong", { text: "Before" });
        before.createEl("pre", { text: stripHtml(change.old_html ?? "(new section)") });
        const after = diff.createDiv();
        after.createEl("strong", { text: "After" });
        after.createEl("pre", { text: stripHtml(change.new_html ?? "(deleted)") });
      }
    }

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const approve = buttons.createEl("button", { text: "Approve selected", cls: "mod-cta" });
    approve.addEventListener("click", () => this.finish(this.changes.map((change) => ({
      change_id: change.change_id,
      approved: this.checked.has(change.change_id),
      ...(!this.checked.has(change.change_id) ? { feedback: "Rejected because this change was not selected." } : {}),
    }))));
    const reject = buttons.createEl("button", { text: "Reject all" });
    reject.addEventListener("click", () => this.finish(this.changes.map((change) => ({
      change_id: change.change_id,
      approved: false,
      feedback: "The reviewer rejected this proposed change.",
    }))));
    const cancel = buttons.createEl("button", { text: "Cancel and reject" });
    cancel.addEventListener("click", () => this.finish(this.changes.map((change) => ({
      change_id: change.change_id,
      approved: false,
      feedback: "The review was cancelled; do not retry automatically.",
    }))));
  }

  override onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolveDecision(this.changes.map((change) => ({
        change_id: change.change_id,
        approved: false,
        feedback: "The review window closed; do not apply this change.",
      })));
    }
    this.contentEl.empty();
  }

  private finish(decisions: ReviewDecision[]): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveDecision(decisions);
    this.close();
  }
}

export function reviewChanges(app: App, changes: PendingChange[]): Promise<ReviewDecision[]> {
  return new Promise((resolve) => new ReviewModal(app, changes, resolve).open());
}

export class PreviewModal extends Modal {
  private readonly plan: PreviewPlan;
  constructor(app: App, plan: PreviewPlan) {
    super(app);
    this.plan = plan;
  }
  override onOpen(): void {
    this.titleEl.setText("Living-note no-spend preview");
    this.contentEl.createEl("p", { text: `Target: ${this.plan.targetPath}` });
    this.contentEl.createEl("p", { text: `Owned regions: ${this.plan.regions.join(", ")}` });
    this.contentEl.createEl("p", { text: `Source fingerprint: ${this.plan.sourceFingerprint.hash}` });
    this.contentEl.createEl("p", { text: "This preview made no SuperDocs calls and spent zero operations." });
    const list = this.contentEl.createEl("ul");
    for (const source of this.plan.sources) list.createEl("li", { text: `${source.path} (local relevance ${source.score})` });
    this.contentEl.createEl("h4", { text: "Would send" });
    this.contentEl.createEl("pre", { text: this.plan.prompt });
    const close = this.contentEl.createEl("button", { text: "Close", cls: "mod-cta" });
    close.addEventListener("click", () => this.close());
  }
}

export class LivingNoteSettingTab extends PluginSettingTab {
  private readonly settings: LivingNoteSettings;
  private readonly save: () => Promise<void>;

  constructor(app: App, plugin: { settings: LivingNoteSettings; saveSettings: () => Promise<void> }) {
    super(app, plugin as never);
    this.settings = plugin.settings;
    this.save = plugin.saveSettings;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "SuperDocs Living Note" });
    containerEl.createEl("p", { text: "The plugin only writes between explicit superdocs:owned markers. It never rewrites the rest of the file." });

    new Setting(containerEl).setName("SuperDocs API key").setDesc("Stored in Obsidian's local plugin data; never logged or committed.")
      .addText((text) => text.setPlaceholder("sk_…").setValue(this.settings.apiKey).onChange(async (value) => { this.settings.apiKey = value.trim(); await this.save(); }));
    new Setting(containerEl).setName("API base URL").addText((text) => text.setValue(this.settings.baseUrl).onChange(async (value) => { this.settings.baseUrl = value.trim() || "https://api.superdocs.app"; await this.save(); }));
    new Setting(containerEl).setName("Designated note").setDesc("Vault-relative path, for example Notes/living.md.")
      .addText((text) => text.setValue(this.settings.targetPath).onChange(async (value) => { this.settings.targetPath = value.trim(); await this.save(); }));
    new Setting(containerEl).setName("Source folders").setDesc("Comma-separated folders. Leave blank to search all Markdown notes except the target.")
      .addText((text) => text.setValue(this.settings.sourceFolders.join(", ")).onChange(async (value) => { this.settings.sourceFolders = splitList(value); await this.save(); }));
    new Setting(containerEl).setName("Maximum source notes").addSlider((slider) => slider.setLimits(1, 20, 1).setValue(this.settings.maxSources).setDynamicTooltip().onChange(async (value) => { this.settings.maxSources = value; await this.save(); }));
    new Setting(containerEl).setName("Automatic sync").setDesc("Runs only after a source note changes; the target note never triggers itself.")
      .addToggle((toggle) => toggle.setValue(this.settings.autoSync).onChange(async (value) => { this.settings.autoSync = value; await this.save(); }));
    new Setting(containerEl).setName("Refresh interval (minutes)").addText((text) => text.setValue(String(this.settings.refreshIntervalMinutes)).onChange(async (value) => { const n = Number(value); if (Number.isFinite(n) && n >= 1) this.settings.refreshIntervalMinutes = Math.floor(n); await this.save(); }));
    new Setting(containerEl).setName("Cross-session search").setDesc("Let SuperDocs search prior documents/sessions owned by this API key.")
      .addToggle((toggle) => toggle.setValue(this.settings.enableCrossSessionSearch).onChange(async (value) => { this.settings.enableCrossSessionSearch = value; await this.save(); }));
    new Setting(containerEl).setName("Cross-session memory").setDesc("Keep an opt-in, owner-scoped memory of accepted preferences.")
      .addToggle((toggle) => toggle.setValue(this.settings.enableCrossSessionMemory).onChange(async (value) => { this.settings.enableCrossSessionMemory = value; await this.save(); }));
    new Setting(containerEl).setName("Memory key (optional)").setDesc("Use a stable key if one API key serves multiple vaults.")
      .addText((text) => text.setValue(this.settings.memoryKey).onChange(async (value) => { this.settings.memoryKey = value.trim(); await this.save(); }));
    new Setting(containerEl).setName("Model tier").addDropdown((dropdown) => dropdown.addOptions({ core: "Core", turbo: "Turbo", pro: "Pro", max: "Max" }).setValue(this.settings.modelTier).onChange(async (value) => { this.settings.modelTier = value as LivingNoteSettings["modelTier"]; await this.save(); }));
    new Setting(containerEl).setName("Thinking depth").addDropdown((dropdown) => dropdown.addOptions({ fast: "Fast", balanced: "Balanced", deep: "Deep" }).setValue(this.settings.thinkingDepth).onChange(async (value) => { this.settings.thinkingDepth = value as LivingNoteSettings["thinkingDepth"]; await this.save(); }));
  }
}

function splitList(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function stripHtml(value: string): string {
  const div = document.createElement("div");
  div.innerHTML = value;
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : "The living-note run failed for an unknown reason.";
  new Notice(`SuperDocs Living Note: ${message}`, 10_000);
}
