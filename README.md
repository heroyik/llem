# LLeM

**A local-first coding sidekick for VS Code and Cursor.**

Stream model output live, chat with your repo, edit files, run terminal commands, and keep your notes in a markdown vault without shipping your code to the cloud.

**VSIX version:** 2.2.53 · **License:** MIT · **Engine:** Ollama | LM Studio

## Overview

LLeM is a fully local extension built for people who want an AI coding workflow that feels fast, direct, and under their control. It is designed around a simple idea:

- keep inference local
- keep repo context close
- keep output visible while it is being generated
- keep file actions real instead of fake “here is some code, you paste it” behavior

LLeM talks to a local model server such as Ollama or LM Studio, renders replies inside a custom chat panel, can trigger file and terminal actions from model output, and optionally uses a markdown vault as a long-lived note layer for project context.

This repo now treats LLeM as a distinct extension identity. The old branding and the old marketplace collision path were removed so the extension can stand on its own.

## Core Features

### 1. Local-first model workflow

LLeM does not depend on a hosted inference backend. It points at a local engine
URL and sends requests to Ollama or LM Studio running on your machine.

Why that matters:

- your code stays local
- latency stays low
- you can choose your own model
- you can tune the setup however you want

### 2. Live streaming output

Instead of hiding behind a boring waiting spinner, LLeM shows the raw output
stream as tokens arrive. You see the reply forming in real time, and when the
stream finishes the message is rendered cleanly as markdown.

### 3. Repo-aware chat

LLeM builds request context from your open workspace. That includes:

- the current file when it is small enough to include
- a project tree summary
- a handful of important top-level files
- optional vault context if you have a vault connected

That gives the model a much better shot at answering repo-specific questions
without you needing to explain the whole project every time.

### 4. Real file and terminal actions

LLeM is not just a text box. It can interpret action tags in the model response
and then:

- create files
- edit files
- delete files
- read files
- list directories
- run terminal commands
- read from the vault
- fetch web pages when web mode is enabled

That makes it feel much closer to a real coding assistant than a plain chatbot.

### 5. Markdown vault support

LLeM can maintain a markdown vault alongside your coding workflow. The vault is
useful for:

- project notes
- architecture thoughts
- research scraps
- imported files
- reusable reference docs

The vault flow is intentionally simple:

- raw material lands in `drops/`
- refined notes can be created in `notes/`
- the whole vault can optionally sync to GitHub

### 6. Dedicated extension identity

The extension now ships as:

- display name: `LLeM`
- extension name: `llem`
- publisher: `nIcK`
- extension ID: `nIcK.llem`

That is important because it prevents the old icon and metadata collision
behavior that came from reusing a previous extension identity.

## Who It Is For

LLeM is a good fit if you want:

- a local AI coding workflow
- a side panel chat that can actually do things
- a repo assistant that does not rely on cloud prompts
- a markdown-based notes layer for projects
- a custom VSIX you can install directly

It is especially handy for people working in:

- TypeScript or JavaScript projects
- tool-heavy local dev environments
- privacy-sensitive codebases
- personal knowledge workflows built around markdown

## Quick Start

### Option 1: Install from a built VSIX

1. Build or obtain the latest VSIX in `release/`.
2. In VS Code or Cursor, open the command palette.
3. Run `Extensions: Install from VSIX...`.
4. Choose the latest `llem-x.y.z.vsix`.
5. Open the secondary sidebar and launch `LLeM`.

### Option 2: Run from source during development

1. Clone this repo.
2. Install dependencies:

```bash
npm install
```

1. Compile the extension:

```bash
npm run compile
```

1. Open the project in VS Code.
2. Press `F5` to launch an Extension Development Host.
3. Open the LLeM panel in the new host window.

## Requirements

To get real responses, you need one local model runtime running:

- Ollama
- LM Studio

LLeM can auto-detect common local endpoints, but you can also set them manually.

## Engine Setup

### Ollama

Typical local URL:

```text
http://127.0.0.1:11434
```

Common flow:

```bash
ollama pull gemma4:e2b
ollama list
ollama serve
```

If Ollama is running and the chosen model exists, LLeM can talk to it directly.

### LM Studio

Typical local URL:

```text
http://127.0.0.1:1234
```

In LM Studio:

1. download or select a model
2. load the model
3. enable the local server
4. confirm the server is available

Once the LM Studio server is up, LLeM can target it using the same chat flow.

## Configuration

To change settings such as `llem.engineUrl` or `llem.defaultModel`, you should open
your VS Code settings in JSON format.

