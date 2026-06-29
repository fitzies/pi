import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { getLanguageFromPath, highlightCode, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

type Snapshot = {
  relPath: string;
  absPath: string;
  before: string | null;
};

type TrackedChange = {
  relPath: string;
  before: string | null;
  after: string;
  kind: "new" | "edited";
  added: number;
  removed: number;
  updatedAt: number;
};

function stripAtPrefix(filePath: string) {
  return filePath.startsWith("@") ? filePath.slice(1) : filePath;
}

function normalizeToolPath(cwd: string, rawPath: string) {
  const cleaned = stripAtPrefix(rawPath);
  const absPath = path.resolve(cwd, cleaned);
  const relativePath = path.relative(cwd, absPath);
  const relPath = relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
    ? relativePath
    : cleaned;

  return { absPath, relPath };
}

async function readTextOrNull(absPath: string) {
  try {
    return await readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

function diffLineCounts(before: string, after: string) {
  const a = before.length > 0 ? before.split("\n") : [];
  const b = after.length > 0 ? after.split("\n") : [];

  // Trim the synthetic empty line produced by a trailing newline so normal files
  // don't show an extra changed line.
  if (a.at(-1) === "") a.pop();
  if (b.at(-1) === "") b.pop();

  const previous = new Array(b.length + 1).fill(0);
  const current = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      current[j] = a[i - 1] === b[j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1]);
    }
    for (let j = 0; j <= b.length; j++) previous[j] = current[j];
    current.fill(0);
  }

  const unchanged = previous[b.length] ?? 0;
  return {
    added: b.length - unchanged,
    removed: a.length - unchanged,
  };
}

function sortedChanges(changes: Map<string, TrackedChange>) {
  return [...changes.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function formatTrackedChanges(changes: Map<string, TrackedChange>, theme?: any) {
  const items = sortedChanges(changes);
  const lines: string[] = [];

  for (const item of items) {
    const marker = item.kind === "new" ? "+" : "Δ";
    const prefix = `  ${marker} ${item.relPath} `;

    if (!theme) {
      lines.push(`${prefix}(+${item.added}/-${item.removed})`);
      continue;
    }

    const plus = item.added === 0 ? theme.fg("text", `+${item.added}`) : theme.fg("success", `+${item.added}`);
    const minus = item.removed === 0 ? theme.fg("text", `-${item.removed}`) : theme.fg("error", `-${item.removed}`);
    lines.push(theme.fg("muted", prefix) + theme.fg("text", "(") + plus + theme.fg("text", "/") + minus + theme.fg("text", ")"));
  }

  return lines;
}

type UnstagedFile = {
  relPath: string;
  kind: "modified" | "untracked";
};

function formatUnstagedFile(item: UnstagedFile) {
  const marker = item.kind === "untracked" ? "+" : "Δ";
  return `${marker} ${item.relPath}`;
}

function compactHome(filePath: string) {
  const home = homedir();
  if (filePath === home) return "~";
  if (filePath.startsWith(`${home}${path.sep}`)) return `~${path.sep}${path.relative(home, filePath)}`;
  return filePath;
}

function formatWorkspaceLine(line: string, theme?: any) {
  return theme ? theme.fg("dim", `  ${line}`) : `  ${line}`;
}

async function gitOutput(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd, timeout: 2_000, maxBuffer: 1024 * 1024 });
  return String(stdout ?? "").trimEnd();
}

async function getBranch(cwd: string) {
  const branch = await gitOutput(cwd, ["branch", "--show-current"]);
  if (branch) return branch;
  const head = await gitOutput(cwd, ["rev-parse", "--short", "HEAD"]);
  return head ? `detached@${head}` : "unknown";
}

function countUnstagedFiles(statusOutput: string) {
  if (!statusOutput) return 0;
  return statusOutput.split("\n").filter((line) => line.startsWith("??") || line[1] !== " ").length;
}

async function getWorkspaceStatusLine(cwd: string) {
  try {
    await gitOutput(cwd, ["rev-parse", "--is-inside-work-tree"]);
    const [branch, status] = await Promise.all([
      getBranch(cwd),
      gitOutput(cwd, ["status", "--porcelain", "--untracked-files=normal"]),
    ]);
    const unstagedCount = countUnstagedFiles(status);
    const fileLabel = unstagedCount === 1 ? "file" : "files";
    return ` ${branch} · ${unstagedCount} unstaged ${fileLabel}`;
  } catch {
    return compactHome(cwd);
  }
}

