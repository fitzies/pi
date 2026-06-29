---
name: github-investigation
description: Use automatically whenever the user provides a GitHub URL, GitHub owner/repo reference, issue/PR/release/commit link, or asks to inspect, explain, summarize, compare, or investigate a GitHub repository. Prefer the GitHub CLI (`gh`) over web scraping/Firecrawl for GitHub-hosted content.
---

# GitHub Investigation

Use this skill whenever the task involves GitHub-hosted content, including repositories, files, directories, issues, pull requests, discussions, releases, commits, actions, branches, tags, or comparisons.

## Default Rule

Prefer the GitHub CLI (`gh`) for GitHub URLs and `owner/repo` references.

Use Firecrawl/search/scrape only when:

- the URL is not GitHub-hosted,
- the user specifically asks for rendered web-page behavior,
- GitHub CLI cannot access the resource,
- the needed information is on an external docs/site page linked from GitHub,
- or web search is needed to discover unknown repositories or current broader context.

## Safety and Mutability

Prefer read-only `gh` commands by default.

Read-only examples:

```bash
gh repo view OWNER/REPO
gh repo view OWNER/REPO --json name,description,defaultBranchRef,repositoryTopics,licenseInfo,stargazerCount,forkCount,isArchived,homepageUrl
gh api repos/OWNER/REPO/readme
gh api repos/OWNER/REPO/contents/PATH
gh api repos/OWNER/REPO/git/trees/BRANCH_OR_SHA?recursive=1
gh issue list -R OWNER/REPO
gh issue view ISSUE -R OWNER/REPO
gh pr list -R OWNER/REPO
gh pr view PR -R OWNER/REPO
gh release list -R OWNER/REPO
gh release view TAG -R OWNER/REPO
gh api repos/OWNER/REPO/commits/SHA
gh api repos/OWNER/REPO/compare/BASE...HEAD
```

Do not run mutating `gh` commands unless the user explicitly asks and confirms the operation. Mutating examples include creating/editing issues, PRs, comments, releases, branches, labels, workflows, or pushing/cloning into a workspace.

Cloning a repository writes files locally, so ask first unless the user explicitly requested cloning/checking out code.

## URL Handling

When given a GitHub URL, parse it into owner, repository, and resource type:

- `https://github.com/OWNER/REPO` → repository overview
- `/tree/REF/PATH` → directory at ref
- `/blob/REF/PATH` → file at ref
- `/issues/N` → issue
- `/pull/N` → pull request
- `/releases` or `/releases/tag/TAG` → releases
- `/commit/SHA` → commit
- `/compare/BASE...HEAD` → comparison

For GitHub blob/tree links, prefer `gh api` contents/tree endpoints or raw content via GitHub APIs rather than Firecrawl.

## Repository Explanation Workflow

For “explain this repo” or similar:

1. Inspect repo metadata with `gh repo view`.
2. Read README via `gh api repos/OWNER/REPO/readme` or contents API.
3. Inspect top-level file tree using `gh api repos/OWNER/REPO/git/trees/DEFAULT_BRANCH?recursive=1`.
4. Identify package/framework files (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `Gemfile`, Dockerfiles, CI configs, docs).
5. Read the most relevant small files with contents API.
6. Summarize purpose, architecture, entry points, setup, notable dependencies, and caveats.

Keep responses concise unless the user asks for depth.

## Useful Patterns

Decode a file returned by contents API:

```bash
gh api repos/OWNER/REPO/contents/PATH --jq '.content' | base64 --decode
```

List a recursive tree compactly:

```bash
gh api 'repos/OWNER/REPO/git/trees/BRANCH?recursive=1' --jq '.tree[].path'
```

Get PR changed files:

```bash
gh pr view PR -R OWNER/REPO --json files,additions,deletions,title,body,author,state,url
```

Get issue or PR comments when needed:

```bash
gh api repos/OWNER/REPO/issues/NUMBER/comments
```

## Authentication

If `gh` is unavailable or unauthenticated, say so briefly and fall back to non-mutating alternatives such as Firecrawl/search/scrape, unless the user wants help setting up `gh auth login`.
