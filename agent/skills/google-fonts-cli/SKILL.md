---
name: google-fonts-cli
description: Search, download, and install Google Fonts with gfcli. Use when a user asks to find or install a Google Font, add self-hosted webfont assets to a project, inspect available font variants, or generate local font files.
compatibility: Requires Node.js 20+ and the globally installed google-font-cli package.
---

# Google Fonts CLI

Use the globally installed `gfcli` command for Google Fonts work.

## Choose the right workflow

- **Web project:** download WOFF2 files into the project's font asset directory. Commit only the variants the design uses.
- **Local/system use:** install selected variants into the current user's font directory.
- Always search first when the exact family name or available variants are uncertain.

## Search

```bash
gfcli search "Geist"
```

Add `--refresh-cache` if current Google Fonts metadata is required. Metadata is otherwise cached for 24 hours in `~/.gfcli/cache.json`.

## Download self-hosted webfonts

```bash
gfcli download "Geist,Geist Mono" --woff2 -v regular,500,600,700 -d ./src/assets/fonts
```

After downloading, define local `@font-face` rules or use the project's existing font loader. Avoid remote Google Fonts requests when self-hosting is appropriate.

## Install fonts for the current user

```bash
gfcli install "Geist,Geist Mono" -v regular,500,600,700
```

On Linux, fonts are installed under `~/.local/share/fonts`. If `install` fails after downloads succeed, use this fallback:

```bash
font_tmp="$(mktemp -d)"
trap 'rm -rf "$font_tmp"' EXIT
gfcli download "Geist,Geist Mono" --ttf -v regular,500,600,700 -d "$font_tmp"
mkdir -p ~/.local/share/fonts
cp "$font_tmp"/*.ttf ~/.local/share/fonts/
fc-cache -f ~/.local/share/fonts
```

Verify installation on Linux:

```bash
fc-list | grep -i "Geist"
```

## Safety and hygiene

- Do not install every weight by default; choose the variants the user needs.
- Do not overwrite project font assets without checking existing files and licensing notes.
- Use WOFF2 for web delivery and TTF for local installation.
- Report the family names, variants, destination, and whether font-cache refresh succeeded.