async function getUnstagedFiles(cwd: string): Promise<UnstagedFile[]> {
  const [modified, untracked] = await Promise.all([
    execFileAsync("git", ["diff", "--name-only"], { cwd, maxBuffer: 1024 * 1024 }).catch(() => ({ stdout: "" })),
    execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], { cwd, maxBuffer: 1024 * 1024 }).catch(() => ({ stdout: "" })),
  ]);

  const files = new Map<string, UnstagedFile>();
  for (const relPath of String(modified.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean)) {
    files.set(relPath, { relPath, kind: "modified" });
  }
  for (const relPath of String(untracked.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean)) {
    files.set(relPath, { relPath, kind: "untracked" });
  }

  return [...files.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));
}

async function getGitDiff(cwd: string, relPath: string, kind: UnstagedFile["kind"] = "modified") {
  try {
    const args = kind === "untracked"
      ? ["diff", "--no-index", "--", "/dev/null", relPath]
      : ["diff", "--", relPath];
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout || stderr || "No git diff output for this file.";
  } catch (error: any) {
    return error?.stdout || error?.stderr || String(error);
  }
}

function highlightSingleLine(code: string, language?: string) {
  const highlighted = highlightCode(code || " ", language)[0] ?? code;
  return code.length === 0 ? "" : highlighted;
}

function renderColoredGitDiffLine(line: string, relPath: string, theme: Theme) {
  const language = getLanguageFromPath(relPath);

  if (line.startsWith("diff --git")) return theme.fg("accent", line);
  if (line.startsWith("index ")) return theme.fg("muted", line);
  if (line.startsWith("@@")) return theme.fg("warning", line);
  if (line.startsWith("+++ ")) return theme.fg("toolDiffAdded", line);
  if (line.startsWith("--- ")) return theme.fg("toolDiffRemoved", line);
  if (line.startsWith("Binary files ")) return theme.fg("warning", line);
  if (line.startsWith("\\ No newline")) return theme.fg("dim", line);

  if (line.startsWith("+")) {
    return theme.fg("toolDiffAdded", "+") + highlightSingleLine(line.slice(1), language);
  }
  if (line.startsWith("-")) {
    return theme.fg("toolDiffRemoved", "-") + highlightSingleLine(line.slice(1), language);
  }
  if (line.startsWith(" ")) {
    return theme.fg("toolDiffContext", " ") + highlightSingleLine(line.slice(1), language);
  }

  return theme.fg("muted", line);
}

