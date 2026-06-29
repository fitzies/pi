import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dirname, resolve } from "node:path";

async function execText(pi: ExtensionAPI, cwd: string, command: string, args: string[], timeout = 20_000): Promise<string> {
	const result = await pi.exec(command, args, { cwd, timeout });
	if (result.code !== 0) {
		throw new Error((result.stderr || result.stdout || `${command} ${args.join(" ")} exited ${result.code}`).trim());
	}
	return result.stdout.trim();
}

async function execOk(pi: ExtensionAPI, cwd: string, command: string, args: string[], timeout = 20_000): Promise<boolean> {
	const result = await pi.exec(command, args, { cwd, timeout });
	return result.code === 0;
}

function isUnderWorkbranches(worktree: string): boolean {
	const root = resolve(process.env.HOME ?? "", "workbranches") + "/";
	const normalized = resolve(worktree) + "/";
	return normalized.startsWith(root);
}

async function resolveBaseBranch(pi: ExtensionAPI, baseRepo: string): Promise<string> {
	if (await execOk(pi, baseRepo, "git", ["show-ref", "--verify", "--quiet", "refs/heads/main"])) return "main";
	if (await execOk(pi, baseRepo, "git", ["show-ref", "--verify", "--quiet", "refs/heads/master"])) return "master";
	throw new Error("Could not find local base branch main or master.");
}

export function registerAbandonCommand(pi: ExtensionAPI): void {
	pi.registerCommand("abandon", {
		description: "Delete this worktree, its branch, and close the cmux workspace",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();

			try {
			const force = args.split(/\s+/).includes("--force");
			const inside = await execText(pi, ctx.cwd, "git", ["rev-parse", "--is-inside-work-tree"]);
			if (inside !== "true") throw new Error("Not inside a git worktree.");

			const worktree = await execText(pi, ctx.cwd, "git", ["rev-parse", "--show-toplevel"]);
			if (!isUnderWorkbranches(worktree)) {
				ctx.ui.notify(`Refusing to abandon outside ~/workbranches: ${worktree}`, "error");
				return;
			}

			const branch = await execText(pi, ctx.cwd, "git", ["branch", "--show-current"]);
			if (!branch) throw new Error("Refusing to abandon a detached HEAD worktree.");

			const commonDir = await execText(pi, ctx.cwd, "git", ["rev-parse", "--git-common-dir"]);
			const baseRepo = resolve(worktree, dirname(commonDir));
			const baseBranch = await resolveBaseBranch(pi, baseRepo);
			const status = await execText(pi, ctx.cwd, "git", ["status", "--short"]);
			const dirty = status.length > 0;
			const unmergedCount = Number(await execText(pi, baseRepo, "git", ["rev-list", "--count", `${baseBranch}..${branch}`]));

			if (!force && (dirty || unmergedCount > 0)) {
				const parts = [
					"Refusing to abandon workbranch.",
					`Worktree: ${worktree}`,
					`Branch: ${branch}`,
					`Base: ${baseBranch}`,
				];

				if (dirty) {
					parts.push("", "Uncommitted changes:", ...status.split("\n").map((line) => `  ${line}`));
				}

				if (unmergedCount > 0) {
					let commits = "";
					try {
						commits = await execText(pi, baseRepo, "git", ["log", "--oneline", "--max-count=10", `${baseBranch}..${branch}`]);
					} catch {}
					parts.push("", `Unmerged commits: ${unmergedCount} commit(s) not merged into ${baseBranch}`);
					if (commits) parts.push(...commits.split("\n").map((line) => `  ${line}`));
					if (unmergedCount > 10) parts.push(`  ...and ${unmergedCount - 10} more`);
				}

				parts.push("", "Re-run /abandon --force to delete anyway.");
				ctx.ui.notify(parts.join("\n"), "error");
				return;
			}

			const ok = force
				? true
				: await ctx.ui.confirm(
						"Abandon worktree?",
						`Delete worktree and local branch?\n\nWorktree: ${worktree}\nBranch: ${branch}\n\nRemote branch is untouched.`,
					);
			if (!ok) return;

			ctx.ui.notify(`Deleting ${worktree} and branch ${branch}...`, "warning");
			await execText(pi, baseRepo, "git", ["worktree", "remove", "--force", worktree], 120_000);
			await execText(pi, baseRepo, "git", ["branch", "-D", branch], 120_000);

			const workspaceId = process.env.CMUX_WORKSPACE_ID;
			if (workspaceId) {
				await pi.exec("cmux", ["close-workspace", "--workspace", workspaceId], { cwd: baseRepo, timeout: 5_000 });
			} else {
				ctx.ui.notify(`Deleted ${branch}. CMUX_WORKSPACE_ID not set, so workspace was not closed.`, "info");
			}
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