- **macOS**: Press `CMD+SHIFT+P`, then select
  **Preferences: Open User Settings (JSON)**.
- **Windows**: Press `CTRL+SHIFT+P`, then select
  **Preferences: Open User Settings (JSON)**.

LLeM exposes a small set of settings under the `llem` namespace.

### `llem.engineUrl`

The local or remote model endpoint URL.

Default:

```text
http://127.0.0.1:11434
```

Use this to switch between Ollama and LM Studio. If you are connecting to a
**remote Ollama server**, specify the IP address or hostname:

```text
http://192.168.1.100:11434
```

### `llem.defaultModel`

The default model slug used for requests.

Default:

```text
gemma4:e2b
```

Use a model name that exists in your local engine.

### `llem.requestTimeout`

The request timeout in seconds.

Default:

```text
300
```

If long prompts or slower models are timing out, raise this number.

### `llem.vaultPath`

Optional custom path to the markdown vault.

If this value is empty, LLeM uses:

```text
~/.llem-vault
```

### `llem.bridgeEnabled`

Whether LLeM should start the optional local HTTP bridge on `127.0.0.1:4825`.

Default:

```text
false
```

Keep this off unless you intentionally connect another local tool to LLeM.

### `llem.bridgeToken`

Optional token for the local HTTP bridge.

Default:

```text
empty
```

When set, bridge callers must send either:

```text
Authorization: Bearer <token>
X-LLeM-Token: <token>
```

Bridge requests are also origin-checked, rate-limited, and validated for payload type and size before they reach the local model or vault writer.

## Commands

LLeM currently contributes these commands:

- `LLeM: Open Console`
- `LLeM: New Thread`
- `LLeM: Export Thread as Markdown`
- `LLeM: Break Down Selection`
- `LLeM: Focus Prompt`
- `LLeM: Open Vault Map`

### Command Notes

#### Open Console

Opens the LLeM chat surface in the secondary sidebar. If the view is
unavailable, LLeM can fall back to an editor panel.

#### New Thread

Resets the current chat history and starts a fresh session.

#### Export Thread as Markdown

Exports the current visible conversation into a markdown file inside the open workspace.

#### Break Down Selection

Sends the active editor selection into the chat with a “break this down for me”
prompt.

#### Focus Prompt

Brings focus to the prompt input. The repo currently binds this to `Cmd+L` on macOS.

#### Open Vault Map

Shows a graph-based visualization of vault notes and their folder clusters.

## UI Flow

The webview UI is designed to make a local model feel alive instead of sluggish.

### Header controls

The top bar includes:

- model selector
- web toggle
- vault tools button
- settings button
- new thread button

### Live output panel

When generation starts:

- a streaming panel appears
- elapsed time updates live
- chunks accumulate in place
- the final result is rendered as markdown when generation completes

### File attachments

You can attach:

- images
- text files
- markdown
- code files
- data files such as JSON or CSV

You can add them with the `+` button or by dragging files straight into the
chat surface.

Images can be passed directly to model requests when supported. Large text files
are truncated to keep prompts manageable.

### Stop generation

If you stop a response:

- the request is aborted
- the partial stream stays visible
- LLeM avoids turning the abort into a noisy error

## Vault System

### Default layout

When the vault is first used, LLeM can build around:

```text
~/.llem-vault/
├─ drops/
└─ notes/
```

### `drops/`

This is where newly injected raw files land. Think of it as an inbox.

Typical use cases:

- imported articles
- rough meeting notes
- raw markdown dumps
- file attachments you want to preserve

### `notes/`

This is where LLeM can create cleaner, structured notes after you confirm that
you want raw material turned into something more polished.

### Vault menu

The vault menu supports:

- browsing vault notes
- syncing the vault with GitHub
- changing the vault folder
- opening the vault map

### GitHub sync

If you add a GitHub repo URL for the vault:

- LLeM can initialize git in the vault directory
- attach the remote
- commit local changes
- pull remote changes
- push updates back up

That gives you a straightforward backup path for your markdown notes.

## Context Building

LLeM builds prompts from multiple layers.

### Workspace context

LLeM can include:

- a compact project tree
- important key files
- the active editor file when it is small enough

### Vault context

If vault mode is on and notes are available:

- LLeM includes a vault index
- the model can request specific notes via the vault read tag
- answers can be grounded in your stored notes

### Internet context

When live web mode is enabled:

- LLeM allows URL fetch actions
- the model can pull web content into the response loop
- this is useful for fresh or real-time information

## Error Handling

