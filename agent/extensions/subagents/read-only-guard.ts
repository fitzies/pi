import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MUTATING_BASH_PATTERNS: RegExp[] = [
  /(^|[;&|()\s])(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln|truncate|dd)\b/,
  /(^|[;&|()\s])git\s+(add|commit|reset|checkout|switch|merge|rebase|clean|stash|restore|apply|am|cherry-pick)\b/,
  /(^|[;&|()\s])(npm|pnpm|yarn|bun)\s+(install|add|remove|update|upgrade|audit\s+fix)\b/,
  /(^|[;&|()\s])(brew|apt|apt-get|pip|pip3|cargo|gem|go)\s+(install|remove|update|upgrade|get)\b/,
  /(^|[;&|()\s])sed\s+[^;&|]*\s-i\b/,
  /(^|[;&|()\s])perl\s+[^;&|]*\s-pi\b/,
  /(^|[;&|()\s])tee\b/,
  />\s*[^&\s]/,
  /(^|\s)<<-?\s*\w+/,
];

function isDangerous(command: string): boolean {
  const normalized = command.replace(/\\\r?\n/g, " ").trim();
  return MUTATING_BASH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      return { block: true, reason: "Reviewer subagent is read-only." };
    }

    if (event.toolName === "bash") {
      const command = String((event as any).input?.command ?? "");
      if (isDangerous(command)) {
        return { block: true, reason: "Reviewer subagent may only run read-only/safe validation commands." };
      }
    }
  });
}
