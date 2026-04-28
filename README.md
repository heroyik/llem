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

## Development

### Prerequisites

- Node.js (v18 or higher)
- npm

### Build and Package

To compile the extension and webview assets:

```bash
npm run compile
```

To build a production VSIX package:

```bash
npm run package:vsix
```

The resulting file will be generated in the `release/` directory.

### Local Development VSIX

To build a VSIX for local testing (using local scripts):

```bash
npm run package:vsix:local
```

## Known Issues

- Large file attachments may impact context window limits depending on the local model's capability.
- Ensure your local server is running before attempting to chat.
