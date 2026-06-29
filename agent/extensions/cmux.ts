import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, parse, resolve } from "node:path";
import { homedir } from "node:os";

// notify() currently only types info/warning/error in pi, so success is rendered as info with a ✅ prefix.
type NotifyType = "info" | "warning" | "error";
type CmuxTarget = { workspace?: string; surface?: string; tab?: string };
type RunKind = "server" | "task";
type RunEntry = { label: string; command: string; kind?: RunKind };
type RunRecord = {
  pid: number;
  command: string;
  cwd: string;
  logPath: string;
  kind?: RunKind;
  startedAt: number;
};
type ExecResult = { code: number | null; stdout: string; stderr: string; error?: Error };
type KillTarget = {
  pid: number;
  command: string;
  cwd?: string;
  logPath?: string;
  kind?: RunKind;
  ports: string[];
  tracked: boolean;
  processName?: string;
  label: string;
};

const RUN_REGISTRY_PATH = join(homedir(), ".pi", "agent", "run-processes.json");
const SERVER_READY_TIMEOUT_MS = 25_000;
const UNKNOWN_RUNNING_TIMEOUT_MS = 2_000;
const RUN_COMMAND_CACHE_TTL_MS = 30_000;

function inCmux() {
  return Boolean(process.env.CMUX_WORKSPACE_ID || process.env.CMUX_SURFACE_ID || process.env.CMUX_SOCKET_PATH);
}

function runCmux(args: string[]) {
  if (!inCmux()) return;

  execFile("cmux", args, { timeout: 5000 }, () => {
    // Best-effort integration: ignore failures when cmux CLI/socket is unavailable.
  });
}

function execCmux(args: string[]): Promise<string | undefined> {
  if (!inCmux()) return Promise.resolve(undefined);

  return new Promise((resolve) => {
    execFile("cmux", args, { timeout: 5000 }, (error, stdout) => {
      if (error) return resolve(undefined);
      resolve(stdout.trim());
    });
  });
}

function runCmuxJson(args: string[]): Promise<any | undefined> {
  if (!inCmux()) return Promise.resolve(undefined);

  return new Promise((resolve) => {
    execFile("cmux", args, { timeout: 5000 }, (error, stdout) => {
      if (error) return resolve(undefined);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(undefined);
      }
    });
  });
}

async function getCmuxTarget(): Promise<CmuxTarget> {
  const identified = await runCmuxJson(["--id-format", "both", "identify", "--json"]);
  const caller = identified?.caller;

  return {
    workspace: caller?.workspace_ref || caller?.workspace_id || process.env.CMUX_WORKSPACE_ID,
    surface: caller?.surface_ref || caller?.surface_id || process.env.CMUX_SURFACE_ID,
    tab: caller?.tab_ref || caller?.tab_id || process.env.CMUX_TAB_ID,
  };
}

function shorten(text: string, max = 28) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function notificationTitle(pi: ExtensionAPI, fallback: string) {
  return pi.getSessionName?.() || fallback;
}

function notify(ctx: any, message: string, type: NotifyType = "info") {
  ctx.ui.notify(message, type);
}

function runGit(args: string[], cwd = process.cwd()) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch {
    return "";
  }
}

function currentFolderLabel(cwd = process.cwd()) {
  const home = homedir();
  if (cwd === home) return "~";
  return basename(cwd) || "Session complete.";
}

