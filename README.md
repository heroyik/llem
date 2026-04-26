# LLeM

A local-first coding sidekick for VS Code and Cursor. Stream live model output, chat with your repo, edit files, run terminal commands, and keep everything on-device without shipping your code to the cloud.

## Features

- **Local-first model workflow**: Points at a local engine (Ollama, LM Studio) and keeps your code on your machine.
- **Live streaming output**: Renders replies inside a custom chat panel with real-time streaming for immediate feedback.
- **File & Terminal Actions**: Trigger file creations, edits, and terminal commands directly from model output.
- **Markdown Vault**: Optionally use a markdown vault (Obsidian compatible) as a long-lived note layer for project context.
- **Drag-and-Drop**: Easily attach files or folders to the chat to build context instantly.

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

- **macOS**: Press `CMD+SHIFT+P`, then select **Preferences: Open User Settings (JSON)**.
- **Windows**: Press `CTRL+SHIFT+P`, then select **Preferences: Open User Settings (JSON)**.

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

## Known Issues

- Large file attachments may impact context window limits depending on the local model's capability.
- Ensure your local server is running before attempting to chat.

## Release Notes

### v2.2.63

- Bumped the VSIX build from `2.2.62` to `2.2.63`.
- Add test console command
- Packaged `release/nIcK-2.2.63.vsix`.

### v2.2.62

- Bumped the VSIX build from `2.2.61` to `2.2.62`.
- Fix type mismatch in openAttachment
- Packaged `release/nIcK-2.2.62.vsix`.

### v2.2.61

- Bumped the VSIX build from `2.2.60` to `2.2.61`.
- Redirect stdout to LLeM Console and centralize terminal management
- Packaged `release/nIcK-2.2.61.vsix`.

### v2.2.60

- Bumped the VSIX build from `2.2.59` to `2.2.60`.
- Change identifier to llem.nIcK and remove Local suffix
- Packaged `release/nIcK-2.2.60.vsix`.

### v2.2.59

- Bumped the VSIX build from `2.2.58` to `2.2.59`.
- Cleaned up VSIX payload size and restored configuration docs
- Packaged `release/llem-2.2.59.vsix`.

### v2.2.58

- Bumped the VSIX build from `2.2.57` to `2.2.58`.
- Add Ollama settings to README and exclude test files from VSIX to reduce package size
- Packaged `release/llem-2.2.58.vsix`.

### v2.2.57

- Bumped the VSIX build from `2.2.56` to `2.2.57`.
- Restore default web browser opening for regular web links
- Packaged `release/llem-2.2.57.vsix`.

### v2.2.56

- Bumped the VSIX build from `2.2.55` to `2.2.56`.
- Limited clickable inline code blocks to only those that represent files and disabled clicking on standard web URLs within the chat interface
- Packaged `release/llem-2.2.56.vsix`.

### v2.2.55

- Bumped the VSIX build from `2.2.54` to `2.2.55`.
- Limited clickable inline code blocks to only those that represent files
- Disabled clicking on standard web URLs within the chat interface
- Packaged `release/llem-2.2.55.vsix`.

### v2.2.54

- Bumped the VSIX build from `2.2.53` to `2.2.54`.
- Standardized README structure and removed redundant metadata
- Packaged `release/llem-2.2.54.vsix`.

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
