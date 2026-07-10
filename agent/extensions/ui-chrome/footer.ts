import { complete, type UserMessage } from "@earendil-works/pi-ai";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";

const CHATGPT_BASE_URL = (process.env.CHATGPT_BASE_URL || "https://chatgpt.com/backend-api").replace(/\/+$/, "");
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";
const FIVE_HOUR_SECONDS = 5 * 60 * 60;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const TITLE_MODEL_PROVIDER = process.env.PI_TITLE_MODEL_PROVIDER ?? "openai-codex";
const TITLE_MODEL_ID = process.env.PI_TITLE_MODEL_ID ?? "gpt-5.4-mini";
const TITLE_SYSTEM_PROMPT = `Generate a short title for this coding-agent chat.

Rules:
- output only the title
- 2-6 words
- all lowercase
- no quotes, punctuation, or prefix
- describe the actual task/outcome, not the user's wording
- prefer concrete file/component names when useful`;

let usageSnapshot: ChatGptUsageSnapshot | undefined;
let generatedTitle: string | undefined;
let generatedTitleSessionKey: string | undefined;
let requestRender: () => void = () => {};
let inFlight: Promise<unknown> = Promise.resolve();
let titleInFlight: Promise<unknown> = Promise.resolve();

type UsageWindow = {
  usedPercent: number;
  windowSeconds: number;
  resetAt?: number;
};

type ChatGptUsageSnapshot = {
  fiveHour?: UsageWindow;
  weekly?: UsageWindow;
  fetchedAt: number;
};

declare global {
  var __piFirecrawlUsage:
    | {
        remainingCredits?: number;
        planCredits?: number;
        billingPeriodStart?: string;
        billingPeriodEnd?: string;
        creditsUsed?: number;
        expiresAt: number;
      }
    | undefined;
  var __piRequestFooterRender: (() => void) | undefined;
  var __piSubagentCounts: Record<string, number> | undefined;
  var __piBetterGptFastStatus: "fast" | "fast requested" | undefined;
}

