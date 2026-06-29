import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

type Agent = {
  name: string;
  description: string;
  model: string;
  tools: string[];
  thinking: string;
  capabilities: string[];
  prompt: string;
};

type Progress = {
  status: "running" | "done" | "failed";
  tools: string[];
  output: string;
  error?: string;
  started: number;
  model: string;
};

const EXT_DIR = path.dirname(new URL(import.meta.url).pathname);
const AGENTS_DIR = path.join(EXT_DIR, "agents");
const FIRECRAWL_EXT = path.join(EXT_DIR, "..", "firecrawl-search.ts");
const READONLY_GUARD_EXT = path.join(EXT_DIR, "read-only-guard.ts");
const FFF_EXT = path.join(EXT_DIR, "..", "..", "npm", "node_modules", "@ff-labs", "pi-fff", "src", "index.ts");
const CUSTOM_TOOL_EXTENSIONS: Record<string, string> = {
  search: FIRECRAWL_EXT,
  scrape: FIRECRAWL_EXT,
  fffind: FFF_EXT,
  ffgrep: FFF_EXT,
  "fff-multi-grep": FFF_EXT,
};
const BUILTIN_TOOLS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
const REVIEWER_AGENT = "reviewer";
const MAX_REVIEW_CONTEXT_CHARS = 60_000;

declare global {
  var __piSubagentCounts: Record<string, number> | undefined;
  var __piRequestFooterRender: (() => void) | undefined;
}

function recordSubagentSpawn(name: string) {
  globalThis.__piSubagentCounts ??= {};
  globalThis.__piSubagentCounts[name] = (globalThis.__piSubagentCounts[name] ?? 0) + 1;
  globalThis.__piRequestFooterRender?.();
}

function recordSubagentDone(name: string) {
  const counts = globalThis.__piSubagentCounts;
  if (!counts) return;
  counts[name] = Math.max(0, (counts[name] ?? 0) - 1);
  if (counts[name] === 0) delete counts[name];
  if (Object.keys(counts).length === 0) globalThis.__piSubagentCounts = undefined;
  globalThis.__piRequestFooterRender?.();
}

function csv(value: string | undefined): string[] {
  return (value || "").split(",").map((t) => t.trim()).filter(Boolean);
}

function loadAgents(): Agent[] {
  return fs.readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(AGENTS_DIR, file), "utf8");
      const { frontmatter, body } = parseFrontmatter<Record<string, string>>(raw);
      return {
        name: frontmatter.name,
        description: frontmatter.description || "",
        model: frontmatter.model || "openai/gpt-5.4-mini",
        tools: csv(frontmatter.tools),
        thinking: frontmatter.thinking || "low",
        capabilities: csv(frontmatter.capabilities),
        prompt: body,
      };
    })
    .filter((a) => a.name);
}

function agentsWithCapability(agents: Agent[], capability: string): Agent[] {
  return agents.filter((a) => a.capabilities.includes(capability));
}

function firstAgentName(agents: Agent[], capability: string, fallback: string): string {
  return agentsWithCapability(agents, capability)[0]?.name || agents.find((a) => a.name === fallback)?.name || fallback;
}

function buildSubagentGuidance(agents: Agent[]): string[] {
  const researcher = firstAgentName(agents, "research", "researcher");
  const scout = firstAgentName(agents, "scout", "scout");
  const reviewer = firstAgentName(agents, "review", "reviewer");
  const available = agents.map((a) => `${a.name}${a.capabilities.length ? ` [${a.capabilities.join(", ")}]` : ""}`).join("; ");

  return [
    `Available subagents are loaded dynamically from ${AGENTS_DIR}: ${available || "none"}.`,
    `Use the ${researcher} subagent first for web research, current information, external docs, package investigation, or source-backed answers. Do not perform main-context search/scrape for those tasks unless the subagent result is insufficient or the task is a narrow known-URL lookup.`,
    `Use the ${scout} subagent first for broad/unfamiliar codebase reconnaissance, finding where functionality lives, architecture tracing, comparing patterns across files, or multi-file search. Do not perform main-context grep/find for those tasks unless the subagent result is insufficient or the task is a narrow known-file lookup.`,
    `Use the ${reviewer} subagent when the user asks to review, validate, critique, audit, sanity-check, or assess a plan/implementation/amendment.`,
    "Direct parent reads are fine for simple known files, known URLs, small lookups, implementation work, and focused validation.",
    "Optimize for preserving main context: delegate discovery/research/review before doing broad investigation inline.",
    "Subagents do not inherit context by default; include the necessary task context. The reviewer agent is automatically given a compact transcript of the active conversation branch.",
  ];
}

function resolvePi(): { command: string; args: string[] } {
  const entry = process.argv[1];
  if (entry) {
    try {
      const real = fs.realpathSync(entry);
      if (/\.(mjs|cjs|js)$/i.test(real)) return { command: process.execPath, args: [real] };
    } catch {}
  }
  return { command: "pi", args: [] };
}

