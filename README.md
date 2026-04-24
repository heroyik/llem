<p align="center">
  <img src="assets/icon.png" width="120" alt="LLeM logo" />
</p>

<h1 align="center">LLeM</h1>

<p align="center">
  <strong>Your local code sidekick with zero cloud baggage.</strong><br/>
  Chat with your repo, edit files, run terminal moves, and keep the whole session on-device.
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-2.2.26-blue" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-7ad66d" />
  <img alt="engine" src="https://img.shields.io/badge/engine-Ollama%20%7C%20LM%20Studio-ff9e58" />
</p>

## What It Is
LLeM is a fully local VS Code / Cursor extension for people who want the fast lane without shipping their code to the cloud. It can read your repo, stream model output live, edit files, run commands, and keep a markdown vault on the side for notes, drops, and reference docs.

The whole vibe is simple: less dashboard theater, more getting real work done.

## Why It Hits
- Local-first by default. Ollama and LM Studio both work.
- Live token streaming, so you are not staring at a blank loader.
- Repo-aware chat with direct file edits and terminal actions.
- Markdown vault support for notes, research drops, and reusable context.
- Fresh extension identity: `nIcK.llem`, so it does not collide with old marketplace metadata.

## Install
1. Build or grab the latest VSIX from `release/`.
2. In VS Code or Cursor, run `Extensions: Install from VSIX...`.
3. Pick the latest `llem-x.y.z.vsix`.
4. Open the secondary sidebar and launch `LLeM`.

## Settings
- `llem.engineUrl`: local model endpoint. Point it at Ollama or LM Studio.
- `llem.defaultModel`: the model slug LLeM should use by default.
- `llem.requestTimeout`: how long LLeM waits before timing out.
- `llem.vaultPath`: optional custom path for your markdown vault.

If `llem.vaultPath` is empty, LLeM uses `~/.llem-vault`.

## Vault Flow
LLeM treats your note stash like a vault, not some weird “AI university” storyline. Raw files can be dropped into `drops/`, and LLeM can turn them into cleaner notes under `notes/` when you want it to.

If you hook the vault to GitHub, LLeM can sync it for backup too.

## Commands
- `LLeM: Open Console`
- `LLeM: New Thread`
- `LLeM: Export Thread as Markdown`
- `LLeM: Break Down Selection`
- `LLeM: Focus Prompt`
- `LLeM: Open Vault Map`

## Packaging
- `npm run compile`
- `npm run package:vsix -- --notes "your release notes here"`
- `npm run package:vsix:local -- --notes "local-only package"`

Public packages are written to `release/llem-x.y.z.vsix`.

Local packages still use the local packaging mode when needed, but the main extension identity is already unique enough to avoid the old collision issue.

## Release Notes

### v2.2.26

- Bumped the VSIX build from `2.2.25` to `2.2.26`.
- Rebuilt the extension as LLeM with a full identity rewrite
- replaced the old lore with the new vault flow and English UI copy
- Packaged `release/llem-2.2.26.vsix`.

### v2.2.25

- Rebuilt the extension identity around `LLeM`.
- Swapped the publisher to `nIcK` and the extension ID to `nIcK.llem`.
- Removed the old branding, lore, and marketplace collision path.
- Reframed the note system around a vault with `drops/` and `notes/`.
- Rewrote the webview copy in English with a more casual, modern tone.

