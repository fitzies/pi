import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { registerHandoff } from "./handoff";

const EXT = "planner";
const PLAN_DIR = ".pi/plans";
const INDEX_FILE = ".pi/plans/index.json";

type PlanMeta = {
  id: string;
  title: string;
  path: string;
  createdAt: string;
  cwd: string;
  gitRoot?: string;
  sessionFile?: string;
  leafId?: string;
};

type Index = { plans: PlanMeta[]; activeBySession: Record<string, string> };

declare global {
  var __piTalkMode: boolean | undefined;
  var __piRequestFooterRender: (() => void) | undefined;
}

const TALK_MODE_INSTRUCTION = "For your next response only: discuss concisely without implementing anything, editing files, writing files, or running mutating commands. You may use read-only tools/commands to investigate the codebase when helpful.";
const THINKING_LEVELS = ["low", "high", "xhigh"] as const;

function slug(s: string) {
  return (s || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "plan";
}
function stamp() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"); }
async function gitRoot(pi: ExtensionAPI, cwd: string) {
  try {
    const r = await pi.exec("git", ["rev-parse", "--show-toplevel"], { timeout: 3000 });
    return r.code === 0 ? r.stdout.trim() : undefined;
  } catch { return undefined; }
}
async function readIndex(cwd: string): Promise<Index> {
  try { return JSON.parse(await readFile(path.join(cwd, INDEX_FILE), "utf8")); }
  catch { return { plans: [], activeBySession: {} }; }
}
async function writeIndex(cwd: string, idx: Index) {
  await mkdir(path.join(cwd, PLAN_DIR), { recursive: true });
  await writeFile(path.join(cwd, INDEX_FILE), JSON.stringify(idx, null, 2));
}
async function ensureIgnored(cwd: string) {
  const p = path.join(cwd, ".gitignore");
  const line = ".pi/plans/";
  try {
    const cur = existsSync(p) ? await readFile(p, "utf8") : "";
    if (!cur.split(/\r?\n/).includes(line)) await appendFile(p, `${cur.endsWith("\n") || cur.length === 0 ? "" : "\n"}${line}\n`);
  } catch { /* ignore */ }
}
function sessionKey(ctx: any) { return ctx.sessionManager.getSessionFile?.() || `cwd:${ctx.cwd}`; }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export default function(pi: ExtensionAPI) {
  registerHandoff(pi);

  pi.registerShortcut("shift+tab", {
    description: "Toggle talk mode",
    handler: async (ctx) => {
      globalThis.__piTalkMode = !globalThis.__piTalkMode;
      globalThis.__piRequestFooterRender?.();
      ctx.ui.notify(`Talk mode ${globalThis.__piTalkMode ? "on" : "off"}`, "info");
    },
  });

  pi.registerShortcut("ctrl+shift+p", {
    description: "Cycle thinking level: low/high/xhigh",
    handler: async (ctx) => {
      const current = pi.getThinkingLevel?.() ?? "low";
      const index = THINKING_LEVELS.indexOf(current as typeof THINKING_LEVELS[number]);
      const next = THINKING_LEVELS[(index + 1) % THINKING_LEVELS.length]!;
      pi.setThinkingLevel?.(next as any);
      ctx.ui.notify(`Thinking: ${next}`, "info");
    },
  });

  pi.on("input", async (event) => {
    if (!globalThis.__piTalkMode) return { action: "continue" };
    if (event.source === "extension") return { action: "continue" };
    if (!event.text.trim()) return { action: "continue" };
    return { action: "transform", text: `${TALK_MODE_INSTRUCTION}\n\n${event.text}`, images: event.images };
  });

  pi.registerTool({
    name: "save_plan",
    label: "Save Plan",
    description: "Save the current implementation plan as the active plan for this Pi session.",
    promptSnippet: "Save a concise implementation plan to .pi/plans and mark it active.",
    promptGuidelines: ["Use save_plan exactly once after creating a plan for /plan; do not implement code during planning."],
    parameters: Type.Object({
      title: Type.String({ description: "Short human-readable plan title" }),
      markdown: Type.String({ description: "Complete markdown plan" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      await ensureIgnored(ctx.cwd);
      const root = await gitRoot(pi, ctx.cwd);
      const id = `${stamp()}-${slug(params.title)}`;
      const rel = `${PLAN_DIR}/${id}.md`;
      const abs = path.join(ctx.cwd, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      const body = params.markdown.startsWith("#") ? params.markdown : `# ${params.title}\n\n${params.markdown}`;
      await writeFile(abs, `${body.trim()}\n`);

      const meta: PlanMeta = { id, title: params.title, path: rel, createdAt: new Date().toISOString(), cwd: ctx.cwd, gitRoot: root, sessionFile: ctx.sessionManager.getSessionFile?.(), leafId: ctx.sessionManager.getLeafId?.() };
      const idx = await readIndex(ctx.cwd);
      idx.plans = [...idx.plans.filter(p => p.id !== id), meta];
      idx.activeBySession[sessionKey(ctx)] = id;
      await writeIndex(ctx.cwd, idx);
      pi.appendEntry(`${EXT}:active-plan`, meta);
      if (process.env.CMUX_WORKSPACE_ID) {
        void (async () => {
          await sleep(1000);
          await pi.exec("cmux", ["markdown", "open", abs], { cwd: ctx.cwd, timeout: 5000 }).catch(() => undefined);
        })();
      }
      return { content: [{ type: "text", text: `Saved active plan: ${rel}` }], details: meta };
    }
  });

  pi.registerCommand("plan", {
    description: "Create a concise implementation plan and save it as this chat's active plan",
    handler: async (args, ctx) => {
      const goal = args?.trim() || "the user's requested change";
      await ctx.waitForIdle();
      pi.sendUserMessage(`Create a concise implementation plan for: ${goal}\n\nDo not implement or write code. Investigate the codebase as needed. When the plan is ready, call save_plan with a short title and the complete markdown plan. Keep it concise.`);
    }
  });

  pi.registerCommand("talk", {
    description: "Discuss concisely without implementing or editing files",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      pi.sendUserMessage(`${TALK_MODE_INSTRUCTION}\n\n${args || "Let's discuss."}`);
    }
  });

}
