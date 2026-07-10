import type { BgstAction, BgstResult } from "./runner";

const LABELS: Record<BgstAction, string> = {
	status: "Repository status",
	pull: "Fetched all remotes",
	yeet: "Committed and pushed",
	update: "bgst update",
	version: "bgst version",
};

export function formatBgstResult(result: BgstResult): string {
	return `${LABELS[result.action]}\n\n${result.output}`;
}

export function bgstProgressText(action: BgstAction): string {
	switch (action) {
		case "status":
			return "Inspecting repository and pull requests…";
		case "pull":
			return "Fetching every remote without moving the worktree…";
		case "yeet":
			return "Committing every local change and pushing to the remote default branch…";
		case "update":
			return "Updating bgst…";
		case "version":
			return "Checking bgst version…";
	}
}
