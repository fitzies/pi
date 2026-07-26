import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const PUSH_PROMPT = `Commit and push only the changes you made in this chat/session. Do not create a PR or merge anything.

Important safety rule:
- Do not commit unrelated work, pre-existing dirty files, or edits made by another agent/user in the same worktree.
- Before staging, inspect \`git status --short\` and the relevant diffs. Only stage files/hunks that belong to your own amendments from this session.
- If you cannot confidently separate your changes from someone else's, stop and ask the user instead of committing.

Steps:
1. Inspect \`git status --short\` and the relevant diffs before committing.
2. Recommend and apply a sensible split into small, cohesive commits when your changes are separable.
   - Prefer commits that can be understood, reverted, or debugged independently later.
   - Avoid mixing unrelated fixes/refactors/features in the same commit.
3. Stage each logical commit carefully, using pathspecs or patch staging when appropriate. Do not use \`git add -A\` unless every dirty change is yours and belongs in the commit. If the changes are already one cohesive unit, a single commit is fine.
4. Write clear, concise commit messages for each commit.
5. Push to the current branch's remote.
   - If the branch has no upstream, push with upstream tracking.
   - If there is no git remote, commit only and say there was no remote to push to.

Keep the final response short and list the commit(s) pushed.`;

type CheckBucket = "pass" | "pending" | "fail" | "skipping" | "cancel";

type GhCheck = {
	bucket?: string;
	completedAt?: string;
	description?: string;
	link?: string;
	name?: string;
	startedAt?: string;
	state?: string;
	workflow?: string;
};

type PrInfo = {
	baseRefName?: string;
	body?: string;
	headRefName?: string;
	isDraft?: boolean;
	mergeable?: string;
	number: number;
	reviewDecision?: string;
	state?: string;
	title?: string;
	url?: string;
};

type IssueAttachment = {
	repo: string;
	number: number;
	title?: string;
	url?: string;
	source?: string;
};

type Snapshot = {
	checkedAt: Date;
	checks: GhCheck[];
	error?: string;
	pr?: PrInfo;
};

type MergeMethod = "squash" | "merge" | "rebase";

type MergeOptions = {
	auto: boolean;
	deleteBranch: boolean;
	admin: boolean;
	method: MergeMethod;
	target?: string;
};

const POLL_MS = 3_000;