function parseGithubRepoName(remote: string) {
  const match = remote.match(/github\.com[:/]([^/\s:]+)\/([^/\s?#]+?)(?:\.git)?(?:[?#].*)?$/i);
  return match?.[2]?.replace(/\.git$/i, "") || "";
}

function githubRepoName(cwd: string) {
  const originRepo = parseGithubRepoName(runGit(["config", "--get", "remote.origin.url"], cwd));
  if (originRepo) return originRepo;

  const remotes = runGit(["remote", "-v"], cwd);
  for (const line of remotes.split("\n")) {
    const repo = parseGithubRepoName(line.split(/\s+/)[1] || "");
    if (repo) return repo;
  }
  return "";
}

function gitPath(cwd: string, value: string) {
  if (!value) return "";
  return resolve(value.startsWith("/") ? value : join(cwd, value));
}

function isLinkedWorktree(cwd: string) {
  const gitDir = runGit(["rev-parse", "--git-dir"], cwd);
  const commonDir = runGit(["rev-parse", "--git-common-dir"], cwd);
  return Boolean(gitDir && commonDir && gitPath(cwd, gitDir) !== gitPath(cwd, commonDir));
}

function cmuxWorkspaceStartTitle(cwd: string) {
  const root = runGit(["rev-parse", "--show-toplevel"], cwd);
  if (!root) return currentFolderLabel(cwd);

  const repo = githubRepoName(cwd);
  if (!repo) return currentFolderLabel(cwd);

  const worktree = basename(root);
  return isLinkedWorktree(cwd) && worktree && worktree !== repo ? `${repo} · ${worktree}` : repo;
}

function contextLabel() {
  const root = runGit(["rev-parse", "--show-toplevel"]);
  if (!root) return currentFolderLabel();

  const repo = basename(root) || currentFolderLabel();
  const branch =
    runGit(["branch", "--show-current"]) ||
    runGit(["rev-parse", "--short", "HEAD"]);

  return branch ? `${repo} · ${branch}` : repo;
}

function sentence(text: string) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "Needs your attention.";
  const short = trimmed.length > 90 ? `${trimmed.slice(0, 87).trim()}...` : trimmed;
  return /[.!?]$/.test(short) ? short : `${short}.`;
}

function attentionBody(reason: string | undefined) {
  const context = contextLabel();
  if (!reason) return `${context} — Needs your attention.`;

  const line = reason.split("\n").find((l) => l.trim())?.trim() ?? reason;
  return `${context} — ${sentence(line.replace(/^Error:\s*/i, ""))}`;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function packageManager(cwd: string) {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

function addUnique(entries: RunEntry[], entry: RunEntry) {
  if (!entries.some((e) => e.command === entry.command)) entries.push(entry);
}

function scriptCommand(pm: string, script: string) {
  return pm === "npm" ? `npm run ${script}` : `${pm} ${script}`;
}

function shouldShowPackageScript(script: string) {
  return /^(dev|start|serve|server|build|clean|cache|reset|test|lint|typecheck|check|ios|android)(:|$)/i.test(script) ||
    /(dev|start|serve|server|build|clean|cache|reset|expo|ios|android)/i.test(script);
}

function classifyCommand(command: string): RunKind | undefined {
  const normalized = command.toLowerCase();

  if (/\b(rm\s+-rf|clean|cache\s+(clean|rm|prune)|store\s+prune|deno\s+clean)\b/.test(normalized)) return "task";
  if (/\b(build|test|lint|typecheck|check|xcodebuild|swift\s+build|swift\s+test)\b/.test(normalized)) return "task";
  if (/\b(dev|serve|server|start)\b/.test(normalized)) return "server";
  if (/\b(next\s+dev|vite|expo\s+start|react-scripts\s+start|nodemon|tsx\s+watch|node\s+--watch|deno\s+task\s+(dev|start|serve))\b/.test(normalized)) return "server";

  return undefined;
}

function detectPackageCommands(cwd: string, entries: RunEntry[]) {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const pm = packageManager(cwd);
    const scripts = pkg.scripts || {};

    for (const script of Object.keys(scripts)) {
      if (!shouldShowPackageScript(script)) continue;
      const cmd = scriptCommand(pm, script);
      addUnique(entries, { label: `${cmd} — package script`, command: cmd, kind: classifyCommand(cmd) });
    }

    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.next || existsSync(join(cwd, "next.config.js")) || existsSync(join(cwd, "next.config.mjs")) || existsSync(join(cwd, "next.config.ts"))) {
      addUnique(entries, { label: `${pm === "npm" ? "npx" : pm} next dev — Next server`, command: pm === "npm" ? "npx next dev" : `${pm} next dev`, kind: "server" });
      addUnique(entries, { label: `${pm === "npm" ? "npx" : pm} next build — Next build`, command: pm === "npm" ? "npx next build" : `${pm} next build`, kind: "task" });
      addUnique(entries, { label: "clear Next cache — rm -rf .next", command: "rm -rf .next && echo 'Cleared .next cache'", kind: "task" });
    }

    if (deps.convex || existsSync(join(cwd, "convex"))) {
      addUnique(entries, { label: `${pm} dlx convex dev — local backend`, command: `${pm} dlx convex dev`, kind: "server" });
    }

    if (deps.expo || existsSync(join(cwd, "app.json")) || existsSync(join(cwd, "app.config.js")) || existsSync(join(cwd, "app.config.ts"))) {
      addUnique(entries, { label: "expo start — clear cache", command: "npx expo start --clear", kind: "server" });
      addUnique(entries, { label: "expo run:ios — native build + run", command: "npx expo run:ios", kind: "task" });
      addUnique(entries, { label: "expo run:android — native build + run", command: "npx expo run:android", kind: "task" });
    }

    const cacheCommand = pm === "pnpm"
      ? "pnpm store prune"
      : pm === "yarn"
        ? "yarn cache clean"
        : pm === "bun"
          ? "bun pm cache rm"
          : "npm cache clean --force";
    addUnique(entries, { label: `${cacheCommand} — package manager cache`, command: cacheCommand, kind: "task" });
    addUnique(entries, {
      label: "clear JS build caches — .next/.turbo/.vite/dist/build",
      command: "rm -rf .next .nuxt .svelte-kit .turbo .vite node_modules/.cache dist build coverage && echo 'Cleared local JS build caches'",
      kind: "task",
    });
  } catch {
    // Ignore invalid package.json.
  }
}

function stripJsonComments(text: string) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function detectDenoCommands(cwd: string, entries: RunEntry[]) {
  const config = ["deno.json", "deno.jsonc"].map((name) => join(cwd, name)).find(existsSync);
  if (!config) return;

  try {
    const json = JSON.parse(stripJsonComments(readFileSync(config, "utf8")));
    for (const task of Object.keys(json.tasks || {})) {
      if (!shouldShowPackageScript(task)) continue;
      const command = `deno task ${task}`;
      addUnique(entries, { label: `${command} — Deno task`, command, kind: classifyCommand(command) });
    }
  } catch {
    // Ignore invalid deno.json/jsonc.
  }

  addUnique(entries, { label: "deno task dev — common Deno server", command: "deno task dev", kind: "server" });
  addUnique(entries, { label: "deno task build — common Deno build", command: "deno task build", kind: "task" });
  addUnique(entries, { label: "deno clean — clear Deno cache", command: "deno clean", kind: "task" });
}

function detectSwiftCommands(cwd: string, entries: RunEntry[]) {
  if (!existsSync(join(cwd, "Package.swift"))) return;

  addUnique(entries, { label: "swift run — run executable", command: "swift run", kind: "task" });
  addUnique(entries, { label: "swift build — build package", command: "swift build", kind: "task" });
  addUnique(entries, { label: "swift test — test package", command: "swift test", kind: "task" });
  addUnique(entries, { label: "clear Swift build cache — .build", command: "rm -rf .build && echo 'Cleared Swift .build cache'", kind: "task" });
}

function preferredSimulatorNameSync() {
  return "iPhone 17";
}

async function preferredSimulatorNameAsync() {
  try {
    const output = await execFileText("xcrun", ["simctl", "list", "devices", "available"], process.cwd(), 1200);
    for (const name of ["iPhone 17", "iPhone 16e", "iPhone 16", "iPhone 17 Pro", "iPhone 17 Pro Max", "iPhone Air"]) {
      if (output.stdout.includes(name)) return name;
    }
  } catch {
    // Fall back to a common current simulator name.
  }
  return preferredSimulatorNameSync();
}

function detectXcodeCommands(cwd: string, entries: RunEntry[], simulatorName = preferredSimulatorNameSync()) {
  let files: string[] = [];
  try {
    files = readdirSync(cwd);
  } catch {
    return;
  }

  const workspace = files.find((f) => f.endsWith(".xcworkspace"));
  const project = files.find((f) => f.endsWith(".xcodeproj"));
  const file = workspace || project;
  if (!file) return;

  const flag = workspace ? "-workspace" : "-project";
  const scheme = parse(file).name;
  const target = `${flag} ${shellQuote(file)} -scheme ${shellQuote(scheme)}`;
  const sim = simulatorName;
  const derivedData = ".pi/DerivedData";
  const simAppPath = `${derivedData}/Build/Products/Debug-iphonesimulator/${scheme}.app`;
  const phoneAppPath = `${derivedData}/Build/Products/Debug-iphoneos/${scheme}.app`;
  const simDestination = `platform=iOS Simulator,name=${sim}`;
  const phoneDestination = "generic/platform=iOS";
  const simBuild = `xcodebuild ${target} -configuration Debug -destination ${shellQuote(simDestination)} -derivedDataPath ${shellQuote(derivedData)} build`;
  const phoneBuild = `xcodebuild ${target} -configuration Debug -destination ${shellQuote(phoneDestination)} -derivedDataPath ${shellQuote(derivedData)} build`;
  const simRun = `SIM=${shellQuote(sim)}; APP=${shellQuote(simAppPath)}; xcrun simctl boot "$SIM" || true; open -a Simulator; ${simBuild} && xcrun simctl install booted "$APP" && BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist") && xcrun simctl launch booted "$BUNDLE_ID"`;
  const phoneDevice = `DEVICES_JSON=$(mktemp); xcrun devicectl list devices --json-output "$DEVICES_JSON" --timeout 10 >/dev/null && DEVICE=$(/usr/bin/python3 - "$DEVICES_JSON" <<'PY'\nimport json, sys\ndata=json.load(open(sys.argv[1]))\nfor d in data.get('result', {}).get('devices', []):\n    hw=d.get('hardwareProperties') or {}\n    conn=d.get('connectionProperties') or {}\n    if hw.get('platform') == 'iOS' and conn.get('transportType') == 'wired':\n        print(d.get('identifier',''))\n        break\nPY\n); rm -f "$DEVICES_JSON"; test -n "$DEVICE" || { echo 'No wired iPhone found by devicectl.'; exit 1; }`;
  const phoneRun = `APP=${shellQuote(phoneAppPath)}; ${phoneBuild} && ${phoneDevice} && xcrun devicectl device install app --device "$DEVICE" "$APP" && BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist") && xcrun devicectl device process launch --device "$DEVICE" "$BUNDLE_ID"`;

  addUnique(entries, { label: `ios sim run — ${scheme} → ${sim}`, command: simRun, kind: "task" });
  addUnique(entries, { label: `ios phone run — ${scheme} → wired iPhone`, command: phoneRun, kind: "task" });
  addUnique(entries, { label: `ios sim build — ${scheme} → ${sim}`, command: simBuild, kind: "task" });
  addUnique(entries, { label: `ios phone build — ${scheme} → connected iPhone`, command: phoneBuild, kind: "task" });
  addUnique(entries, { label: `ios clear build cache — ${scheme}`, command: `rm -rf ${shellQuote(derivedData)} && echo 'Cleared project build cache: ${derivedData}'`, kind: "task" });
}

function addFallbackCommands(entries: RunEntry[]) {
  for (const entry of [
    { label: "pnpm dev — common fallback", command: "pnpm dev", kind: "server" as const },
    { label: "npm run dev — common fallback", command: "npm run dev", kind: "server" as const },
    { label: "bun dev — common fallback", command: "bun dev", kind: "server" as const },
    { label: "deno task dev — common fallback", command: "deno task dev", kind: "server" as const },
  ]) addUnique(entries, entry);
}

function detectRunCommandsFast(cwd: string) {
  const entries: RunEntry[] = [];
  detectPackageCommands(cwd, entries);
  detectDenoCommands(cwd, entries);
  detectSwiftCommands(cwd, entries);
  detectXcodeCommands(cwd, entries);
  if (entries.length === 0) addFallbackCommands(entries);
  entries.push({ label: "custom — type command", command: "__custom__" });
  return entries;
}

async function detectRunCommandsFull(cwd: string) {
  const entries: RunEntry[] = [];
  detectPackageCommands(cwd, entries);
  detectDenoCommands(cwd, entries);
  detectSwiftCommands(cwd, entries);
  detectXcodeCommands(cwd, entries, await preferredSimulatorNameAsync());
  if (entries.length === 0) addFallbackCommands(entries);
  entries.push({ label: "custom — type command", command: "__custom__" });
  return entries;
}

let runCommandCache: { cwd: string; entries: RunEntry[]; generatedAt: number } | undefined;
let runCommandRefresh: Promise<void> | undefined;

function warmRunCommandCache(cwd: string) {
  if (runCommandRefresh) return;
  runCommandRefresh = detectRunCommandsFull(cwd)
    .then((entries) => {
      runCommandCache = { cwd, entries, generatedAt: Date.now() };
    })
    .catch(() => undefined)
    .finally(() => {
      runCommandRefresh = undefined;
    });
}

function getRunCommands(cwd: string) {
  warmRunCommandCache(cwd);

  if (runCommandCache?.cwd === cwd && Date.now() - runCommandCache.generatedAt < RUN_COMMAND_CACHE_TTL_MS) {
    return runCommandCache.entries;
  }

  const entries = detectRunCommandsFast(cwd);
  runCommandCache = { cwd, entries, generatedAt: Date.now() };
  return entries;
}

function surfaceFromCmuxOutput(output: string | undefined) {
  return output?.match(/\bsurface:[^\s)]+/)?.[0];
}

function surfaceId(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value.startsWith("surface:") ? value : undefined;
  return value.ref || value.id_ref || value.surface_ref || value.surfaceId || value.surface_id || value.id;
}

function paneSurfaceIds(pane: any): string[] {
  const raw = pane?.surface_refs || pane?.surfaceRefs || pane?.surfaces || pane?.surface_ids || [];
  return Array.isArray(raw) ? raw.map(surfaceId).filter(Boolean) : [];
}

async function focusedCmuxSurface(): Promise<string | undefined> {
  const identified = await runCmuxJson(["identify", "--json", "--no-caller"]);
  return surfaceId(identified?.focused) || surfaceId(identified);
}

async function reusableCmuxSurface(current: CmuxTarget): Promise<string | undefined> {
  const surfacesJson = await runCmuxJson(["--id-format", "both", "list-surfaces", "--json", ...(current.workspace ? ["--workspace", current.workspace] : [])]);
  const surfaces = surfacesJson?.surfaces || surfacesJson?.result?.surfaces;
  const reusable = Array.isArray(surfaces) ? surfaces.map(surfaceId).find((id: string | undefined) => id && id !== current.surface) : undefined;
  if (reusable) return reusable;

  const panesJson = await runCmuxJson(["--id-format", "both", "list-panes", "--json", ...(current.workspace ? ["--workspace", current.workspace] : [])]);
  const panes = panesJson?.panes || panesJson?.result?.panes;
  if (Array.isArray(panes) && panes.length > 1) {
    const otherPane = panes.find((pane: any) => !paneSurfaceIds(pane).includes(current.surface));
    const id = paneSurfaceIds(otherPane)[0];
    if (id && id !== current.surface) return id;
  }

  return undefined;
}

async function getOrCreateCmuxSurface(target: CmuxTarget): Promise<string | undefined> {
  const reusable = await reusableCmuxSurface(target);
  if (reusable) return reusable;

  const args = ["--id-format", "both", "new-split", "right", "--focus", "true"];
  if (target.workspace) args.push("--workspace", target.workspace);
  if (target.surface) args.push("--surface", target.surface);
  return surfaceFromCmuxOutput(await execCmux(args)) || await focusedCmuxSurface();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRunRegistry(): RunRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(RUN_REGISTRY_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((record) => typeof record?.pid === "number") : [];
  } catch {
    return [];
  }
}

function writeRunRegistry(records: RunRecord[]) {
  try {
    mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
    writeFileSync(RUN_REGISTRY_PATH, JSON.stringify(records, null, 2));
  } catch {
    // Best effort.
  }
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function saveRunRecord(record: RunRecord) {
  const records = readRunRegistry().filter((item) => item.pid !== record.pid && isPidAlive(item.pid));
  records.push(record);
  writeRunRegistry(records);
}

function removeRunRecord(pid: number) {
  writeRunRegistry(readRunRegistry().filter((item) => item.pid !== pid && isPidAlive(item.pid)));
}

function tailFile(path: string, maxBytes = 16_000) {
  try {
    const text = readFileSync(path, "utf8");
    return text.length > maxBytes ? text.slice(text.length - maxBytes) : text;
  } catch {
    return "";
  }
}

function findImportantLine(text: string, pattern: RegExp) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (pattern.test(lines[i])) return lines[i].trim();
  }
  return "";
}