function previewTool(name: string, args: any): string {
  if (args?.path) return `${name} ${args.path}`;
  if (args?.pattern) return `${name} ${args.pattern}`;
  if (args?.query) return `${name} “${args.query}”`;
  if (args?.url) return `${name} ${args.url}`;
  if (args?.command) return `${name} ${String(args.command).replace(/\s+/g, " ").slice(0, 80)}`;
  return name;
}

function truncateMiddle(text: string, max = 1_200): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.55);
  const tail = max - head;
  return `${text.slice(0, head)}\n…[truncated ${text.length - max} chars]…\n${text.slice(-tail)}`;
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function textFromMessageContent(content: any, max = 1_500): string {
  const raw = textFromContent(content);
  return truncateMiddle(normalizeText(raw), max);
}

function formatAssistantContent(content: any): string {
  if (!Array.isArray(content)) return truncateMiddle(normalizeText(String(content ?? "")), 1_500);
  const parts: string[] = [];
  for (const block of content) {
    if (block?.type === "text" && block.text) parts.push(truncateMiddle(normalizeText(block.text), 1_500));
    if (block?.type === "toolCall") parts.push(`[tool call: ${previewTool(block.name, block.arguments)}]`);
  }
  return parts.filter(Boolean).join("\n");
}

function formatBranchContext(ctx: any): string {
  const entries = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries?.() ?? [];
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.type === "message") {
      const message = entry.message;
      if (!message) continue;
      if (message.role === "user") {
        lines.push(`## User (${entry.id})\n${textFromMessageContent(message.content, 2_500)}`);
      } else if (message.role === "assistant") {
        lines.push(`## Assistant (${entry.id})\n${formatAssistantContent(message.content)}`);
      } else if (message.role === "toolResult") {
        const body = textFromMessageContent(message.content, 900);
        lines.push(`## Tool result (${entry.id}) ${message.toolName}${message.isError ? " [ERROR]" : ""}\n${body}`);
      } else if (message.role === "bashExecution") {
        lines.push(`## User bash (${entry.id})\n$ ${message.command}\n${truncateMiddle(normalizeText(message.output || ""), 900)}`);
      } else if (message.role === "custom") {
        lines.push(`## Custom ${message.customType || "message"} (${entry.id})\n${textFromMessageContent(message.content, 1_500)}`);
      } else if (message.role === "branchSummary") {
        lines.push(`## Branch summary (${entry.id})\n${truncateMiddle(normalizeText(message.summary || ""), 2_000)}`);
      } else if (message.role === "compactionSummary") {
        lines.push(`## Compaction summary (${entry.id})\n${truncateMiddle(normalizeText(message.summary || ""), 3_000)}`);
      }
    } else if (entry.type === "plan") {
      lines.push(`## Plan entry (${entry.id})\n${truncateMiddle(normalizeText(JSON.stringify(entry.data ?? entry, null, 2)), 4_000)}`);
    } else if (entry.type === "custom" && entry.customType) {
      lines.push(`## Extension entry ${entry.customType} (${entry.id})\n${truncateMiddle(normalizeText(JSON.stringify(entry.data ?? {}, null, 2)), 2_000)}`);
    }
  }

  const transcript = lines.join("\n\n");
  if (transcript.length <= MAX_REVIEW_CONTEXT_CHARS) return transcript;
  const head = transcript.slice(0, 15_000);
  const tail = transcript.slice(-(MAX_REVIEW_CONTEXT_CHARS - 16_000));
  return `${head}\n\n...[conversation compacted: omitted ${transcript.length - MAX_REVIEW_CONTEXT_CHARS} chars from the middle]...\n\n${tail}`;
}

function buildReviewerContext(ctx: any, task: string): string {
  return `# Reviewer context\n\nCurrent working directory: ${ctx.cwd}\n\nThe main user asked for a review/validation task:\n${task}\n\nBelow is a compact transcript of the active conversation branch. Use it to infer what the user wants to achieve, what stage the work is in, and what should be reviewed. If implementation exists, inspect files/diffs with tools instead of relying only on transcript snippets.\n\n# Conversation transcript\n\n${formatBranchContext(ctx)}`;
}

function textFromContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((x) => x?.type === "text").map((x) => x.text).join("\n");
  return "";
}