function formatSubagentCounts() {
  const counts = globalThis.__piSubagentCounts;
  if (!counts) return "";
  const parts = ["scout", "researcher"]
    .map((name) => [name, counts[name] ?? 0] as const)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name} ${count}`);
  return parts.join(" · ");
}

function contextColor(percent: number) {
  if (percent >= 70) return "error" as const;
  if (percent >= 50) return "warning" as const;
  if (percent >= 30) return "success" as const;
  return "accent" as const;
}

function fallbackLimitColor(percent: number) {
  if (percent >= 90) return "error" as const;
  if (percent >= 80) return "warning" as const;
  return "dim" as const;
}

function pacedLimitColor(window: UsageWindow | undefined) {
  if (!window?.resetAt) return fallbackLimitColor(window?.usedPercent ?? 0);

  const nowSeconds = Date.now() / 1000;
  const remainingSeconds = Math.max(0, window.resetAt - nowSeconds);
  const elapsedSeconds = Math.max(0, Math.min(window.windowSeconds, window.windowSeconds - remainingSeconds));
  const expectedPercent = (elapsedSeconds / window.windowSeconds) * 100;

  // Grace prevents tiny early-window usage from immediately looking bad.
  const grace = window.windowSeconds <= FIVE_HOUR_SECONDS + 120 ? 5 : 3;
  const warningOverage = 10;
  const allowed = expectedPercent + grace;
  const actual = Math.max(0, Math.min(100, window.usedPercent));

  if (actual <= allowed) return "success" as const;
  if (actual <= allowed + warningOverage) return "warning" as const;
  return "error" as const;
}

function isOpenAICodexProvider(provider?: string) {
  return provider === "openai-codex" || /^openai-codex-\d+$/.test(provider || "");
}

type CmuxTabTarget = { workspace?: string; tab?: string; surface?: string };

function hasCmuxTabTarget() {
  return Boolean(process.env.CMUX_TAB_ID || process.env.CMUX_SURFACE_ID || process.env.CMUX_WORKSPACE_ID || process.env.CMUX_SOCKET_PATH);
}

function stringField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function cmuxTargetFromIdentify(stdout: string): CmuxTabTarget | undefined {
  try {
    const data = JSON.parse(stdout) as { caller?: unknown; focused?: unknown };
    const caller = asRecord(data.caller);
    const focused = asRecord(data.focused);
    const source = caller ?? focused;
    if (!source) return undefined;

    return {
      workspace: stringField(source, "workspace_ref") || stringField(source, "workspace_id"),
      tab: stringField(source, "tab_ref") || stringField(source, "tab_id"),
      surface: stringField(source, "surface_ref") || stringField(source, "surface_id"),
    };
  } catch {
    return undefined;
  }
}

function cmuxTargetFromEnv(): CmuxTabTarget {
  return {
    workspace: process.env.CMUX_WORKSPACE_ID,
    tab: process.env.CMUX_TAB_ID,
    surface: process.env.CMUX_SURFACE_ID,
  };
}

function renameCmuxTab(title: string, target: CmuxTabTarget | undefined) {
  const args = ["rename-tab"];
  if (target?.workspace) args.push("--workspace", target.workspace);

  // Prefer surface when available: some cmux environments expose CMUX_TAB_ID as
  // the workspace id, which makes --tab target the wrong thing.
  if (target?.surface) args.push("--surface", target.surface);
  else if (target?.tab) args.push("--tab", target.tab);
  else return;

  args.push("--", title);

  execFile("cmux", args, { timeout: 5000 }, () => {
    // Best-effort integration: ignore failures when cmux CLI/socket is unavailable.
  });
}

function setCmuxTabName(title: string) {
  if (!hasCmuxTabTarget()) return;

  execFile("cmux", ["identify"], { timeout: 3000 }, (error, stdout) => {
    const target = !error && typeof stdout === "string" ? cmuxTargetFromIdentify(stdout) : undefined;
    renameCmuxTab(title, target ?? cmuxTargetFromEnv());
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalizeWindow(value: unknown): UsageWindow | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const usedPercent = typeof record.used_percent === "number" ? record.used_percent : undefined;
  const windowSeconds = typeof record.limit_window_seconds === "number" ? record.limit_window_seconds : undefined;
  const resetAt = typeof record.reset_at === "number" ? record.reset_at : undefined;

  if (usedPercent === undefined || windowSeconds === undefined) return undefined;
  return { usedPercent, windowSeconds, resetAt };
}

function parseUsageSnapshot(data: unknown): ChatGptUsageSnapshot {
  const raw = asRecord(data);
  const rateLimit = asRecord(raw?.rate_limit);
  const windows = [
    normalizeWindow(rateLimit?.primary_window),
    normalizeWindow(rateLimit?.secondary_window),
  ].filter((window): window is UsageWindow => Boolean(window));

  return {
    fiveHour: windows.find((window) => Math.abs(window.windowSeconds - FIVE_HOUR_SECONDS) <= 120),
    weekly: windows.find((window) => Math.abs(window.windowSeconds - WEEK_SECONDS) <= 120),
    fetchedAt: Date.now(),
  };
}

function decodeJwtPayload(token: string) {
  const parts = token.split(".");
  if (parts.length < 2) return {};

  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function getChatGptAccountId(token: string) {
  const payload = asRecord(decodeJwtPayload(token));
  const auth = asRecord(payload?.[OPENAI_AUTH_CLAIM]);
  return typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined;
}

function formatLimit(label: string, window: UsageWindow | undefined, theme: any) {
  if (!window) return undefined;
  const percent = Math.round(Math.max(0, Math.min(100, window.usedPercent)));
  return `${theme.fg("dim", `${label} `)}${theme.fg(pacedLimitColor(window), `${percent}%`)}`;
}

function formatResetTime(resetAt: number | undefined) {
  if (!resetAt) return "unknown";

  const resetMs = resetAt * 1000;
  const remainingMs = Math.max(0, resetMs - Date.now());
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const relative = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  return `${new Date(resetMs).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} (${relative})`;
}

function formatUsageBar(window: UsageWindow | undefined, label: string, theme: any) {
  if (!window) return `${theme.fg("dim", label.padEnd(7))} ${theme.fg("error", "usage unavailable")}`;

  const percent = Math.round(Math.max(0, Math.min(100, window.usedPercent)));
  const cells = 28;
  const filled = Math.round((percent / 100) * cells);
  const empty = Math.max(0, cells - filled);
  const color = pacedLimitColor(window);
  const bar = `${theme.fg(color, "█".repeat(filled))}${theme.fg("dim", "░".repeat(empty))}`;

  return [
    `${theme.fg("dim", label.padEnd(7))} ${bar} ${theme.fg(color, `${String(percent).padStart(3)}%`)}`,
    `${theme.fg("dim", "       resets ")}${theme.fg("dim", formatResetTime(window.resetAt))}`,
  ].join("\n");
}

function formatUsagePanel(theme: any) {
  return [
    theme.fg("dim", "╭─ usage limits ─────────────────────────╮"),
    formatUsageBar(usageSnapshot?.fiveHour, "5-hour", theme),
    theme.fg("dim", "├────────────────────────────────────────╯"),
    formatUsageBar(usageSnapshot?.weekly, "weekly", theme),
  ].join("\n");
}

function formatChatGptLimits(theme: any) {
  const fiveHour = formatLimit("5h", usageSnapshot?.fiveHour, theme);
  const weekly = formatLimit("W", usageSnapshot?.weekly, theme);
  const parts = [fiveHour, weekly].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(theme.fg("dim", " · ")) : undefined;
}

function formatContextBar(percent: number | undefined, theme: any) {
  if (percent === undefined) return theme.fg("dim", "?%");

  const safePercent = Math.max(0, Math.min(100, percent));
  const cells = 8;
  const filled = Math.round((safePercent / 100) * cells);
  const empty = Math.max(0, cells - filled);

  return [
    theme.fg(contextColor(safePercent), "█".repeat(filled)),
    theme.fg("dim", "░".repeat(empty)),
    theme.fg(contextColor(safePercent), ` ${safePercent}%`),
  ].join("");
}

function firecrawlColor(snapshot: NonNullable<typeof globalThis.__piFirecrawlUsage>) {
  const remaining = snapshot.remainingCredits;
  const plan = snapshot.planCredits;
  const start = snapshot.billingPeriodStart ? Date.parse(snapshot.billingPeriodStart) : NaN;
  const end = snapshot.billingPeriodEnd ? Date.parse(snapshot.billingPeriodEnd) : NaN;

  if (typeof remaining !== "number" || typeof plan !== "number" || plan <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    const remainingPercent = typeof remaining === "number" && typeof plan === "number" && plan > 0 ? (remaining / plan) * 100 : 100;
    if (remainingPercent <= 10) return "error" as const;
    if (remainingPercent <= 20) return "warning" as const;
    return "success" as const;
  }

  const now = Date.now();
  const elapsedPercent = (Math.max(0, Math.min(end - start, now - start)) / (end - start)) * 100;
  const usedPercent = ((plan - remaining) / plan) * 100;
  const allowed = elapsedPercent + 3;

  if (usedPercent <= allowed) return "success" as const;
  if (usedPercent <= allowed + 10) return "warning" as const;
  return "error" as const;
}

function formatCompactCredits(count: number) {
  if (count < 1000) return `${Math.round(count)}`;
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(count >= 10000000 ? 0 : 1)}M`;
}

