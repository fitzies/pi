# PR Merge Pi Extension

Adds:

- `/pr [commit message]` — stages all files, commits, pushes, creates a PR if needed, then shows live GitHub PR/checks.
- `/merge [number|url|branch] [--squash|--merge|--rebase] [--auto] [--delete-branch] [--admin]` — checks merge readiness, then merges after Enter confirmation.
- `/push` — commits and pushes only this chat/session's changes, recommending/applying logical commit splits so changes are easier to debug later.
- `/abandon [--force]` — deletes this `~/workbranches/*` worktree, deletes its local branch, then closes the current cmux workspace.

Works in normal GitHub worktrees if `gh` is installed/authenticated. Default commit message is `chore: update changes`.

## `/pr` UI

```text
╭─ Pull Request ─────────────────────────────╮
│ Branch  feature/payments → main            │
│ PR      #128 Add payment retries           │
│ URL     github.com/acme/app/pull/128       │
├─ Checks ───────────────────────────────────┤
│ ✓ 1 passed     ◷ 2 pending     ✕ 0 failed  │
│                                            │
│ ✓ CodeRabbit Review        complete        │
│ ◷ Vercel Preview           building        │
│ ◷ CI / test                queued          │
╰────────────────────────────────────────────╯
```

## `/merge` UI

```text
╭─ Merge PR #128 ────────────────────────────╮
│ Status  ready                              │
│ Branch  feature/payments → main            │
│ Method  squash                             │
│ Checks  ✓ 12 passed  ◷ 0 pending  ✕ 0 failed│
├─ Merge ────────────────────────────────────┤
│ Ready to merge.                            │
│ Enter merge • Esc cancel                   │
╰────────────────────────────────────────────╯
```