function detectReadyLine(text: string) {
  return findImportantLine(
    text,
    /(ready|started|running|listening|compiled successfully|metro waiting|waiting on|local:|network:|localhost|127\.0\.0\.1|https?:\/\/|development server)/i,
  );
}

function detectErrorLine(text: string) {
  return findImportantLine(
    text,
    /\b(error|failed|exception|traceback|panic|fatal|command not found|cannot find module|eaddrinuse|address already in use|port .* in use|build failed)\b/i,
  );
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<{ exited: boolean; code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (exited: boolean, code: number | null, signal: NodeJS.Signals | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ exited, code, signal });
    };
    const timer = setTimeout(() => finish(false, null, null), timeoutMs);
    child.once("exit", (code, signal) => finish(true, code, signal));
  });
}

async function monitorTask(child: ChildProcess, record: RunRecord, ctx: any) {
  const exit = await waitForExit(child, 24 * 60 * 60 * 1000);
  removeRunRecord(record.pid);

  const output = tailFile(record.logPath);
  if (exit.code === 0) {
    notify(ctx, `✅ Successful: ${shorten(record.command, 72)} (log ${record.logPath})`, "info");
    return;
  }

  const reason = detectErrorLine(output) || `exit ${exit.code ?? exit.signal ?? "unknown"}`;
  notify(ctx, `❌ Failed: ${shorten(record.command, 64)} — ${shorten(reason, 100)} (log ${record.logPath})`, "error");
}