function formatFirecrawlUsage(theme: any) {
  const snapshot = globalThis.__piFirecrawlUsage;
  if (!snapshot || snapshot.expiresAt <= Date.now()) return undefined;
  if (typeof snapshot.remainingCredits === "number") {
    return `${theme.fg("dim", "fc ")}${theme.fg(firecrawlColor(snapshot), formatCompactCredits(snapshot.remainingCredits))}`;
  }
  if (typeof snapshot.creditsUsed === "number") return theme.fg("dim", `fc used ${formatCompactCredits(snapshot.creditsUsed)}`);
  return undefined;
}

function contentText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
        return String((part as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function compactPlainText(text: string, maxLength: number) {
  const compacted = text.replace(/\s+/g, " ").trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 1)}…` : compacted;
}

function normalizeFooterTitle(text: string | undefined) {
  if (!text) return "";
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^(?:title|chat title|session title)\s*:\s*/i, "")
    .replace(/^[-*\d.)\s]+/, "")
    .replace(/^["'“”‘’`]+|["'“”‘’`.!?:;,-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function titleSessionKey(ctx: ExtensionContext) {
  return ctx.sessionManager.getSessionFile() ?? ctx.sessionManager.getSessionId();
}

function conversationForTitle(ctx: ExtensionContext) {
  const chunks: string[] = [];

  for (const entry of ctx.sessionManager.getBranch()) {
    const message = entry.type === "message" ? entry.message : undefined;
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue;

    const text = compactPlainText(contentText(message.content), message.role === "assistant" ? 1200 : 800);
    if (text) chunks.push(`${message.role}: ${text}`);
  }

  const recent = chunks.slice(-10).join("\n");
  return recent.length > 6000 ? recent.slice(-6000) : recent;
}

