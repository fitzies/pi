import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { bgstProgressText, formatBgstResult } from "./render";
import { isBgstAvailable, preflightYeet, runBgst, type BgstAction, type YeetPreflight } from "./runner";

const TOOL_ACTIONS = ["status", "pull", "yeet"] as const;

type InteractiveContext = ExtensionCommandContext | ExtensionContext;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function confirmYeet(ctx: InteractiveContext, preflight: YeetPreflight): Promise<boolean> {
	if (!ctx.hasUI) {
		throw new Error("bgst yeet requires interactive confirmation.");
	}

	const shown = preflight.changes.slice(0, 8).map((change) => `  ${change}`);
	if (preflight.changes.length > shown.length) shown.push(`  …and ${preflight.changes.length - shown.length} more`);
	return ctx.ui.confirm(
		`Push every change to ${preflight.target}?`,
		[
			`Repository: ${preflight.root}`,
			`Target: HEAD → ${preflight.target}`,
			`Changes (${preflight.changes.length}):`,
			...shown,
			"",
			"This stages and commits every listed change, then pushes directly to the remote default branch.",
		].join("\n"),
	);
}

async function getCommitMessage(args: string, ctx: ExtensionCommandContext): Promise<string | undefined> {
	const supplied = args.trim();
	if (supplied) return supplied;
	if (!ctx.hasUI) throw new Error("A commit message is required: /yeet <message>");
	return (await ctx.ui.input("Commit message:", "Describe every local change"))?.trim() || undefined;
}

async function runCommand(
	pi: ExtensionAPI,
	action: BgstAction,
	ctx: ExtensionCommandContext,
	message?: string,
): Promise<void> {
	await ctx.waitForIdle();
	ctx.ui.setStatus("bgst", bgstProgressText(action));
	try {
		const result = await runBgst(pi, action, ctx.cwd, { message });
		ctx.ui.notify(formatBgstResult(result), "info");
	} catch (error) {
		ctx.ui.notify(`bgst ${action} failed: ${errorMessage(error)}`, "error");
	} finally {
		ctx.ui.setStatus("bgst", undefined);
	}
}

export default function bgstExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (!(await isBgstAvailable(pi, ctx.cwd)) && ctx.hasUI) {
			ctx.ui.notify("bgst is unavailable. Install it or ensure it is on PATH.", "warning");
		}
	});

	pi.registerCommand("bgst", {
		description: "Show repository and pull request status with bgst",
		handler: async (_args, ctx) => runCommand(pi, "status", ctx),
	});

	pi.registerCommand("pull", {
		description: "Fetch every remote with bgst without moving the worktree",
		handler: async (_args, ctx) => runCommand(pi, "pull", ctx),
	});

	pi.registerCommand("yeet", {
		description: "Confirm, commit every local change, and push to the remote default branch",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			try {
				const message = await getCommitMessage(args, ctx);
				if (!message) {
					ctx.ui.notify("Yeet cancelled: no commit message provided.", "info");
					return;
				}
				const preflight = await preflightYeet(pi, ctx.cwd);
				if (!(await confirmYeet(ctx, preflight))) {
					ctx.ui.notify("Yeet cancelled; nothing was committed or pushed.", "info");
					return;
				}
				await runCommand(pi, "yeet", ctx, message);
			} catch (error) {
				ctx.ui.notify(`bgst yeet failed: ${errorMessage(error)}`, "error");
			}
		},
	});

	pi.registerCommand("bgst-update", {
		description: "Install the latest bgst release",
		handler: async (_args, ctx) => runCommand(pi, "update", ctx),
	});

	pi.registerTool({
		name: "bgst",
		label: "Better Git Status",
		description:
			"Inspect a Git repository, fetch every remote without moving the worktree, or commit every local change and push HEAD to the remote default branch. Output is truncated to 50KB or 2000 lines.",
		promptSnippet: "Inspect repository/PR status, safely fetch remotes, or explicitly yeet every local change.",
		promptGuidelines: [
			"Use bgst with action=status when the user asks for a repository-wide Git and pull request overview.",
			"Use bgst with action=pull only when the user asks to fetch remotes without merging, rebasing, or moving the worktree.",
			"Use bgst with action=yeet only when the user explicitly asks to commit every local change and push HEAD directly to the remote default branch; bgst will require user confirmation.",
		],
		executionMode: "sequential",
		parameters: Type.Object({
			action: StringEnum(TOOL_ACTIONS),
			message: Type.Optional(Type.String({ description: "Required commit message when action is yeet." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const action = params.action as (typeof TOOL_ACTIONS)[number];
			const message = params.message?.trim();
			if (action === "yeet") {
				if (!message) throw new Error("bgst yeet requires a commit message.");
				const preflight = await preflightYeet(pi, ctx.cwd, signal);
				if (!(await confirmYeet(ctx, preflight))) {
					return {
						content: [{ type: "text", text: "Yeet cancelled by the user; nothing was committed or pushed." }],
						details: { action, cancelled: true },
					};
				}
			}

			onUpdate?.({ content: [{ type: "text", text: bgstProgressText(action) }] });
			const result = await runBgst(pi, action, ctx.cwd, { message, signal });
			return {
				content: [{ type: "text", text: formatBgstResult(result) }],
				details: result,
			};
		},
	});
}