function tokenizeArgs(input: string): string[] {
	const tokens: string[] = [];
	const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(input))) {
		const raw = match[1] ?? match[2] ?? match[3] ?? "";
		tokens.push(raw.replace(/\\(["'\\ ])/g, "$1"));
	}
	return tokens;
}

function parsePrTarget(args: string): string | undefined {
	return tokenizeArgs(args).find((token) => !token.startsWith("-"));
}

function prCommitMessage(args: string): string {
	return args.trim() || "chore: update changes";
}

function parseMergeOptions(args: string): { ok: true; options: MergeOptions } | { ok: false; error: string } {
	const options: MergeOptions = { auto: false, deleteBranch: false, admin: false, method: "merge" };

	for (const token of tokenizeArgs(args)) {
		if (token === "--squash" || token === "-s") options.method = "squash";
		else if (token === "--merge" || token === "-m") options.method = "merge";
		else if (token === "--rebase" || token === "-r") options.method = "rebase";
		else if (token === "--delete-branch" || token === "-d") options.deleteBranch = true;
		else if (token === "--auto") options.auto = true;
		else if (token === "--admin") options.admin = true;
		else if (token.startsWith("-")) return { ok: false, error: `Unknown /merge option: ${token}` };
		else if (!options.target) options.target = token;
		else return { ok: false, error: `Unexpected /merge argument: ${token}` };
	}

	return { ok: true, options };
}

function ghTargetArgs(target?: string): string[] {
	return target ? [target] : [];
}

function issueRef(issue: IssueAttachment): string {
	return `${issue.repo}#${issue.number}`;
}

function closingLine(issue: IssueAttachment, cwdRepo?: string): string {
	return issue.repo === cwdRepo ? `Closes #${issue.number}` : `Closes ${issue.repo}#${issue.number}`;
}

function hasClosingKeyword(body: string | undefined, issue: IssueAttachment): boolean {
	if (!body) return false;
	const escapedRepo = issue.repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const n = issue.number;
	return new RegExp(`\\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+(${escapedRepo})?#${n}\\b`, "i").test(body);
}

async function currentRepoFullName(pi: ExtensionAPI, cwd: string): Promise<string | undefined> {
	const result = await pi.exec("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { cwd, timeout: 10_000 });
	return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

async function loadIssueAttachment(cwd: string): Promise<IssueAttachment | undefined> {
	const path = join(cwd, ".pi", "issue.json");
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		if (typeof parsed?.repo !== "string" || typeof parsed?.number !== "number") return undefined;
		return parsed as IssueAttachment;
	} catch {
		return undefined;
	}
}

async function loadPrSnapshot(
	pi: ExtensionAPI,
	cwd: string,
	target?: string,
	signal?: AbortSignal,
): Promise<Snapshot> {
	const view = await pi.exec(
		"gh",
		[
			"pr",
			"view",
			...ghTargetArgs(target),
			"--json",
			"number,title,url,body,headRefName,baseRefName,state,isDraft,mergeable,reviewDecision",
		],
		{ cwd, timeout: 15_000, signal },
	);

	if (view.code !== 0) {
		return {
			checkedAt: new Date(),
			checks: [],
			error: cleanError(view.stderr || view.stdout || `gh pr view exited ${view.code}`),
		};
	}

	let pr: PrInfo;
	try {
		pr = JSON.parse(view.stdout) as PrInfo;
	} catch {
		return { checkedAt: new Date(), checks: [], error: "Could not parse `gh pr view` JSON output." };
	}

	const checks = await pi.exec(
		"gh",
		[
			"pr",
			"checks",
			...ghTargetArgs(target ?? String(pr.number)),
			"--json",
			"bucket,completedAt,description,link,name,startedAt,state,workflow",
		],
		{ cwd, timeout: 15_000, signal },
	);

	const checksError = cleanError(checks.stderr || checks.stdout || `gh pr checks exited ${checks.code}`);
	const noChecksReported = checks.code !== 0 && /no checks reported/i.test(checksError);

	if (noChecksReported) {
		return { checkedAt: new Date(), checks: [], pr };
	}

	if (checks.code !== 0 && checks.code !== 8) {
		return {
			checkedAt: new Date(),
			checks: [],
			error: checksError,
			pr,
		};
	}

	try {
		return { checkedAt: new Date(), checks: JSON.parse(checks.stdout || "[]") as GhCheck[], pr };
	} catch {
		return { checkedAt: new Date(), checks: [], error: "Could not parse `gh pr checks` JSON output.", pr };
	}
}

function cleanError(text: string): string {
	return text.trim().replace(/\s+/g, " ") || "Unknown error";
}

function bucketOf(check: GhCheck): CheckBucket {
	const bucket = (check.bucket ?? "").toLowerCase();
	if (bucket === "pass" || bucket === "pending" || bucket === "fail" || bucket === "skipping" || bucket === "cancel") {
		return bucket;
	}

	const state = (check.state ?? "").toLowerCase();
	if (["success", "successful", "passed", "neutral"].includes(state)) return "pass";
	if (["failure", "failed", "error", "timed_out", "action_required"].includes(state)) return "fail";
	if (["cancelled", "canceled"].includes(state)) return "cancel";
	if (["skipped", "skipping"].includes(state)) return "skipping";
	return "pending";
}

function checkCounts(checks: GhCheck[]) {
	const counts = { pass: 0, pending: 0, fail: 0, skipping: 0, cancel: 0 };
	for (const check of checks) counts[bucketOf(check)] += 1;
	return counts;
}

function checksSettled(checks: GhCheck[]): boolean {
	return checkCounts(checks).pending === 0;
}

function checkLabel(check: GhCheck): string {
	const name = check.name || "Unnamed check";
	return check.workflow && check.workflow !== name ? `${check.workflow} / ${name}` : name;
}

function statusWord(check: GhCheck): string {
	return (check.state || check.bucket || "unknown").toLowerCase().replace(/_/g, " ");
}

function failedOrSkippedReason(check: GhCheck): string {
	const description = cleanError(check.description ?? "");
	return description === "Unknown error" ? "No reason provided by GitHub/provider." : description;
}

function shortUrl(url: string): string {
	return url.replace(/^https?:\/\//, "");
}

function icon(bucket: CheckBucket): string {
	if (bucket === "pass") return "✓";
	if (bucket === "pending") return "◷";
	if (bucket === "fail") return "✕";
	if (bucket === "cancel") return "⊘";
	return "↷";
}

function color(theme: any, bucket: CheckBucket, text: string): string {
	if (bucket === "pass") return theme.fg("success", text);
	if (bucket === "fail" || bucket === "cancel") return theme.fg("error", text);
	if (bucket === "pending") return theme.fg("warning", text);
	return theme.fg("muted", text);
}

function padAnsi(text: string, width: number): string {
	const clipped = truncateToWidth(text, Math.max(0, width), "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function topBorder(title: string, width: number): string {
	const label = `─ ${title} `;
	return `╭${label}${"─".repeat(Math.max(0, width - visibleWidth(label) - 2))}╮`;
}

function midBorder(title: string, width: number): string {
	const label = `─ ${title} `;
	return `├${label}${"─".repeat(Math.max(0, width - visibleWidth(label) - 2))}┤`;
}

function bottomBorder(width: number): string {
	return `╰${"─".repeat(Math.max(0, width - 2))}╯`;
}

function boxedLine(text: string, width: number): string {
	return `│${padAnsi(` ${text}`, width - 2)}│`;
}

function fmtPrTitle(pr?: PrInfo): string {
	return pr ? `#${pr.number} ${pr.title ?? ""}`.trim() : "Pull Request";
}

function prNumberLabel(pr?: PrInfo): string {
	return pr ? `PR #${pr.number}` : "PR";
}

function prBranchLabel(pr?: PrInfo): string {
	return pr ? `${pr.headRefName ?? "?"} → ${pr.baseRefName ?? "?"}` : "GitHub PR";
}

function interestingCheck(checks: GhCheck[]): GhCheck | undefined {
	return checks.find((check) => ["fail", "cancel"].includes(bucketOf(check))) ?? checks.find((check) => bucketOf(check) === "skipping");
}

function prChecksNotification(snapshot: Snapshot): { title: string; subtitle: string; body: string } {
	const counts = checkCounts(snapshot.checks);
	const prLabel = prNumberLabel(snapshot.pr);
	const subtitle = prBranchLabel(snapshot.pr);
	const detail = interestingCheck(snapshot.checks);
	const summary = `${counts.pass} passed · ${counts.pending} pending · ${counts.fail} failed · ${counts.skipping} skipped · ${counts.cancel} cancelled`;

	if (snapshot.error) {
		return { title: `✕ ${prLabel} checks error`, subtitle, body: snapshot.error };
	}
	if (counts.fail > 0 || counts.cancel > 0) {
		const reason = detail ? ` · ${checkLabel(detail)} — ${failedOrSkippedReason(detail)}` : "";
		return { title: `✕ ${prLabel} checks failed`, subtitle, body: `${summary}${reason}` };
	}
	if (counts.skipping > 0) {
		const reason = detail ? ` · ${checkLabel(detail)} — ${failedOrSkippedReason(detail)}` : "";
		return { title: `⚠ ${prLabel} checks settled`, subtitle, body: `${summary}${reason}` };
	}
	return { title: `✓ ${prLabel} checks passed`, subtitle, body: summary };
}

function mergeNotification(
	snapshot: Snapshot | undefined,
	options: MergeOptions,
	kind: "merged" | "queued" | "failed" | "blocked",
	message: string,
): { title: string; subtitle: string; body: string } {
	const prLabel = prNumberLabel(snapshot?.pr);
	const subtitle = snapshot?.pr?.baseRefName ?? prBranchLabel(snapshot?.pr);
	if (kind === "merged") {
		return { title: `✓ Merged ${prLabel}`, subtitle, body: `${options.method} merged ${prBranchLabel(snapshot?.pr)}` };
	}
	if (kind === "queued") {
		return { title: `◷ ${prLabel} queued for merge`, subtitle, body: message };
	}
	if (kind === "blocked") {
		return { title: `⚠ Merge blocked for ${prLabel}`, subtitle, body: message };
	}
	return { title: `✕ Merge failed for ${prLabel}`, subtitle, body: message };
}

async function notifyCmux(pi: ExtensionAPI, ctx: any, notification: { title: string; subtitle?: string; body: string }): Promise<void> {
	try {
		await pi.exec(
			"cmux",
			[
				"notify",
				"--title",
				notification.title,
				...(notification.subtitle ? ["--subtitle", notification.subtitle] : []),
				"--body",
				notification.body,
			],
			{ cwd: ctx.cwd, timeout: 5_000 },
		);
	} catch {
		// cmux may be unavailable outside cmux; never fail /pr or /merge because notification failed.
	}
}

async function loadCustomEditorBase(): Promise<any> {
	try {
		const root = (await import("@earendil-works/pi-coding-agent")) as any;
		if (root.CustomEditor) return root.CustomEditor;
	} catch {}

	const candidates: string[] = [];
	try {
		const cliPath = realpathSync(process.argv[1] ?? "");
		candidates.push(join(dirname(cliPath), "modes/interactive/components/custom-editor.js"));
	} catch {}
	candidates.push(
		"/Users/olifitgerald/.nvm/versions/node/v22.12.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/custom-editor.js",
	);

	for (const candidate of candidates) {
		try {
			const mod = (await import(candidate)) as any;
			if (mod.CustomEditor) return mod.CustomEditor;
		} catch {}
	}

	throw new Error("pr: Could not load Pi CustomEditor.");
}

class PrStatusComponent {
	private snapshot: Snapshot = { checkedAt: new Date(), checks: [] };
	private loading = true;
	private stopped = false;

	constructor(
		private readonly theme: any,
		private readonly done: () => void,
		private readonly stop: () => void,
	) {}

	setSnapshot(snapshot: Snapshot, loading: boolean): void {
		this.snapshot = snapshot;
		this.loading = loading;
	}

	setLoading(loading: boolean): void {
		this.loading = loading;
	}

	setStopped(): void {
		this.stopped = true;
		this.loading = false;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === "q") {
			this.stop();
			this.done();
		}
	}

	render(width: number): string[] {
		const w = Math.min(Math.max(44, width), 78);
		const { pr, checks, error, checkedAt } = this.snapshot;
		const counts = checkCounts(checks);
		const pending = counts.pending > 0;
		const lines: string[] = [topBorder("Pull Request", w)];

		if (pr) {
			lines.push(boxedLine(`${this.theme.fg("muted", "Branch")}  ${pr.headRefName ?? "?"} → ${pr.baseRefName ?? "?"}`, w));
			lines.push(boxedLine(`${this.theme.fg("muted", "PR")}      #${pr.number} ${pr.title ?? ""}`, w));
			if (pr.url) lines.push(boxedLine(`${this.theme.fg("muted", "URL")}     ${pr.url.replace(/^https?:\/\//, "")}`, w));
		} else {
			lines.push(boxedLine(this.theme.fg("warning", "Resolving PR for current branch..."), w));
		}

		lines.push(midBorder("Checks", w));
		lines.push(
			boxedLine(
				`${color(this.theme, "pass", `✓ ${counts.pass} passed`)}     ${color(
					this.theme,
					"pending",
					`◷ ${counts.pending} pending`,
				)}     ${color(this.theme, "fail", `✕ ${counts.fail} failed`)}`,
				w,
			),
		);

		if (counts.cancel || counts.skipping) {
			lines.push(
				boxedLine(
					`${color(this.theme, "cancel", `⊘ ${counts.cancel} cancelled`)}     ${color(
						this.theme,
						"skipping",
						`↷ ${counts.skipping} skipped`,
					)}`,
					w,
				),
			);
		}

		lines.push(boxedLine("", w));

		if (error) {
			lines.push(boxedLine(this.theme.fg("error", `Error: ${error}`), w));
		} else if (checks.length === 0 && !this.loading) {
			lines.push(boxedLine(this.theme.fg("muted", "No checks reported by GitHub."), w));
		} else {
			for (const check of checks.slice(0, 12)) {
				const bucket = bucketOf(check);
				const labelWidth = w - 18;
				const left = color(this.theme, bucket, icon(bucket)) + " " + truncateToWidth(checkLabel(check), labelWidth, "…");
				const right = this.theme.fg("muted", statusWord(check));
				lines.push(boxedLine(`${padAnsi(left, labelWidth)} ${right}`, w));

				if (bucket === "fail" || bucket === "skipping" || bucket === "cancel") {
					lines.push(boxedLine(this.theme.fg("dim", `  Reason: ${failedOrSkippedReason(check)}`), w));
					if (check.link) lines.push(boxedLine(this.theme.fg("dim", `  Details: ${shortUrl(check.link)}`), w));
				}
			}
			if (checks.length > 12) lines.push(boxedLine(this.theme.fg("dim", `… ${checks.length - 12} more checks`), w));
		}

		lines.push(midBorder("Status", w));
		const refresh = pending && !this.stopped ? "updates every 3s" : "settled";
		const state = this.loading ? "checking..." : refresh;
		lines.push(boxedLine(`${this.theme.fg("muted", "Last")} ${checkedAt.toLocaleTimeString()}  ${this.theme.fg("dim", state)}`, w));
		lines.push(boxedLine(this.theme.fg("dim", pending ? "Esc/q close" : "Enter/Esc close"), w));
		lines.push(bottomBorder(w));
		return lines.map((line) => truncateToWidth(line, width, ""));
	}

	invalidate(): void {}
}

class MergeComponent {
	private snapshot?: Snapshot;
	private stage: "checking" | "ready" | "blocked" | "merging" | "done" | "failed" = "checking";
	private message = "Checking merge status...";
	private mergeOutput = "";

	constructor(
		private readonly theme: any,
		private readonly options: MergeOptions,
		private readonly issue: IssueAttachment | undefined,
		private readonly done: () => void,
		private readonly onMerge: () => void,
		private readonly onCancel: () => void,
	) {}

	setSnapshot(snapshot: Snapshot): void {
		this.snapshot = snapshot;
	}

	getSnapshot(): Snapshot | undefined {
		return this.snapshot;
	}

	setStage(stage: typeof this.stage, message: string, output = ""): void {
		this.stage = stage;
		this.message = message;
		this.mergeOutput = output;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || data === "q") {
			this.onCancel();
			this.done();
			return;
		}
		if (!matchesKey(data, Key.enter)) return;
		if (this.stage === "ready") this.onMerge();
		else if (this.stage === "blocked" || this.stage === "done" || this.stage === "failed") this.done();
	}

	render(width: number): string[] {
		const w = Math.min(Math.max(44, width), 78);
		const pr = this.snapshot?.pr;
		const checks = this.snapshot?.checks ?? [];
		const counts = checkCounts(checks);
		const title = pr ? `Merge PR #${pr.number}` : "Merge PR";
		const lines: string[] = [topBorder(title, w)];

		lines.push(boxedLine(`${this.theme.fg("muted", "Status")}  ${this.renderStage()}`, w));
		if (pr) {
			lines.push(boxedLine(`${this.theme.fg("muted", "Branch")}  ${pr.headRefName ?? "?"} → ${pr.baseRefName ?? "?"}`, w));
			lines.push(boxedLine(`${this.theme.fg("muted", "PR")}      ${fmtPrTitle(pr)}`, w));
			lines.push(boxedLine(`${this.theme.fg("muted", "Method")}  ${this.options.method}${this.options.auto ? " + auto" : ""}`, w));
		}
		lines.push(
			boxedLine(
				`${color(this.theme, "pass", `✓ ${counts.pass} passed`)}  ${color(
					this.theme,
					"pending",
					`◷ ${counts.pending} pending`,
				)}  ${color(this.theme, "fail", `✕ ${counts.fail} failed`)}`,
				w,
			),
		);

		lines.push(midBorder("Issue", w));
		if (this.issue) {
			const linked = hasClosingKeyword(pr?.body, this.issue);
			lines.push(boxedLine(`${this.theme.fg("muted", "Attached")} ${issueRef(this.issue)}`, w));
			if (this.issue.title) lines.push(boxedLine(truncateToWidth(this.issue.title, w - 4, "…"), w));
			lines.push(
				boxedLine(
					linked
						? color(this.theme, "pass", "✓ PR body has closing keyword; GitHub will close it after merge")
						: this.theme.fg("warning", "No closing keyword found in PR body; will not auto-close"),
					w,
				),
			);
		} else {
			lines.push(boxedLine(this.theme.fg("muted", "No explicit .pi/issue.json attachment found."), w));
		}

		lines.push(midBorder("Merge", w));
		lines.push(boxedLine(this.message, w));
		if (this.stage === "done" && pr) {
			lines.push(boxedLine(color(this.theme, "pass", pr.state === "MERGED" ? `✓ merged into ${pr.baseRefName ?? "base"}` : "✓ merge request accepted"), w));
			lines.push(
				boxedLine(
					this.options.deleteBranch
						? color(this.theme, "pass", `✓ branch delete requested: ${pr.headRefName ?? "head"}`)
						: this.theme.fg("muted", `branch kept: ${pr.headRefName ?? "head"}`),
					w,
				),
			);
		}
		if (this.mergeOutput) {
			for (const line of this.mergeOutput.split("\n").slice(0, 4)) lines.push(boxedLine(this.theme.fg("dim", line), w));
		}
		lines.push(boxedLine(this.helpText(), w));
		lines.push(bottomBorder(w));
		return lines.map((line) => truncateToWidth(line, width, ""));
	}

	private renderStage(): string {
		if (this.stage === "checking" || this.stage === "merging") return this.theme.fg("warning", this.stage);
		if (this.stage === "ready" || this.stage === "done") return this.theme.fg("success", this.stage);
		return this.theme.fg("error", this.stage);
	}

	private helpText(): string {
		if (this.stage === "ready") return this.theme.fg("dim", "Enter merge • Esc cancel");
		if (this.stage === "checking" || this.stage === "merging") return this.theme.fg("dim", "Esc cancel");
		return this.theme.fg("dim", "Enter/Esc close");
	}

	invalidate(): void {}
}

function mergeBlockReason(snapshot: Snapshot, options: MergeOptions): string | undefined {
	const pr = snapshot.pr;
	const counts = checkCounts(snapshot.checks);
	if (snapshot.error) return snapshot.error;
	if (!pr) return "Could not resolve PR.";
	if (pr.isDraft) return "PR is a draft.";
	if (pr.mergeable === "CONFLICTING") return "PR has merge conflicts.";
	if (pr.reviewDecision === "CHANGES_REQUESTED") return "Reviews have requested changes.";
	if ((counts.fail > 0 || counts.cancel > 0) && !options.admin) return "Checks failed/cancelled. Use --admin to bypass.";
	if (counts.pending > 0 && !options.auto) return "Checks are pending. Use /merge --auto or wait.";
	return undefined;
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
	await new Promise<void>((resolve) => {
		if (signal.aborted) return resolve();
		const timeout = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				resolve();
			},
			{ once: true },
		);
	});
}

async function runGitHubStep(pi: ExtensionAPI, ctx: any, label: string, command: string, args: string[]): Promise<string> {
	ctx.ui.setStatus("pr", label);
	const result = await pi.exec(command, args, { cwd: ctx.cwd, timeout: 120_000 });
	if (result.code !== 0) {
		throw new Error(`${label} failed: ${cleanError(result.stderr || result.stdout || `exit code ${result.code}`)}`);
	}
	return result.stdout.trim();
}

async function ensurePrIssueLink(pi: ExtensionAPI, ctx: any, issue: IssueAttachment | undefined): Promise<void> {
	if (!issue) return;
	ctx.ui.setStatus("pr", "pr: linking issue");
	const view = await pi.exec("gh", ["pr", "view", "--json", "number,body"], { cwd: ctx.cwd, timeout: 20_000 });
	if (view.code !== 0) throw new Error(`pr: linking issue failed: ${cleanError(view.stderr || view.stdout || "could not view PR")}`);
	let pr: { number: number; body?: string };
	try {
		pr = JSON.parse(view.stdout) as { number: number; body?: string };
	} catch {
		throw new Error("pr: linking issue failed: could not parse PR body");
	}
	if (hasClosingKeyword(pr.body, issue)) return;
	const repo = await currentRepoFullName(pi, ctx.cwd);
	const line = closingLine(issue, repo);
	const nextBody = `${(pr.body ?? "").trim()}${(pr.body ?? "").trim() ? "\n\n" : ""}${line}`;
	await runGitHubStep(pi, ctx, "pr: updating issue link", "gh", ["pr", "edit", String(pr.number), "--body", nextBody]);
}

async function preparePrBranch(pi: ExtensionAPI, ctx: any, message: string): Promise<void> {
	const issue = await loadIssueAttachment(ctx.cwd);
	try {
		const status = await pi.exec("git", ["status", "--porcelain"], { cwd: ctx.cwd, timeout: 15_000 });
		if (status.code !== 0) throw new Error(cleanError(status.stderr || status.stdout || "git status failed"));

		if (status.stdout.trim()) {
			await runGitHubStep(pi, ctx, "pr: staging all files", "git", ["add", "-A"]);
			await runGitHubStep(pi, ctx, "pr: committing", "git", ["commit", "-m", message]);
		}

		await runGitHubStep(pi, ctx, "pr: pushing", "git", ["push", "-u", "origin", "HEAD"]);

		ctx.ui.setStatus("pr", "pr: checking existing PR");
		const existing = await pi.exec("gh", ["pr", "view", "--json", "number,url"], { cwd: ctx.cwd, timeout: 20_000 });
		if (existing.code !== 0) {
			await runGitHubStep(pi, ctx, "pr: creating", "gh", ["pr", "create", "--fill"]);
		}
		await ensurePrIssueLink(pi, ctx, issue);
	} finally {
		ctx.ui.setStatus("pr", undefined);
	}
}

async function runPrFlow(pi: ExtensionAPI, ctx: any, args: string): Promise<void> {
	try {
		await preparePrBranch(pi, ctx, prCommitMessage(args));
		await showPrUi(pi, ctx);
	} catch (error) {
		ctx.ui.setStatus("pr", undefined);
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
	}
}

async function showPrUi(pi: ExtensionAPI, ctx: any, target?: string): Promise<void> {
	const controller = new AbortController();
	await ctx.ui.custom<void>((tui: any, theme: any, _keybindings: any, done: () => void) => {
		let component: PrStatusComponent;
		const stop = () => controller.abort();
		component = new PrStatusComponent(theme, done, stop);

		void (async () => {
			while (!controller.signal.aborted) {
				component.setLoading(true);
				tui.requestRender();
				const snapshot = await loadPrSnapshot(pi, ctx.cwd, target, controller.signal);
				component.setSnapshot(snapshot, false);
				tui.requestRender();
				if (snapshot.error || checksSettled(snapshot.checks)) {
					component.setStopped();
					tui.requestRender();
					void notifyCmux(pi, ctx, prChecksNotification(snapshot));
					break;
				}
				await delay(POLL_MS, controller.signal);
			}
		})();

		return component;
	});
}

async function showMergeUi(pi: ExtensionAPI, ctx: any, options: MergeOptions): Promise<void> {
	const issue = await loadIssueAttachment(ctx.cwd);
	const controller = new AbortController();
	await ctx.ui.custom<void>((tui: any, theme: any, _keybindings: any, done: () => void) => {
		let component: MergeComponent;
		let merging = false;

		const finish = () => controller.abort();
		const runMerge = async () => {
			if (merging) return;
			merging = true;
			component.setStage("merging", "Merging with GitHub...");
			tui.requestRender();

			const prNumber = component.getSnapshot()?.pr?.number.toString();
			const mergeTarget = options.target ?? prNumber;
			const mergeArgs = [
				"pr",
				"merge",
				...ghTargetArgs(mergeTarget),
				`--${options.method}`,
				...(options.deleteBranch ? ["--delete-branch"] : []),
				...(options.auto ? ["--auto"] : []),
				...(options.admin ? ["--admin"] : []),
			];
			const result = await pi.exec("gh", mergeArgs, { cwd: ctx.cwd, timeout: 60_000, signal: controller.signal });
			const output = cleanError([result.stdout, result.stderr].filter(Boolean).join("\n"));
			if (result.code !== 0) {
				const message = `Merge failed: ${output || `exit code ${result.code}`}`;
				component.setStage("failed", message, output);
				void notifyCmux(pi, ctx, mergeNotification(component.getSnapshot(), options, "failed", message));
				tui.requestRender();
				return;
			}

			const current = await loadPrSnapshot(pi, ctx.cwd, mergeTarget, controller.signal);
			component.setSnapshot(current);
			const doneMessage = current.pr?.state === "MERGED" ? "Successfully merged." : "Auto-merge/merge queue request accepted.";
			component.setStage("done", doneMessage, output);
			void notifyCmux(pi, ctx, mergeNotification(current, options, current.pr?.state === "MERGED" ? "merged" : "queued", doneMessage));
			tui.requestRender();
		};

		component = new MergeComponent(theme, options, issue, done, runMerge, finish);

		void (async () => {
			const snapshot = await loadPrSnapshot(pi, ctx.cwd, options.target, controller.signal);
			component.setSnapshot(snapshot);
			const block = mergeBlockReason(snapshot, options);
			component.setStage(block ? "blocked" : "ready", block ?? "Ready to merge.");
			if (block) void notifyCmux(pi, ctx, mergeNotification(snapshot, options, "blocked", block));
			tui.requestRender();
		})();

		return component;
	});
}

function sendPromptCommand(pi: ExtensionAPI, ctx: any, commandName: string, prompt: string): void {
	if (ctx.isIdle()) {
		pi.sendUserMessage(prompt);
	} else {
		pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		if (ctx.hasUI) ctx.ui.notify(`Queued /${commandName} as a follow-up`, "info");
	}
}

export default async function prMergeExtension(pi: ExtensionAPI): Promise<void> {
	const prHandler = async (args: string, ctx: any) => {
		await ctx.waitForIdle();
		await runPrFlow(pi, ctx, args);
	};

	pi.registerCommand("pr", {
		description: "Stage, commit, push, create/open PR, and show live checks",
		handler: prHandler,
	});

	pi.registerCommand("merge", {
		description: "Merge the current GitHub PR after checking status",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			const parsed = parseMergeOptions(args);
			if (!parsed.ok) {
				ctx.ui.notify(parsed.error, "error");
				return;
			}
			await showMergeUi(pi, ctx, parsed.options);
		},
	});

	pi.registerCommand("push", {
		description: "Commit thoughtfully split changes and push",
		handler: async (_args, ctx) => {
			sendPromptCommand(pi, ctx, "push", PUSH_PROMPT);
		},
	});
}