LLeM includes a few practical guardrails.

### If the model server is not reachable

It reports that the local engine could not be reached and points you back toward
checking Ollama or LM Studio.

### If the model is missing

It reports that the requested model is not available in the current engine.

### If the context is too large

It suggests starting a new thread, reducing the prompt size, or turning
vault-heavy context off temporarily.

### If the request times out

It suggests:

- increasing request timeout
- using a smaller model
- reducing prompt size

## Packaging and Release Workflow

LLeM includes a custom VSIX packaging script.

### Compile only

```bash
npm run compile
```

### Build a public VSIX

```bash
npm run package:vsix -- --notes "your release notes here"
```

### Build a local-only VSIX

```bash
npm run package:vsix:local -- --notes "local-only package"
```

### Output location

Public packages are written to:

```text
release/llem-x.y.z.vsix
```

### What the packaging script does

The packaging script:

- bumps the patch version
- updates `package.json`
- updates `package-lock.json`
- appends release notes to `README.md`
- compiles the extension
- packages the VSIX into `release/`

## Development Notes

### Tech stack

The extension currently uses:

- TypeScript
- esbuild
- VS Code extension APIs
- axios
- markdown-it

### Main areas of the codebase

- `src/webviewHtml.ts`: the chat UI and front-end behavior
- `src/chatPipeline.ts`: request orchestration and streaming
- `src/actionExecutor.ts`: file, directory, command, and web actions
- `src/contextBuilder.ts`: workspace and vault context assembly
- `src/brainCommands.ts`: vault commands and GitHub sync flow
- `src/bridgeServer.ts`: local bridge server endpoints
- `src/prompts.ts`: the system prompt used for the assistant

## Identity and Collision Avoidance

One of the goals of the rewrite was to stop the extension from inheriting stale
marketplace metadata from the old identity.

The fix is not just visual. LLeM now has:

- a different name
- a different publisher
- a different extension ID
- rewritten docs
- rewritten UI copy
- rewritten vault flow language

That means the extension is no longer pretending to be a variation of the
previous product. It is its own extension now.

## Repository

Repository URL:

```text
https://github.com/heroyik/llem
```

## License

MIT

## Release Notes

### v2.2.53

- Bumped the VSIX build from `2.2.52` to `2.2.53`.
- Fix openAttachment to support paths like src/file.ts
- Packaged `release/llem-2.2.53.vsix`.

### v2.2.52

- Bumped the VSIX build from `2.2.51` to `2.2.52`.
- Enable clicking on inline code blocks to open referenced files
- Packaged `release/llem-2.2.52.vsix`.

### v2.2.50

- Bumped the VSIX build from `2.2.49` to `2.2.50`.
- Fixed openAttachment logic in sidebarChatProvider for better URI parsing and binary file support
- Packaged `release/llem-2.2.50.vsix`.

### v2.2.49

- Bumped the VSIX build from `2.2.48` to `2.2.49`.
- Rebuild VSIX as requested
- Packaged `release/llem-2.2.49.vsix`.

### v2.2.48

- Bumped the VSIX build from `2.2.47` to `2.2.48`.
- actionExecutor structure separated via Command pattern and Performance telemetry system implemented
- Packaged `release/llem-2.2.48.vsix`.

### v2.2.47

- Bumped the VSIX build from `2.2.46` to `2.2.47`.
- Guard README version metadata before packaging so VS Code extension details cannot ship the stale badge
- Packaged `release/llem-2.2.47.vsix`.

### v2.2.46

- Bumped the VSIX build from `2.2.45` to `2.2.46`.
- Show the packaged VSIX version as README text from package.json
- remove README image badges and logo markup that break in VS Code extension details
- Packaged `release/llem-2.2.46.vsix`.

### v2.2.45

- Bumped the VSIX build from `2.2.44` to `2.2.45`.
- Remove the README logo block that VS Code renders as a broken image in extension details
- Packaged `release/llem-2.2.45.vsix`.

### v2.2.44

- Bumped the VSIX build from `2.2.43` to `2.2.44`.
- Fix README logo rendering in extension details
- Align README version badge with the packaged extension
- Update extension categories to LLM and AI
- Packaged `release/llem-2.2.44.vsix`.

### v2.2.43

- Bumped the VSIX build from `2.2.42` to `2.2.43`.
- Require Shift for Antigravity drag-and-drop attachment handling
- Remove forced drag-and-drop capture and verbose debug overhead
- Packaged `release/llem-2.2.43.vsix`.

### v2.2.42