class DiffViewer implements Component {
  private scroll = 0;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private title: string,
    private relPath: string,
    private diff: string,
    private done: () => void,
  ) {}

  private get rawLines() {
    return this.diff.replace(/\r\n/g, "\n").split("\n");
  }

  private get bodyHeight() {
    // Leave room for top border, title, help, and bottom border.
    return Math.max(3, this.tui.terminal.rows - 6);
  }

  private clampScroll() {
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.rawLines.length - this.bodyHeight)));
  }

  invalidate(): void {}

  render(width: number): string[] {
    this.clampScroll();

    const rawLines = this.rawLines;
    const bodyHeight = this.bodyHeight;
    const end = Math.min(rawLines.length, this.scroll + bodyHeight);
    const border = this.theme.fg("borderMuted", "─".repeat(Math.max(0, width)));
    const title = this.theme.fg("accent", this.theme.bold(this.title));
    const position = rawLines.length > bodyHeight
      ? this.theme.fg("dim", ` lines ${this.scroll + 1}-${end}/${rawLines.length}`)
      : "";
    const help = this.theme.fg("dim", "↑↓ scroll • pgup/pgdn page • home/end jump • q/esc close");

    const lines = [
      border,
      truncateToWidth(` ${title}${position}`, width),
    ];

    for (const rawLine of rawLines.slice(this.scroll, end)) {
      lines.push(truncateToWidth(renderColoredGitDiffLine(rawLine, this.relPath, this.theme), width));
    }

    while (lines.length < bodyHeight + 2) lines.push("");
    lines.push(truncateToWidth(` ${help}`, width));
    lines.push(border);
    return lines;
  }

  handleInput(data: string): void {
    const page = Math.max(1, this.bodyHeight - 1);

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === "q") {
      this.done();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.scroll -= 1;
    } else if (matchesKey(data, Key.down)) {
      this.scroll += 1;
    } else if (matchesKey(data, Key.pageUp)) {
      this.scroll -= page;
    } else if (matchesKey(data, Key.pageDown) || data === " ") {
      this.scroll += page;
    } else if (matchesKey(data, Key.home)) {
      this.scroll = 0;
    } else if (matchesKey(data, Key.end)) {
      this.scroll = this.rawLines.length;
    }

    this.clampScroll();
    this.tui.requestRender();
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function registerFileChanges(pi: ExtensionAPI) {
  const WIDGET_ID = "workspace-status";
  const UPDATE_INTERVAL_MS = 2_000;
  const pendingByToolCallId = new Map<string, Snapshot>();
  const baselines = new Map<string, Snapshot>();
  const changes = new Map<string, TrackedChange>();
  let workspaceLine = "";
  let interval: NodeJS.Timeout | undefined;
  let generation = 0;

  function isStaleContextError(error: unknown) {
    return error instanceof Error && error.message.includes("extension ctx is stale");
  }

  function renderWidget(ctx: any, isCurrent: () => boolean = () => true) {
    if (!isCurrent()) return;

    try {
      if (!ctx.hasUI) return;
      // Footer chrome now owns the compact workspace summary; keep this extension
      // tracking changes for /diff without rendering a second widget above input.
      ctx.ui.setWidget(WIDGET_ID, undefined);
    } catch (error) {
      if (!isStaleContextError(error)) throw error;
    }
  }

  async function refreshWidget(ctx: any, isCurrent: () => boolean = () => true) {
    if (!isCurrent()) return;

    let cwd: string;
    try {
      if (!ctx.hasUI) return;
      cwd = ctx.cwd;
    } catch (error) {
      if (isStaleContextError(error)) return;
      throw error;
    }

    const nextLine = await getWorkspaceStatusLine(cwd);
    if (!isCurrent()) return;
    workspaceLine = nextLine;
    renderWidget(ctx, isCurrent);
  }

  function clearChanges(ctx: any) {
    pendingByToolCallId.clear();
    baselines.clear();
    changes.clear();
    renderWidget(ctx);
  }

  pi.on("session_start", async (_event, ctx) => {
    generation += 1;
    const sessionGeneration = generation;
    const isCurrent = () => generation === sessionGeneration;

    if (interval) clearInterval(interval);
    workspaceLine = compactHome(ctx.cwd);
    clearChanges(ctx);
    await refreshWidget(ctx, isCurrent);
    if (!isCurrent()) return;

    interval = setInterval(() => {
      void refreshWidget(ctx, isCurrent);
    }, UPDATE_INTERVAL_MS);
  });

  pi.on("agent_start", async (_event, ctx) => {
    clearChanges(ctx);
    const eventGeneration = generation;
    await refreshWidget(ctx, () => generation === eventGeneration);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("edit", event) && !isToolCallEventType("write", event)) return;

    const { absPath, relPath } = normalizeToolPath(ctx.cwd, event.input.path);
    pendingByToolCallId.set(event.toolCallId, {
      absPath,
      relPath,
      before: await readTextOrNull(absPath),
    });
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;

    const pending = pendingByToolCallId.get(event.toolCallId);
    pendingByToolCallId.delete(event.toolCallId);
    if (!pending || event.isError) return;

    const baseline = baselines.get(pending.relPath) ?? pending;
    baselines.set(pending.relPath, baseline);

    const after = await readTextOrNull(pending.absPath);
    if (after === null) {
      changes.delete(pending.relPath);
      await refreshWidget(ctx, () => true);
      return;
    }

    const before = baseline.before ?? "";
    const { added, removed } = diffLineCounts(before, after);

    if (baseline.before !== null && after === baseline.before) {
      changes.delete(pending.relPath);
    } else {
      changes.set(pending.relPath, {
        relPath: pending.relPath,
        before: baseline.before,
        after,
        kind: baseline.before === null ? "new" : "edited",
        added,
        removed,
        updatedAt: Date.now(),
      });
    }

    await refreshWidget(ctx, () => true);
  });

  pi.on("input", async (_event, ctx) => {
    const eventGeneration = generation;
    await refreshWidget(ctx, () => generation === eventGeneration);
    return { action: "continue" };
  });

  pi.on("tool_execution_end", async (_event, ctx) => {
    const eventGeneration = generation;
    await refreshWidget(ctx, () => generation === eventGeneration);
  });

  pi.registerCommand("diff", {
    description: "Pick an unstaged file and view its git diff",
    handler: async (_args, ctx) => {
      const files = await getUnstagedFiles(ctx.cwd);
      if (files.length === 0) {
        ctx.ui.notify("No unstaged file changes", "info");
        return;
      }

      const items = files.map(formatUnstagedFile);
      const selected = await ctx.ui.select("Diff unstaged file", items);
      const file = files.find((item) => formatUnstagedFile(item) === selected);
      if (!file) return;

      const diff = await getGitDiff(ctx.cwd, file.relPath, file.kind);
      await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
        return new DiffViewer(tui, theme, `Diff: ${file.relPath}`, file.relPath, diff, done);
      });
    },
  });


  pi.on("session_shutdown", async (_event, ctx) => {
    generation += 1;
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
    pendingByToolCallId.clear();
    baselines.clear();
    changes.clear();
    try {
      if (ctx.hasUI) ctx.ui.setWidget(WIDGET_ID, undefined);
    } catch (error) {
      if (!isStaleContextError(error)) throw error;
    }
  });
}