async function monitorServer(child: ChildProcess, record: RunRecord, ctx: any) {
  const started = Date.now();

  while (Date.now() - started < SERVER_READY_TIMEOUT_MS) {
    const exit = child.exitCode;
    const output = tailFile(record.logPath);
    const errorLine = detectErrorLine(output);
    if (errorLine) {
      removeRunRecord(record.pid);
      notify(ctx, `❌ Server error: ${shorten(record.command, 56)} — ${shorten(errorLine, 100)} (log ${record.logPath})`, "error");
      return;
    }

    const readyLine = detectReadyLine(output);
    if (readyLine && isPidAlive(record.pid)) {
      notify(ctx, `✅ Running: ${shorten(record.command, 68)} — ${shorten(readyLine, 80)} (pid ${record.pid})`, "info");
      return;
    }

    if (exit !== null) {
      removeRunRecord(record.pid);
      const reason = exit === 0 ? "server exited" : `exit ${exit}`;
      notify(ctx, `${exit === 0 ? "⚠️" : "❌"} Not running: ${shorten(record.command, 60)} — ${reason} (log ${record.logPath})`, exit === 0 ? "warning" : "error");
      return;
    }

    await sleep(500);
  }

  if (isPidAlive(record.pid)) {
    notify(ctx, `✅ Running: ${shorten(record.command, 72)} (pid ${record.pid}, log ${record.logPath})`, "info");
  } else {
    removeRunRecord(record.pid);
    notify(ctx, `❌ Not running: ${shorten(record.command, 72)} (log ${record.logPath})`, "error");
  }
}

