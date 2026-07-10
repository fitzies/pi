import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

export type BgstAction = "status" | "pull" | "yeet" | "update" | "version";

export type BgstResult = {
	action: BgstAction;
	output: string;
};

export type YeetPreflight = {
	root: string;
	remote: string;
	defaultBranch: string;
	target: string;
	changes: string[];
};

function argsFor(action: BgstAction, message?: string): string[] {
	switch (action) {
		case "status":
			return ["status"];
		case "pull":
			return ["pull"];
		case "yeet":
			return ["yeet", message!, "--yes"];
		case "update":
			return ["update"];
		case "version":
			return ["version"];
	}
}

function timeoutFor(action: BgstAction): number {
	if (action === "status" || action === "version") return 30_000;
	if (action === "yeet") return 10 * 60_000;
	return 2 * 60_000;
}

async function git(pi: ExtensionAPI, cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
	const result = await pi.exec("git", args, { cwd, signal, timeout: 30_000 });
	if (result.killed) throw new Error(`git ${args[0]} was cancelled or timed out`);
	if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args[0]} failed`);
	return result.stdout.trim();
}

async function defaultBranch(
	pi: ExtensionAPI,
	root: string,
	remote: string,
	signal?: AbortSignal,
): Promise<string> {
	const symbolic = await pi.exec(
		"git",
		["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`],
		{ cwd: root, signal, timeout: 30_000 },
	);
	if (!symbolic.killed && symbolic.code === 0) {
		const prefix = `${remote}/`;
		const ref = symbolic.stdout.trim();
		if (ref.startsWith(prefix) && ref.length > prefix.length) return ref.slice(prefix.length);
	}

	for (const branch of ["main", "master"]) {
		const result = await pi.exec(
			"git",
			["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`],
			{ cwd: root, signal, timeout: 30_000 },
		);
		if (!result.killed && result.code === 0) return branch;
	}
	return "main";
}

export async function preflightYeet(
	pi: ExtensionAPI,
	cwd: string,
	signal?: AbortSignal,
): Promise<YeetPreflight> {
	const root = await git(pi, cwd, ["rev-parse", "--show-toplevel"], signal).catch(() => {
		throw new Error("Not inside a Git repository.");
	});
	const changes = (await git(pi, root, ["status", "--short", "--untracked-files=all"], signal))
		.split("\n")
		.filter(Boolean);
	if (changes.length === 0) throw new Error("Nothing to commit; the worktree is clean.");

	const remotes = (await git(pi, root, ["remote"], signal)).split(/\s+/).filter(Boolean);
	if (remotes.length === 0) throw new Error("Cannot yeet without a Git remote.");
	const remote = remotes.includes("origin") ? "origin" : remotes.includes("upstream") ? "upstream" : remotes[0]!;
	const branch = await defaultBranch(pi, root, remote, signal);
	return { root, remote, defaultBranch: branch, target: `${remote}/${branch}`, changes };
}

function formatOutput(stdout: string, stderr: string): string {
	const raw = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim() || "bgst completed without output.";
	const truncated = truncateHead(raw, {
		maxBytes: DEFAULT_MAX_BYTES,
		maxLines: DEFAULT_MAX_LINES,
	});

	if (!truncated.truncated) return truncated.content;
	return `${truncated.content}\n\n[bgst output truncated: ${truncated.outputLines} of ${truncated.totalLines} lines (${formatSize(
		truncated.outputBytes,
	)} of ${formatSize(truncated.totalBytes)}).]`;
}

export async function runBgst(
	pi: ExtensionAPI,
	action: BgstAction,
	cwd: string,
	options: { message?: string; signal?: AbortSignal } = {},
): Promise<BgstResult> {
	const message = options.message?.trim();
	if (action === "yeet" && !message) throw new Error("A commit message is required.");

	const result = await pi.exec("bgst", argsFor(action, message), {
		cwd,
		signal: options.signal,
		timeout: timeoutFor(action),
	});
	const output = formatOutput(result.stdout, result.stderr);

	if (result.killed || result.code !== 0) {
		const failure = result.killed
			? `bgst ${action} was cancelled or timed out.\n${output}`
			: output || `bgst ${action} exited with code ${result.code}`;
		if (action === "yeet") {
			throw new Error(
				`bgst yeet may have already staged, committed, or pushed changes. Inspect repository status before retrying.\n${failure}`,
			);
		}
		throw new Error(failure);
	}

	return { action, output };
}

export async function isBgstAvailable(pi: ExtensionAPI, cwd: string): Promise<boolean> {
	try {
		await runBgst(pi, "version", cwd);
		return true;
	} catch {
		return false;
	}
}