async function generateTitle(pi: ExtensionAPI, ctx: ExtensionContext) {
  if (pi.getSessionName?.()) return;

  const model = ctx.modelRegistry.find(TITLE_MODEL_PROVIDER, TITLE_MODEL_ID);
  if (!model) return;

  const conversation = conversationForTitle(ctx);
  if (!conversation || !conversation.includes("assistant:")) return;

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) return;

  const sessionKey = titleSessionKey(ctx);
  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text: `conversation:\n${conversation}` }],
    timestamp: Date.now(),
  };

  const response = await complete(
    model,
    { systemPrompt: TITLE_SYSTEM_PROMPT, messages: [userMessage] },
    { apiKey: auth.apiKey, headers: auth.headers, signal: AbortSignal.timeout(20_000) },
  );
  if (response.stopReason === "aborted") return;

  const rawTitle = response.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join(" ");
  const title = normalizeFooterTitle(rawTitle);
  if (!title) return;

  if (titleSessionKey(ctx) !== sessionKey || pi.getSessionName?.()) return;

  generatedTitle = title;
  generatedTitleSessionKey = sessionKey;
  pi.setSessionName(title);
  setCmuxTabName(title);
  requestRender();
}

function queueTitleGenerationInBackground(pi: ExtensionAPI, ctx: ExtensionContext) {
  const sessionKey = titleSessionKey(ctx);
  const existingTitle = normalizeFooterTitle(pi.getSessionName?.());

  if (existingTitle) {
    generatedTitle = existingTitle;
    generatedTitleSessionKey = sessionKey;
    setCmuxTabName(existingTitle);
    return;
  }
  if (generatedTitle && generatedTitleSessionKey === sessionKey) return;

  titleInFlight = titleInFlight.catch(() => undefined).then(() => generateTitle(pi, ctx));
  void titleInFlight.catch(() => undefined);
}

function formatModelLabel(modelId: string | undefined) {
  if (!modelId) return { text: "no model", color: "dim" as const };
  const shortId = modelId.split("/").pop() ?? modelId;
  const knownModels: Record<string, { text: string; color: "warning" | "success" | "luna" }> = {
    "gpt-5.6-sol": { text: "☀️ 5.6 sol", color: "warning" },
    "gpt-5.6-terra": { text: "🌍 5.6 terra", color: "success" },
    "gpt-5.6-luna": { text: "🌑 5.6 luna", color: "luna" },
  };
  const known = knownModels[shortId.toLowerCase()];
  if (known) return known;

  const text = shortId
    .replace(/(\d)-(\d)/g, "$1.$2")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return { text: text || "no model", color: "dim" as const };
}

