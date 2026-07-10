# bgst Pi extension

Pi adapter for the installed `bgst` CLI.

Commands:

- `/bgst` — show repository and pull request status.
- `/pull` — fetch every remote without checking out, merging, rebasing, or moving the worktree.
- `/yeet [message]` — after explicit confirmation, stage and commit every local change and push `HEAD` directly to the configured remote's default branch.
- `/bgst-update` — install the latest `bgst` release.

The `bgst` model tool exposes `status`, `pull`, and `yeet`. The `yeet` action requires a commit message and interactive user confirmation. The existing `/push` command remains the safer session-scoped workflow, while `/update` continues to update the Pi configuration repository.