async function runAgent(agent: Agent, task: string, cwd: string, signal?: AbortSignal, onProgress?: (p: Progress) => void, extraContext?: string): Promise<Progress> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
  const promptPath = path.join(tempDir, `${agent.name}.md`);
  await fs.promises.writeFile(promptPath, agent.prompt, { mode: 0o600 });

  const pi = resolvePi();
  const args = [...pi.args, "--mode", "json", "-p", "--no-session", "--no-skills", "--no-extensions"];
  args.push("--tools", agent.tools.join(","));
  const extraExtensions = new Set<string>();
  for (const tool of agent.tools) {
    if (!BUILTIN_TOOLS.has(tool) && CUSTOM_TOOL_EXTENSIONS[tool]) extraExtensions.add(CUSTOM_TOOL_EXTENSIONS[tool]);
  }
  for (const extensionPath of extraExtensions) args.push("--extension", extensionPath);
  if (agent.name === REVIEWER_AGENT) args.push("--extension", READONLY_GUARD_EXT);
  args.push("--models", agent.model, "--thinking", agent.thinking, "--append-system-prompt", promptPath);
  if (extraContext) {
    const contextPath = path.join(tempDir, `${agent.name}-context.md`);
    await fs.promises.writeFile(contextPath, extraContext, { mode: 0o600 });
    args.push("--append-system-prompt", contextPath);
  }
  args.push(`Task: ${task}`);

  const progress: Progress = { status: "running", tools: [], output: "", started: Date.now(), model: agent.model };
  onProgress?.(progress);

  const code = await new Promise<number>((resolve) => {
    const proc = spawn(pi.command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    let stderr = "";

    const line = (s: string) => {
      if (!s.trim()) return;
      try {
        const evt = JSON.parse(s);
        if (evt.type === "tool_execution_start") {
          progress.tools.push(previewTool(evt.toolName, evt.args));
          onProgress?.(progress);
        }
        if (evt.type === "message_end" && evt.message?.role === "assistant") {
          progress.output = textFromContent(evt.message.content) || progress.output;
          onProgress?.(progress);
        }
      } catch {}
    };

    proc.stdout.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      lines.forEach(line);
    });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (c) => {
      if (buf.trim()) line(buf);
      if (c !== 0) progress.error = stderr.trim() || `Exited with ${c}`;
      resolve(c ?? 1);
    });
    proc.on("error", (e) => { progress.error = e.message; resolve(1); });
    if (signal) signal.addEventListener("abort", () => proc.kill("SIGTERM"), { once: true });
  });

  progress.status = code === 0 && !progress.error ? "done" : "failed";
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  return progress;
}

export default function (pi: ExtensionAPI) {
  const agents = loadAgents();

  pi.on("before_agent_start", async (event) => {
    const currentGuidance = buildSubagentGuidance(loadAgents());
    return {
      systemPrompt: `${event.systemPrompt}\n\nSubagent delegation guidance:\n- ${currentGuidance.join("\n- ")}`,
    };
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: `Run an isolated subagent. Available: ${agents.map((a) => `${a.name} (${a.description}${a.capabilities.length ? `; capabilities: ${a.capabilities.join(", ")}` : ""})`).join(", ")}`,
    promptSnippet: "Delegate web research, broad code scouting, and reviews to isolated subagents when useful for keeping the main chat context small; direct reads for simple known files are fine.",
    promptGuidelines: [
      "Use subagent for delegated research, broad code scouting, and review/validation when it would keep the main chat context smaller; direct reads for simple known files are fine.",
    ],
    parameters: Type.Object({
      agent: Type.String({ description: `Agent name: ${agents.map((a) => a.name).join(" or ")}` }),
      task: Type.String({ description: "Complete task description for the isolated agent" }),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const currentAgents = loadAgents();
      const agent = currentAgents.find((a) => a.name === params.agent);
      if (!agent) throw new Error(`Unknown subagent: ${params.agent}. Available: ${currentAgents.map((a) => a.name).join(", ")}`);
      recordSubagentSpawn(agent.name);
      let live: Progress | undefined;
      try {
        const reviewerContext = agent.name === REVIEWER_AGENT ? buildReviewerContext(ctx, params.task) : undefined;
        const result = await runAgent(agent, params.task, ctx.cwd, signal, (p) => {
          live = { ...p, tools: [...p.tools] };
          onUpdate?.({ content: [{ type: "text", text: "running" }], details: { progress: live } });
        }, reviewerContext);
        return {
          content: [{ type: "text", text: result.output || result.error || "(no output)" }],
          details: { progress: result },
          ...(result.status === "failed" ? { isError: true } : {}),
        };
      } finally {
        recordSubagentDone(agent.name);
      }
    },
    renderCall(args, theme) {
      const task = args.task ? String(args.task).replace(/\s+/g, " ").slice(0, 56) : "";
      return new Text(`${theme.fg("toolTitle", theme.bold("subagent"))} ${theme.fg("accent", args.agent || "")} ${theme.fg("dim", task)}`, 0, 0);
    },
    renderResult(result, options, theme) {
      const p = (result.details as any)?.progress as Progress | undefined;
      if (!p) return new Text(textFromContent(result.content).slice(0, 200), 0, 0);
      const elapsed = Math.max(0, Math.round((Date.now() - p.started) / 1000));
      const icon = p.status === "running" ? theme.fg("warning", "↻") : p.status === "done" ? theme.fg("success", "✓") : theme.fg("error", "✕");
      const c = new Container();
      c.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold((result as any).agent || "subagent"))} ${theme.fg("dim", `${p.tools.length} tools · ${elapsed}s · ${p.model}`)}`, 0, 0));
      if (p.tools.length) c.addChild(new Text(theme.fg("muted", p.tools.slice(-4).join("  ·  ")), 0, 0));
      if (p.error) c.addChild(new Text(theme.fg("error", p.error.slice(0, 300)), 0, 0));
      if (options.expanded && p.output) {
        c.addChild(new Spacer(1));
        c.addChild(new Markdown(p.output, 0, 0));
      }
      return c;
    },
  });
}