async function updateChatGptUsage(ctx: ExtensionContext) {
  const model = ctx.model;
  if (!isOpenAICodexProvider(model?.provider)) {
    usageSnapshot = undefined;
    requestRender();
    return;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    usageSnapshot = undefined;
    requestRender();
    return;
  }

  const accountId = getChatGptAccountId(auth.apiKey);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.apiKey}`,
    Accept: "application/json",
    "User-Agent": "pi-minimal-footer",
  };
  if (accountId) headers["chatgpt-account-id"] = accountId;

  try {
    const response = await fetch(`${CHATGPT_BASE_URL}/wham/usage`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      usageSnapshot = undefined;
      requestRender();
      return;
    }

    usageSnapshot = parseUsageSnapshot(await response.json());
    requestRender();
  } catch {
    usageSnapshot = undefined;
    requestRender();
  }
}

function queueUpdate(ctx: ExtensionContext) {
  inFlight = inFlight.catch(() => undefined).then(() => updateChatGptUsage(ctx));
  return inFlight;
}

function queueUpdateInBackground(ctx: ExtensionContext) {
  void queueUpdate(ctx).catch(() => undefined);
}

function tpsBucket(tps: number) {
  if (tps >= 100) return { color: "accent" as const, label: "zoom" };
  if (tps >= 50) return { color: "success" as const, label: "fast" };
  if (tps >= 20) return { color: "warning" as const, label: "ok" };
  return { color: "error" as const, label: "slow" };
}

type TpsSnapshot = { tps: number; color: ReturnType<typeof tpsBucket>["color"]; label: string };

function formatTps(snapshot: TpsSnapshot | undefined, theme: any) {
  if (!snapshot) return undefined;
  return theme.fg(snapshot.color, `${snapshot.tps} tok/s`);
}

const INPUT_PLACEHOLDER = "Plan, search, build anything";

function inputPlaceholder() {
  return INPUT_PLACEHOLDER;
}

function inputPrompt() {
  return "> ";
}

function promptColor() {
  return "accent";
}
const INPUT_PADDING_X = 1;
const INPUT_PADDING_TOP = 0;
const INPUT_PADDING_BOTTOM = 0;

type AppTheme = {
  fg: (token: any, text: string) => string;
  inverse: (text: string) => string;
};

type GitDiffSummary = { added: number; removed: number };

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b_[\s\S]*?\x1b\\/g, "")
    .replace(/\x1bP[\s\S]*?\x1b\\/g, "");
}

function padToWidth(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function alignLine(left: string, right: string, width: number, padding = 1) {
  if (width <= 0) return "";

  const sidePad = " ".repeat(Math.max(0, padding));
  const paddedWidth = Math.max(0, width - visibleWidth(sidePad) * 2);
  if (paddedWidth <= 0) return " ".repeat(width);
  if (!right) return `${sidePad}${truncateToWidth(left, paddedWidth, "")}${sidePad}`;

  const clippedRight = truncateToWidth(right, paddedWidth, "");
  const leftAvailable = Math.max(0, paddedWidth - visibleWidth(clippedRight) - 1);
  const clippedLeft = truncateToWidth(left, leftAvailable, "");
  const pad = " ".repeat(Math.max(1, paddedWidth - visibleWidth(clippedLeft) - visibleWidth(clippedRight)));
  return truncateToWidth(`${sidePad}${clippedLeft}${pad}${clippedRight}${sidePad}`, width, "");
}

function formatElapsedDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatTopStatusLine(
  width: number,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  tpsSnapshot: TpsSnapshot | undefined,
  sessionStartedAt: number,
  theme: AppTheme,
) {
  const model = formatModelLabel(ctx.model?.id);
  const thinking = pi.getThinkingLevel?.()?.toLowerCase();
  const modelText = model.color === "luna"
    ? `\x1b[38;2;92;111;148m${model.text}\x1b[0m`
    : theme.fg(model.color, model.text);
  const left = [modelText, thinking && theme.fg("dim", thinking)]
    .filter(Boolean)
    .join(theme.fg("dim", " · "));
  const elapsed = theme.fg("dim", `[${formatElapsedDuration(Date.now() - sessionStartedAt)}]`);
  const tps = formatTps(tpsSnapshot, theme);
  const right = [tps, elapsed].filter((part): part is string => Boolean(part)).join(theme.fg("dim", " · "));
  return alignLine(left, right, width);
}

function formatContextCompact(percent: number | undefined, theme: AppTheme) {
  if (percent === undefined) return theme.fg("dim", "ctx ?%");
  return `${theme.fg("dim", "ctx ")}${formatContextBar(percent, theme)}`;
}

function formatUsageStatus(includeCodexLimits: boolean, theme: AppTheme) {
  return includeCodexLimits ? formatChatGptLimits(theme) ?? "" : "";
}

function formatFooterRight(contextPercent: number | undefined, gitSummary: GitDiffSummary | undefined, theme: AppTheme) {
  return [formatGitDiffSummary(gitSummary, theme), formatContextCompact(contextPercent, theme)]
    .filter(Boolean)
    .join(theme.fg("dim", " · "));
}

function parseGitNumstat(stdout: string): GitDiffSummary {
  let added = 0;
  let removed = 0;

  for (const line of stdout.split("\n")) {
    const [rawAdded, rawRemoved] = line.split("\t");
    const nextAdded = Number(rawAdded);
    const nextRemoved = Number(rawRemoved);
    if (Number.isFinite(nextAdded)) added += nextAdded;
    if (Number.isFinite(nextRemoved)) removed += nextRemoved;
  }

  return { added, removed };
}

function formatGitDiffSummary(summary: GitDiffSummary | undefined, theme: AppTheme) {
  if (!summary) return "";
  if (summary.added === 0 && summary.removed === 0) return theme.fg("dim", "clean");
  const added = theme.fg(summary.added > 0 ? "success" : "dim", `+${summary.added}`);
  const removed = theme.fg(summary.removed > 0 ? "error" : "dim", `-${summary.removed}`);
  return `${added} ${removed}`;
}

function isEditorChromeLine(line: string): boolean {
  const plain = stripAnsi(line);
  if (!plain.includes("─")) return false;
  const nonChrome = plain.replace(/more/g, "").replace(/[─↑↓\d\s]/g, "");
  return nonChrome.length === 0;
}

function splitEditorRender(lines: string[]): { body: string[]; trailing: string[] } {
  const bottomIndex = lines.findIndex((line, index) => index > 0 && isEditorChromeLine(line));
  if (bottomIndex === -1) return { body: lines.slice(1), trailing: [] };
  return {
    body: lines.slice(1, bottomIndex),
    trailing: lines.slice(bottomIndex + 1),
  };
}

class MinimalFooterEditor extends CustomEditor {
  constructor(
    tui: ConstructorParameters<typeof CustomEditor>[0],
    theme: ConstructorParameters<typeof CustomEditor>[1],
    keybindings: ConstructorParameters<typeof CustomEditor>[2],
    private appTheme: AppTheme,
    private renderTopStatus: (width: number) => string,
  ) {
    super(tui, theme, keybindings);
  }

  private border(width: number, left: string, fill: string, right: string): string {
    const innerWidth = Math.max(0, width - 2);
    return this.appTheme.fg("border", `${left}${fill.repeat(innerWidth)}${right}`);
  }

  private frameLine(content: string, width: number): string {
    if (width <= 2) return truncateToWidth(content, width, "");
    const innerWidth = width - 2;
    const line = padToWidth(content, innerWidth);
    return `${this.appTheme.fg("border", "┃")}${line}${this.appTheme.fg("border", "┃")}`;
  }

  private wrapInputLines(lines: string[], width: number, trailing: string[] = []): string[] {
    if (width <= 2) return [this.renderTopStatus(width), ...lines.map((line) => truncateToWidth(line, width, "")), ...trailing];
    const topPadding = Array.from({ length: INPUT_PADDING_TOP }, () => this.frameLine("", width));
    const bottomPadding = Array.from({ length: INPUT_PADDING_BOTTOM }, () => this.frameLine("", width));
    return [
      this.renderTopStatus(width),
      this.border(width, "┏", "━", "┓"),
      ...topPadding,
      ...lines.map((line) => this.frameLine(line, width)),
      ...bottomPadding,
      this.border(width, "┗", "━", "┛"),
      ...trailing,
    ];
  }

  private renderPlaceholder(width: number): string[] {
    const [first = " ", ...rest] = [...inputPlaceholder()];
    const cursorMarker = this.focused && !this.isShowingAutocomplete() ? CURSOR_MARKER : "";
    const fakeCursor = `${cursorMarker}${this.appTheme.inverse(first)}`;
    const leftPadding = " ".repeat(INPUT_PADDING_X);
    const text = `${leftPadding}${this.appTheme.fg(promptColor(), inputPrompt())}${fakeCursor}${this.appTheme.fg("muted", rest.join(""))}`;
    return this.wrapInputLines([text], width);
  }

  render(width: number): string[] {
    if (width <= 0) return [];

    if (this.getText().length === 0) {
      return this.renderPlaceholder(width);
    }

    const currentPrompt = inputPrompt();
    const plainPrefix = `${" ".repeat(INPUT_PADDING_X)}${currentPrompt}`;
    const prefixWidth = visibleWidth(plainPrefix);
    const innerWidth = Math.max(1, width - 2);
    const baseLines = super.render(Math.max(1, innerWidth - prefixWidth));
    const { body, trailing } = splitEditorRender(baseLines);
    const editorLines = body.length > 0 ? body : [""];
    const prompt = `${" ".repeat(INPUT_PADDING_X)}${this.appTheme.fg(promptColor(), currentPrompt)}`;
    const continuation = " ".repeat(prefixWidth);

    const inputLines = editorLines.map((line, index) => {
      const prefix = index === 0 ? prompt : continuation;
      return `${prefix}${line}`;
    });

    return this.wrapInputLines(inputLines, width, trailing);
  }
}

export function registerFooter(pi: ExtensionAPI) {
  pi.registerCommand("usage", {
    description: "Show ChatGPT 5-hour and weekly usage limits",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;

      await queueUpdate(ctx).catch(() => undefined);
      ctx.ui.notify(formatUsagePanel(ctx.ui.theme), "info");
    },
  });

  let messageStart: number | null = null;
  let streamStart: number | null = null;
  let estimatedStreamedTokens = 0;
  let totalOutputTokens = 0;
  let totalStreamMs = 0;
  let tpsSnapshot: TpsSnapshot | undefined;
  let sessionStartedAt = Date.now();
  let clockInterval: NodeJS.Timeout | undefined;
  let gitRefreshInterval: NodeJS.Timeout | undefined;
  let gitRefreshInFlight = false;
  let gitDiffSummary: GitDiffSummary | undefined;

  function refreshGitDiffSummary(cwd: string) {
    if (gitRefreshInFlight) return;
    gitRefreshInFlight = true;
    execFile("git", ["diff", "--numstat", "HEAD", "--"], { cwd, timeout: 2_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      gitRefreshInFlight = false;
      gitDiffSummary = error ? undefined : parseGitNumstat(String(stdout ?? ""));
      requestRender();
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    sessionStartedAt = Date.now();
    gitDiffSummary = undefined;
    if (clockInterval) clearInterval(clockInterval);
    if (gitRefreshInterval) clearInterval(gitRefreshInterval);
    clockInterval = setInterval(() => requestRender(), 1_000);
    refreshGitDiffSummary(ctx.cwd);
    gitRefreshInterval = setInterval(() => refreshGitDiffSummary(ctx.cwd), 2_000);

    ctx.ui.setEditorComponent((tui, theme, keybindings) => new MinimalFooterEditor(
      tui,
      theme,
      keybindings,
      ctx.ui.theme,
      (width) => formatTopStatusLine(width, ctx, pi, tpsSnapshot, sessionStartedAt, ctx.ui.theme),
    ));

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      globalThis.__piRequestFooterRender = requestRender;

      return {
        invalidate() {},
        render(width: number): string[] {
          const usage = ctx.getContextUsage();
          const contextPercent = usage && usage.percent !== null ? Math.round(usage.percent) : undefined;
          const left = formatUsageStatus(isOpenAICodexProvider(ctx.model?.provider), theme);
          const right = formatFooterRight(contextPercent, gitDiffSummary, theme);
          const mainLine = alignLine(left, right, width);

          // Preserve extension status lines from other extensions (fix-input, PR, etc.).
          const statusLines = [...footerData.getExtensionStatuses().entries()]
            .filter(([key, line]) => key !== "tps" && key !== "better-gpt" && Boolean(line))
            .map(([, line]) => truncateToWidth(line, width));

          return [mainLine, ...statusLines];
        },
      };
    });

    generatedTitle = normalizeFooterTitle(pi.getSessionName?.()) || undefined;
    generatedTitleSessionKey = generatedTitle ? titleSessionKey(ctx) : undefined;
    queueUpdateInBackground(ctx);
    queueTitleGenerationInBackground(pi, ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    queueUpdateInBackground(ctx);
    queueTitleGenerationInBackground(pi, ctx);
    requestRender();
  });

  pi.on("agent_start", async (_event, ctx) => {
    totalOutputTokens = 0;
    totalStreamMs = 0;
    messageStart = null;
    streamStart = null;
    estimatedStreamedTokens = 0;

    tpsSnapshot = undefined;
    if (!ctx.hasUI) return;
    requestRender();
  });

  pi.on("message_start", async (event) => {
    if (event.message.role !== "assistant") return;
    messageStart = Date.now();
    streamStart = null;
    estimatedStreamedTokens = 0;
  });

  pi.on("message_update", async (event, ctx) => {
    if (event.message.role !== "assistant" || !ctx.hasUI) return;

    const streamEvent = event.assistantMessageEvent;
    const isOutputDelta =
      streamEvent.type === "text_delta" ||
      streamEvent.type === "thinking_delta" ||
      streamEvent.type === "toolcall_delta";

    if (!isOutputDelta) return;

    const now = Date.now();
    streamStart ??= now;
    estimatedStreamedTokens += Math.max(0, streamEvent.delta.length / 4);

    const elapsed = (now - streamStart) / 1000;
    const officialTokens = event.message.usage.output;
    const currentTokens = officialTokens > 0 ? officialTokens : estimatedStreamedTokens;

    if (elapsed <= 0 || currentTokens <= 0) return;

    const tps = Math.round(currentTokens / elapsed);
    const bucket = tpsBucket(tps);
    tpsSnapshot = { tps, color: bucket.color, label: bucket.label };
    requestRender();
  });

  pi.on("message_end", async (event) => {
    if (event.message.role === "user") {
      requestRender();
      return;
    }
    if (event.message.role !== "assistant") return;

    const messageTokens = event.message.usage.output;
    const timingStart = streamStart ?? messageStart;
    if (!timingStart || messageTokens <= 0) {
      messageStart = null;
      streamStart = null;
      estimatedStreamedTokens = 0;
      return;
    }

    totalOutputTokens += messageTokens;
    totalStreamMs += Math.max(0, Date.now() - timingStart);

    messageStart = null;
    streamStart = null;
    estimatedStreamedTokens = 0;
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    queueUpdateInBackground(ctx);
    queueTitleGenerationInBackground(pi, ctx);

    const elapsed = totalStreamMs / 1000;
    const tps = totalOutputTokens > 0 && elapsed > 0 ? Math.round(totalOutputTokens / elapsed) : 0;
    if (tps <= 0) {
      tpsSnapshot = undefined;
      requestRender();
      return;
    }

    const bucket = tpsBucket(tps);
    tpsSnapshot = { tps, color: bucket.color, label: bucket.label };
    requestRender();
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    if (ctx.hasUI) requestRender();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (clockInterval) {
      clearInterval(clockInterval);
      clockInterval = undefined;
    }
    if (gitRefreshInterval) {
      clearInterval(gitRefreshInterval);
      gitRefreshInterval = undefined;
    }
    requestRender = () => {};
    generatedTitle = undefined;
    generatedTitleSessionKey = undefined;
    globalThis.__piRequestFooterRender = undefined;
    tpsSnapshot = undefined;
    gitDiffSummary = undefined;
    gitRefreshInFlight = false;
    if (ctx.hasUI) {
      ctx.ui.setFooter(undefined);
      ctx.ui.setEditorComponent(undefined);
    }
  });
}
