/**
 * /handoff extension command
 *
 * Generates a handoff document in the OS temp directory, opens a fresh
 * session, and asks the new agent to read/explain it concisely.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { complete, type Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SYSTEM_PROMPT = `You are writing a handoff document for a fresh coding-agent session.

Summarize the current conversation so another agent can continue the work.

Requirements:
- Save no secrets in the handoff. Redact API keys, passwords, tokens, and personally identifiable information.
- Include a "Suggested skills" section with any skills the next agent should invoke.
- If the user supplied a focus for the next session, tailor the document to that focus.
- Do not duplicate content already captured in other artifacts such as PRDs, plans, ADRs, issues, commits, or diffs. Reference them by path or URL instead.
- Include the goal, key decisions, important context, relevant files/artifacts, current status, blockers/open questions, and concrete next steps.
- Be concise but complete enough for a fresh agent to resume.

Output only the markdown handoff document. Do not include preamble.`;

function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
	if (entry.type === "message") return entry.message;
	if (entry.type === "compaction") {
		return {
			role: "compactionSummary",
			summary: entry.summary,
			tokensBefore: entry.tokensBefore,
			timestamp: new Date(entry.timestamp).getTime(),
		};
	}
	return undefined;
}

function getHandoffMessages(branch: SessionEntry[]): AgentMessage[] {
	let compactionIndex = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		if (branch[i].type === "compaction") {
			compactionIndex = i;
			break;
		}
	}

	if (compactionIndex < 0) {
		return branch.map(entryToMessage).filter((message) => message !== undefined);
	}

	const compaction = branch[compactionIndex];
	const firstKeptIndex =
		compaction.type === "compaction" ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId) : -1;
	const compactedBranch = [
		compaction,
		...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : []),
		...branch.slice(compactionIndex + 1),
	];

	return compactedBranch.map(entryToMessage).filter((message) => message !== undefined);
}

function redactObviousSecrets(markdown: string): string {
	return markdown
		.replace(/\b(sk-[A-Za-z0-9_-]{12,}|pk-[A-Za-z0-9_-]{12,})\b/g, "[REDACTED]")
		.replace(/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, "[REDACTED]")
		.replace(/\b(xox[baprs]-[A-Za-z0-9-]{20,})\b/g, "[REDACTED]")
		.replace(
			/\b(api[_-]?key|token|secret|password|passwd|pwd)\b\s*[:=]\s*["']?([^\s"'`]+)/gi,
			(_match, key) => `${key}: [REDACTED]`,
		);
}

function makeHandoffPath(): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const suffix = Math.random().toString(36).slice(2, 8);
	return join(tmpdir(), "pi-handoffs", `handoff-${stamp}-${suffix}.md`);
}

export function registerHandoff(pi: ExtensionAPI) {
	pi.registerCommand("handoff", {
		description: "Generate a handoff file, open a new session, and ask the agent to explain it",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();

			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const messages = getHandoffMessages(ctx.sessionManager.getBranch());
			if (messages.length === 0) {
				ctx.ui.notify("No conversation to hand off", "error");
				return;
			}

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
			if (!auth.ok || !auth.apiKey) {
				ctx.ui.notify(auth.ok ? `No API key for ${ctx.model.provider}` : auth.error, "error");
				return;
			}

			const focus = args.trim();
			const conversationText = serializeConversation(convertToLlm(messages));
			const currentSessionFile = ctx.sessionManager.getSessionFile();

			ctx.ui.notify("Generating handoff file...", "info");

			const userMessage: Message = {
				role: "user",
				content: [
					{
						type: "text",
						text: [
							focus ? `Next-session focus: ${focus}` : "No specific next-session focus was provided.",
							"",
							"## Conversation History",
							conversationText,
						].join("\n"),
					},
				],
				timestamp: Date.now(),
			};

			let handoff = "";
			try {
				const response = await complete(
					ctx.model,
					{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
					{ apiKey: auth.apiKey, headers: auth.headers, maxTokens: 8192 },
				);

				handoff = response.content
					.filter((content): content is { type: "text"; text: string } => content.type === "text")
					.map((content) => content.text)
					.join("\n")
					.trim();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Handoff generation failed: ${message}`, "error");
				return;
			}

			if (!handoff) {
				ctx.ui.notify("Handoff generation returned empty content", "error");
				return;
			}

			const handoffPath = makeHandoffPath();
			await mkdir(join(tmpdir(), "pi-handoffs"), { recursive: true });
			await writeFile(handoffPath, redactObviousSecrets(handoff) + "\n", "utf8");

			const kickoff = `Read and understand this handoff file: ${handoffPath}\n\nExplain back to me CONCISELY what it is, then wait for my next instruction.`;

			ctx.ui.notify(`Handoff saved: ${handoffPath}`, "info");

			const result = await ctx.newSession({
				parentSession: currentSessionFile,
				withSession: async (replacementCtx) => {
					await replacementCtx.sendUserMessage(kickoff);
				},
			});

			if (result.cancelled) {
				ctx.ui.notify("New session cancelled", "info");
			}
		},
	});
}