async function monitorUnknown(child: ChildProcess, record: RunRecord, ctx: any) {
  const exit = await waitForExit(child, UNKNOWN_RUNNING_TIMEOUT_MS);
  if (exit.exited) {
    removeRunRecord(record.pid);
    const output = tailFile(record.logPath);
    if (exit.code === 0) {
      notify(ctx, `✅ Successful: ${shorten(record.command, 72)} (log ${record.logPath})`, "info");
    } else {
      const reason = detectErrorLine(output) || `exit ${exit.code ?? exit.signal ?? "unknown"}`;
      notify(ctx, `❌ Failed: ${shorten(record.command, 64)} — ${shorten(reason, 100)} (log ${record.logPath})`, "error");
    }
    return;
  }

  await monitorServer(child, record, ctx);
}

async function runInBackground(command: string, kind: RunKind | undefined, ctx: any) {
  const cwd = ctx.cwd || process.cwd();
  const logDir = join(cwd, ".pi");
  const logPath = join(logDir, "run.log");
  mkdirSync(logDir, { recursive: true });

  const out = openSync(logPath, "a");
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
  });
  try {
    closeSync(out);
  } catch {
    // Ignore close errors.
  }

  child.unref();

  const record: RunRecord = {
    pid: child.pid || 0,
    command,
    cwd,
    logPath,
    kind: kind || classifyCommand(command),
    startedAt: Date.now(),
  };

  if (!record.pid) {
    notify(ctx, `❌ Failed to start: ${shorten(command, 72)}`, "error");
    return;
  }

  saveRunRecord(record);
  notify(ctx, `Started: ${shorten(command, 72)} (pid ${record.pid}, log ${logPath})`, "info");

  child.once("exit", () => removeRunRecord(record.pid));

  if (!kind) {
    void monitorUnknown(child, record, ctx);
  } else if (record.kind === "server") {
    void monitorServer(child, record, ctx);
  } else {
    void monitorTask(child, record, ctx);
  }
}