- Bumped the VSIX build from `2.2.41` to `2.2.42`.
- Capture drag-and-drop events without requiring Shift before VS Code opens the file
- Show the current LLeM version in the header and welcome screen
- Packaged `release/llem-2.2.42.vsix`.

### v2.2.41

- Bumped the VSIX build from `2.2.40` to `2.2.41`.
- Force drag-and-drop attachments to use copy semantics even when VS Code reports a move drag.
- Packaged `release/llem-2.2.41.vsix`.

### v2.2.40

- Bumped the VSIX build from `2.2.39` to `2.2.40`.
- Fixed drag-and-drop attachment visibility and duplicate attachment chips
- Added detailed drag-and-drop debug logging mirrored to the Extension Host Debug Console
- Packaged `release/llem-2.2.40.vsix`.

### v2.2.39

- Bumped the VSIX build from `2.2.38` to `2.2.39`.
- Built a fresh VSIX package.
- Packaged `release/llem-2.2.39.vsix`.

### v2.2.38

- Bumped the VSIX build from `2.2.37` to `2.2.38`.
- Completely refactored the Drag & Drop functionality to eliminate flickering and improve reliability
- Enhanced support for dragging files from various sources including VS Code Explorer without needing the Shift key
- Packaged `release/llem-2.2.38.vsix`.

### v2.2.37

- Bumped the VSIX build from `2.2.36` to `2.2.37`.
- Improved Drag and Drop to work reliably without holding the Shift key
- Packaged `release/llem-2.2.37.vsix`.

### v2.2.36

- Bumped the VSIX build from `2.2.35` to `2.2.36`.
- Improved Drag and Drop to work reliably without holding the Shift key
- Added recognition for VS Code internal tree item types
- Enforced copy drop effect on both drag-enter and drag-over for better cross-environment support
- Fixed markdown lint errors in README.md
- Packaged `release/llem-2.2.36.vsix`.

### v2.2.35

- Improved Drag & Drop to work reliably without holding the Shift key
- Added recognition for VS Code internal tree item types
- Enforced 'copy' drop effect on both drag-enter and drag-over for better
  cross-environment support
- Bumped version to 2.2.35

### v2.2.34

- Bumped the VSIX build from `2.2.33` to `2.2.34`.
- Fixed Drag & Drop robustness
- Improved URI parsing for VS Code internal file dragging
- Added debug logging for drag events
- Fixed extensive markdown lint errors in README.md
- Packaged `release/llem-2.2.34.vsix`.

### v2.2.33

- Bumped the VSIX build from `2.2.31` to `2.2.33`.
- Improve Drag & Drop robustness to handle various drop targets and environments
- Enhanced URI parsing for VS Code internal file dragging
- Added debug logging for drag events
- Packaged `release/llem-2.2.33.vsix`.

### v2.2.31

- Bumped the VSIX build from `2.2.30` to `2.2.31`.
- Added configuration instructions for engineUrl and defaultModel, including
  remote Ollama example
- Packaged `release/llem-2.2.31.vsix`.

### v2.2.30

- Bumped the VSIX build from `2.2.29` to `2.2.30`.
- Fix Drag & Drop to support VS Code internal file dragging and remove flickering
- Packaged `release/llem-2.2.30.vsix`.

### v2.2.29

- Bumped the VSIX build from `2.2.28` to `2.2.29`.
- Fix VS Code sidebar drag and drop issue
- Packaged `release/llem-2.2.29.vsix`.

### v2.2.28

- Bumped the VSIX build from `2.2.27` to `2.2.28`.
- Added drag-and-drop file attachments in the chat UI
- Clarified chat file attachment usage in the README
- Packaged `release/llem-2.2.28.vsix`.

### v2.2.27

- Bumped the VSIX build from `2.2.26` to `2.2.27`.
- Refined the marketplace description and discovery keywords to match the new
  LLeM product docs
- Packaged `release/llem-2.2.27.vsix`.

### v2.2.26

- Bumped the VSIX build from `2.2.25` to `2.2.26`.
- Rebuilt the extension as LLeM with a full identity rewrite.
- Replaced the old lore with the new vault flow and English UI copy.
- Packaged `release/llem-2.2.26.vsix`.

### v2.2.25

- Rebuilt the extension identity around `LLeM`.
- Swapped the publisher to `nIcK` and the extension ID to `nIcK.llem`.
- Removed the old branding, lore, and marketplace collision path.
- Reframed the note system around a vault with `drops/` and `notes/`.
- Rewrote the webview copy in English with a more casual, modern tone.
