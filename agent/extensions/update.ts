import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_REPO = join(homedir(), ".pi");
const EXPECTED_GITHUB_REPO = "fitzies/pi";

function githubRepoFromRemote(remote: string): string | undefined {
  const match = remote
    .trim()
    .match(/^(?:git@|ssh:\/\/git@|https?:\/\/)?github\.com(?::|\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
  return match?.[1]?.toLowerCase();
}

export default function updateExtension(pi: ExtensionAPI) {
  pi.registerCommand("update", {
    description: "Discard tracked ~/.pi changes, reset to fitzies/pi main, and reload Pi",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      try {
        const expectedRoot = await realpath(CONFIG_REPO);
        const rootResult = await pi.exec("git", ["-C", CONFIG_REPO, "rev-parse", "--show-toplevel"]);
        if (rootResult.code !== 0) {
          throw new Error(rootResult.stderr.trim() || `${CONFIG_REPO} is not a Git repository`);
        }

        const actualRoot = await realpath(rootResult.stdout.trim());
        if (actualRoot !== expectedRoot) {
          throw new Error(`Refusing to update: ${CONFIG_REPO} belongs to Git repository ${actualRoot}`);
        }

        const remoteResult = await pi.exec("git", ["-C", CONFIG_REPO, "remote", "get-url", "origin"]);
        if (remoteResult.code !== 0) {
          throw new Error(remoteResult.stderr.trim() || "The ~/.pi repository has no origin remote");
        }
        if (githubRepoFromRemote(remoteResult.stdout) !== EXPECTED_GITHUB_REPO) {
          throw new Error(`Refusing to update from unexpected origin: ${remoteResult.stdout.trim()}`);
        }

        const skipConfirmation = ["--yes", "-y"].includes(args.trim().toLowerCase());
        if (!skipConfirmation) {
          if (!ctx.hasUI) throw new Error("Confirmation requires interactive mode; use /update --yes to proceed");
          const confirmed = await ctx.ui.confirm(
            "Update ~/.pi?",
            "This will permanently discard tracked local changes and reset ~/.pi to fitzies/pi main. Untracked files will remain.",
          );
          if (!confirmed) {
            ctx.ui.notify("Update cancelled.", "info");
            return;
          }
        }

        ctx.ui.notify("Fetching fitzies/pi main…", "info");
        const fetchResult = await pi.exec("git", ["-C", CONFIG_REPO, "fetch", "origin", "main"]);
        if (fetchResult.code !== 0) {
          throw new Error(fetchResult.stderr.trim() || "git fetch origin main failed");
        }

        const resetResult = await pi.exec("git", ["-C", CONFIG_REPO, "reset", "--hard", "FETCH_HEAD"]);
        if (resetResult.code !== 0) {
          throw new Error(resetResult.stderr.trim() || "git reset --hard FETCH_HEAD failed");
        }

        ctx.ui.notify(`${resetResult.stdout.trim() || "Updated ~/.pi from fitzies/pi main"}. Reloading Pi…`, "info");
        try {
          await ctx.reload();
        } catch (error) {
          ctx.ui.notify(
            `Update succeeded, but reload failed: ${error instanceof Error ? error.message : String(error)}. Run /reload.`,
            "error",
          );
        }
        return;
      } catch (error) {
        ctx.ui.notify(`Update failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