function execFileText(command: string, args: string[], cwd: string, timeout = 5000): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        code: typeof (error as any)?.code === "number" ? (error as any).code : error ? 1 : 0,
        stdout: stdout?.toString() || "",
        stderr: stderr?.toString() || "",
        error: error || undefined,
      });
    });
  });
}

function parseLsof(output: string): Array<{ pid: number; command: string; ports: string[] }> {
  const byPid = new Map<number, { pid: number; command: string; ports: Set<string> }>();

  for (const line of output.split(/\r?\n/).slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    const command = parts[0];
    const pid = Number(parts[1]);
    if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue;

    const name = parts.slice(8).join(" ");
    const port = name.match(/(?:TCP|UDP)?\s*[^:]*:(\d+)(?:\s|$|\()/i)?.[1] || name.match(/:(\d+)$/)?.[1];
    const value = port ? `:${port}` : name;
    const current = byPid.get(pid) || { pid, command, ports: new Set<string>() };
    current.ports.add(value);
    byPid.set(pid, current);
  }

  return [...byPid.values()].map((item) => ({ ...item, ports: [...item.ports].sort() }));
}

async function listListeningServers(cwd: string) {
  const result = await execFileText("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], cwd, 5000);
  if (result.code !== 0 && !result.stdout.trim()) return [];
  return parseLsof(result.stdout);
}

async function collectKillTargets(cwd: string): Promise<KillTarget[]> {
  const tracked = readRunRegistry().filter((record) => isPidAlive(record.pid));
  writeRunRegistry(tracked);

  const targets = new Map<number, Omit<KillTarget, "label">>();
  for (const server of await listListeningServers(cwd)) {
    targets.set(server.pid, {
      pid: server.pid,
      command: server.command,
      ports: server.ports,
      tracked: false,
      processName: server.command,
    });
  }

  for (const record of tracked) {
    const existing = targets.get(record.pid);
    targets.set(record.pid, {
      pid: record.pid,
      command: record.command,
      cwd: record.cwd,
      logPath: record.logPath,
      kind: record.kind,
      ports: existing?.ports || [],
      tracked: true,
      processName: existing?.processName,
    });
  }

  return [...targets.values()]
    .sort((a, b) => Number(b.tracked) - Number(a.tracked) || a.pid - b.pid)
    .map((target) => {
      const portText = target.ports.length ? target.ports.join(",") : "no listening port yet";
      const project = target.cwd ? ` — ${basename(target.cwd) || target.cwd}` : "";
      const source = target.tracked ? "tracked" : "listening";
      return {
        ...target,
        label: `pid ${target.pid} — ${portText} — ${shorten(target.command, 56)}${project} — ${source}`,
      };
    });
}

function terminateProcess(pid: number, preferGroup: boolean) {
  if (preferGroup) {
    try {
      process.kill(-pid, "SIGTERM");
      return true;
    } catch {
      // Fall back to just the process.
    }
  }

  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

async function handleKill(ctx: any) {
  const targets = await collectKillTargets(ctx.cwd || process.cwd());
  if (!targets.length) {
    notify(ctx, "No running servers found.", "info");
    return;
  }

  const choice = await ctx.ui.select("Kill server", targets.map((target) => target.label));
  const target = targets.find((item) => item.label === choice);
  if (!target) return;

  const ok = await ctx.ui.confirm("Kill server?", `${target.label}\n\nSend SIGTERM${target.tracked ? " to the process group" : ""}?`);
  if (!ok) return;

  if (!terminateProcess(target.pid, target.tracked)) {
    notify(ctx, `❌ Could not kill pid ${target.pid}. It may have already exited.`, "error");
    removeRunRecord(target.pid);
    return;
  }

  await sleep(1200);
  if (isPidAlive(target.pid)) {
    notify(ctx, `⚠️ Sent SIGTERM to pid ${target.pid}, but it still appears alive.`, "warning");
  } else {
    removeRunRecord(target.pid);
    notify(ctx, `✅ Killed: pid ${target.pid} — ${shorten(target.command, 72)}`, "info");
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("run", {
    description: "Pick and run a project command in the background",
    handler: async (args, ctx) => {
      let command = args.trim();
      let kind: RunKind | undefined;

      if (!command) {
        const entries = getRunCommands(ctx.cwd || process.cwd());
        const choice = await ctx.ui.select("Run command", entries.map((e) => e.label));
        const entry = entries.find((e) => e.label === choice);
        if (!entry) return;

        command = entry.command;
        kind = entry.kind;
        if (command === "__custom__") {
          const custom = await ctx.ui.input("Command to run", "pnpm dev");
          if (!custom?.trim()) return;
          command = custom.trim();
          kind = classifyCommand(command);
        }
      } else {
        kind = classifyCommand(command);
      }

      await runInBackground(command, kind, ctx);
    },
  });

  pi.registerCommand("kill", {
    description: "Show running servers and kill one",
    handler: async (_args, ctx) => {
      await handleKill(ctx);
    },
  });

  let sawToolError = false;
  let firstError = "";

  pi.on("session_start", async (_event, ctx) => {
    const title = cmuxWorkspaceStartTitle(ctx.cwd);
    if (title) runCmux(["rename-workspace", "--", title]);
    warmRunCommandCache(ctx.cwd);
  });

  pi.on("resources_discover", async (event) => {
    warmRunCommandCache(event.cwd);
  });

  pi.on("before_agent_start", async () => {
    sawToolError = false;
    firstError = "";
  });

  pi.on("tool_execution_end", async (event) => {
    if (event.isError && !sawToolError) {
      sawToolError = true;
      const result = event.result as unknown;
      firstError = typeof result === "string" ? result : `${event.toolName} failed`;
    }
  });

  pi.on("agent_end", async () => {
    if (sawToolError) {
      runCmux(["notify", "--title", notificationTitle(pi, "Pi Needs Attention"), "--body", attentionBody(firstError)]);
      return;
    }

    runCmux(["notify", "--title", notificationTitle(pi, "Pi Done"), "--body", contextLabel()]);
  });
}
