# 🛫 LLeM

**A local-first coding sidekick for Antigravity, VS Code and Cursor.** Stream live model output, chat with your repo, edit files, run terminal commands, and keep everything on-device without shipping your soul to the cloud.

---

## ✈️ The Story

This extension was built because I was tired of being ghosted by AI every time I hit 30,000 feet. No Wi-Fi? No problem. **LLeM** was made specifically for those long-haul flights where you just want to vibe and code without needing an internet connection.

> [!NOTE]
> **Credits & Origin**: Huge shoutout to the OG inspiration, [connect-ai](https://github.com/wonseokjung/connect-ai). We took that foundation, gave it a massive refactor, and cranked everything up to eleven. We’re talking boosted performance, fresh features, and a serious security audit to keep your local workflow locked down. We didn't just download it; we leveled it up.
>
> **Special Thanks**: Seriously, LLeM wouldn't even exist if it weren't for the [connect-ai](https://github.com/wonseokjung/connect-ai) sharing their code with the world. Major respect for that open-source energy—you guys made this happen. 🫶
>
> **Fair Play**: If you're planning to build on top of this or create something new based on this code, please keep the good karma flowing and make sure to shout out the original creators [connect-ai](https://github.com/wonseokjung/connect-ai) and their contributions. Respect the hustle! ✌️

> [!IMPORTANT]
> **LLeM is 100% local.** Your code never leaves your machine. No cloud, no drama, just pure local intelligence.

## 🚀 What's New

### v3.6.1 — LLeM-local context stats for `/ctx_stats`

This patch makes `/ctx_stats` truthful inside the LLeM VS Code extension. The command now reports statistics from LLeM's own chat history and context-building metrics instead of forwarding to context-mode's Codex CLI adapter and showing Codex chat data.

- Changed `/ctx_stats` so it is handled locally by LLeM when typed in the LLeM chat composer.
- Replaced Codex CLI context-mode adapter output with LLeM-specific stats sourced from saved LLeM chat history and LLeM Performance metrics.
- Added current-chat stats for total messages, user messages, assistant messages, session id, model/profile, and last update time.
- Added context breakdown details for prompt estimate, final request size, history, attachments, active editor, workspace, vault context, pruned messages, pruned attachments, vault scan timing, and stream timing.
- Kept the output in a preserved plain-text block so spacing and line breaks remain readable in the chat transcript.
- Added a `PerfLogger.snapshot()` API so UI commands can safely read the latest LLeM performance counters without mutating diagnostics.
- Hardened pasted-image request routing after log review showed LLeM received `files=1` but did not log whether the actual model request contained image payload data. Image attachments are now normalized before dispatch, empty pasted-image data is skipped with a visible notice, prompt requests with files are forced onto the file-aware path, and stream request logs include Ollama image counts/base64 size plus OpenAI-compatible image part counts.
- Made image payload insertion target the latest user message instead of assuming the last request message is always the user turn, so future context-building changes cannot accidentally attach images to a trailing assistant/system message.
- Added an in-chat MCP Servers panel from the settings button. It lists resolved MCP servers with source, transport, command, and enabled state, supports global MCP runtime toggling, and lets editable LLeM/Codex-synced servers be enabled or disabled immediately without editing settings JSON.
- Added MCP panel controls for refresh, runtime reload, Codex MCP sync, GitHub MCP import, and the existing advanced settings picker. Workspace/custom source servers are shown read-only with their source path so the UI does not silently rewrite external config files.
- Added live MCP tool activity in the response status bar. While an MCP server is executing a tool, LLeM now shows the active server and function name, for example `context-mode · ctx_batch_execute`, then restores the normal live-output state when the call completes.
- Packaged `release/llem-3.6.1.vsix`.

### v3.6.0 — Codex-style composer, picker attachments, and reliable local vision payloads

This release focuses on making the LLeM chat composer feel much closer to modern agent chat surfaces while also fixing the full pasted-image path across every supported local engine. The important bit: images pasted or attached in chat now stay attached as model input instead of nudging the assistant toward unrelated workspace images.

- Added a Codex-style `/` command palette inside the chat input. Typing `/` now opens a keyboard-navigable menu for common LLeM commands such as `/agent`, `/plan`, `/default`, `/approve`, `/run-plan`, and `/list_mcp_tools`.
- Added `@` file mention suggestions backed by the synchronized workspace file list. Typing `@` opens file candidates, supports path-style narrowing such as `@src/...`, and inserts the selected workspace path directly into the prompt.
- Added keyboard controls for the composer suggestion menu: arrow keys move through choices, `Enter` or `Tab` accepts the current item, and `Esc` closes the menu without sending the prompt.
- Made the chat input helper text reflect the new workflow: `Enter` sends, `Shift+Enter` adds a line, `/` opens commands, and `@` opens file references.
- Clarified and instrumented the file attachment button path. The existing picker now explicitly supports image attachments in addition to audio and text/code files, so users do not need to rely on drag-and-drop to attach screenshots or book captures.
- Fixed pasted/attached image forwarding for all supported local engines:
  - **Ollama** now receives native `/api/chat` image input through `messages[].images`.
  - **LM Studio** now receives OpenAI-compatible `image_url` content parts with data URLs.
  - **Rapid-MLX** now receives MLX-VLM-style `input_image` content parts.
- Split image request shaping into a dedicated helper so the engine-specific payload formats are testable and less likely to regress.
- Added regression tests covering the three image payload formats: Ollama, LM Studio, and Rapid-MLX.
- Updated diagnostics to include the detected local engine kind in stream request logs, making future image-routing issues easier to identify from logs.
- Fixed direct context-mode slash output rendering so `/ctx_stats` preserves its original bars, spacing, separators, and line breaks in the LLeM chat instead of being flattened by Markdown.
- Changed `/ctx_stats` inside LLeM so it reports LLeM-local context statistics from LLeM chat history and LLeM Performance metrics instead of forwarding the command to context-mode's Codex CLI adapter. The output now summarizes saved LLeM conversations, current chat message counts, prompt/request size, history, attachments, active editor, workspace, vault context, pruning, and stream timing.
- Fixed `/list_mcp_tools` slash handling so it runs as the built-in MCP tool listing action without also producing a bogus "MCP slash command not found" error.
- Packaged `release/llem-3.6.0.vsix`.

### v3.5.13 — Cleaner modes, refreshed branding, and better Gemma vision support

LLeM's latest release tightens the main chat controls and improves multimodal routing for local Ollama Gemma-family models.

- Moved execution mode selection into the chat composer for a cleaner, more direct workflow.
- Added visible mode toggles for Default, Plan, and Agent-style work.
- Refreshed the LLeM icon with a transparent background.
- Improved Ollama Gemma 4 multimodal detection and image attachment forwarding.
- Packaged `release/llem-3.5.13.vsix`.

---

## 📥 Installation

Since **LLeM** is currently in early flight, we distribute it via `.vsix` files. Follow these steps to get airborne:

### 1. Download the Extension
1. Go to the [LLeM GitHub Repository](https://github.com/heroyik/llem).
2. Look at the **Releases** section on the right sidebar.
3. Click on the latest release tag (for example, `v3.6.0`).
4. Under the **Assets** section, click on the `.vsix` file (for example, `llem-3.6.0.vsix`) to download it to your machine.

### 2. Install in VS Code or Cursor
1. Open **VS Code** or **Cursor**.
2. Open the **Extensions** view by clicking the square icon in the left sidebar or pressing `Cmd+Shift+X` (macOS) or `Ctrl+Shift+X` (Windows/Linux).
3. Click the **`...` (More Actions)** menu icon in the top right corner of the Extensions view title bar.
4. Select **Install from VSIX...** from the dropdown menu.
5. Locate and select the `.vsix` file you just downloaded.
6. Once installed, you might need to click **Reload** or restart your editor.

---

## ✨ Features

- **🛡️ Local-First Workflow**: Connects directly to local engines like **Rapid-MLX**, **LM Studio**, or **Ollama**. No cloud, no API costs.
- **🚀 Live Streaming**: Real-time output rendered inside a custom VS Code chat panel with full Markdown and code block support.
- **🛠️ Agentic Actions**: Trigger file creations, non-destructive edits, and terminal commands directly from the AI's response.
- **🗂️ Persistent History**: Conversations are automatically saved to `~/.llem-history`, supporting session recovery, renaming, and bulk deletion.
- **🔍 Workspace Awareness**: Real-time monitoring of your project files. Drop files/folders into chat for instant, high-fidelity context injection.
- **🧠 The Brain (Markdown Vault)**: Sync your notes with an Obsidian-compatible vault. Supports visual network maps and local Git synchronization.
- **⚡ Performance First**: Multi-layered caching, request throttling, and token-usage monitoring to keep your dev environment snappy.
- **🧭 Model-Aware Prompt Budgeting**: Automatically trims prompt weight for big local models so 24B+ and 26B-class runs stay responsive instead of drowning in context.
- **📊 Built-In Diagnostics**: Inspect prompt size, first-token delay, section-by-section context weight, and streaming throughput directly from the LLeM diagnostics panel.

---

## 🚀 Quick Start

To get started, you'll need a local model runtime running on your machine.

### 1. Choose Your Engine

#### **Rapid-MLX**

Typical URL: `http://127.0.0.1:8000`

Rapid-MLX is supported as an OpenAI-compatible local engine. LLeM talks to its `/v1/chat/completions` streaming endpoint and reads installed models from `/v1/models`.

```bash
# Install and serve a model on the default Rapid-MLX port
pip install vllm-mlx
rapid-mlx serve qwen3.5-4b --port 8000
```

Then point `llem.engineUrl` at `http://127.0.0.1:8000` or pick **Rapid-MLX** from **Settings -> Swap model engine**.

#### **Ollama**

Typical URL: `http://127.0.0.1:11434`

```bash
# Pull a model and serve
ollama pull gemma4:e4b
ollama serve
```

For larger local runs, a 24B+ Gemma-family model is a better fit for the new performance profile flow:

```bash
# Example 26B-class local setup
ollama pull gemma4:26b
ollama serve
```

#### **LM Studio**

Typical URL: `http://127.0.0.1:1234`

1. Download and load your favorite model.
2. Enable the **Local Server**.
3. Confirm the server is active.
4. Point `llem.engineUrl` at `http://127.0.0.1:1234` or pick **LM Studio** from **Settings -> Swap model engine**.

LLeM treats LM Studio as an OpenAI-compatible local engine and automatically normalizes the request path to `/v1/chat/completions`.

---

## ⚙️ Configuration

Open your VS Code `settings.json` to customize the experience.

| Setting | Description | Default |
| :--- | :--- | :--- |
| `llem.engineUrl` | Local/remote model endpoint URL. Supports Rapid-MLX (`:8000`), LM Studio (`:1234`), OpenAI-compatible `/v1` servers, and Ollama (`:11434`). | `http://127.0.0.1:11434` |
| `llem.defaultModel` | The default model slug used for requests. | `gemma4:e4b` |
| `llem.performancePreset` | Prompt and generation budget profile. Use `auto`, `balanced`, or `large-local-26b`. | `auto` |
| `llem.requestTimeout` | Request timeout in seconds. | `300` |
| `llem.vaultPath` | Path to your markdown vault. | `~/.llem-vault` |
| `llem.bridgeEnabled` | Enable the local HTTP bridge on port 4825. | `false` |
| `llem.bridgeToken` | Security token for authenticated bridge callers. | `(empty)` |
| `llem.mcpEnabled` | Enable MCP server discovery and tool calls. | `true` |
| `llem.mcpServers` | MCP servers registered directly in LLeM. | `{}` |
| `llem.mcpConfigSources` | MCP sources to resolve. | `["llem", "workspace", "codex-global", "codex-project"]` |
| `llem.mcpConfigPaths` | Extra MCP JSON/TOML config paths to import. | `[]` |
| `llem.mcpToolTimeoutSeconds` | Timeout for MCP startup, listing, and calls. | `60` |
| `llem.maxHistoryItems` | Maximum number of sessions to keep in history. | `100` |

> [!TIP]
> If you're using a slower model or long prompts, try bumping up the `llem.requestTimeout`.

### MCP Servers

LLeM can register and run MCP servers with Codex-style action tags:

```xml
<list_mcp_tools/>
<call_mcp_tool server="context7" tool="resolve-library-id">{"libraryName":"react"}</call_mcp_tool>
```

Direct LLeM config lives in `llem.mcpServers`:

```json
"llem.mcpServers": {
  "context7": {
    "command": "npx",
    "args": ["-y", "@upstash/context7-mcp"],
    "env": {},
    "enabled": true
  }
}
```

LLeM also syncs Codex MCP settings from `$CODEX_HOME/config.toml`, `~/.codex/config.toml`, and `<workspace>/.codex/config.toml`. Before applying a sync it shows a diff with Added, Removed, and Changed servers; environment values are masked and only changed keys are shown. Synced snapshots are stored in `~/.llem/llem-mcp-synced.json` instead of VS Code settings, and user-owned `llem.mcpServers` are never deleted or modified by Codex sync.

Use **Settings -> MCP servers -> Import MCP from GitHub URL** to paste an MCP repository URL. LLeM reads README/package/config examples, previews the inferred server command, and imports it only after approval.

v1 runs `stdio` MCP servers only. HTTP/SSE/remote entries can be imported and listed, but tool calls report them as unsupported.

### Prompt Prolog

LLeM reads markdown files from `~/.llem/prolog` before every prompt. Files are loaded in 0-9, A-Z filename order and injected directly after the built-in system prompt as mandatory prolog instructions. Use this for durable local routing rules, house style, or workflow constraints that should apply to every request.

#### Troubleshooting

- If terminal commands fail on Windows, confirm `node`, `npm`, and `npx` are available in the VS Code process environment.
- If a model response suggests an edit that has no effect, use `read_file` first and retry with the current file content.

### 26B Local Model Tuning

For bigger local models such as `gemma4:26b` or other 24B+ Gemma-family builds:

- prefer **Rapid-MLX** or **LM Studio** when you want an OpenAI-compatible local server,
- prefer **Ollama** when you want the native Ollama `/api/chat` path and local manifest-based capability hints,
- switch `llem.performancePreset` to `large-local-26b` if you want tighter prompt budgets immediately,
- keep `llem.performancePreset` on `auto` if you want LLeM to detect 26B-class models by name or metadata,
- raise `llem.requestTimeout` to around `600` seconds on slower or memory-constrained machines,
- pair a 26B default with a smaller fallback model if you want fast iteration for simple edits.

Current-machine guidance:

- on Apple Silicon systems around the `34 GB` class, `large-local-26b` is the recommended preset for 26B local models,
- on other machines, start with the same preset and only widen timeout or context if your hardware can comfortably handle it.

### Performance Profiles

LLeM now exposes a model-sensitive prompt and generation budget setting through `llem.performancePreset`.

- `auto`: Recommended default. LLeM checks the selected model name and, when available, Ollama metadata such as `parameter_size`. If the model looks like a `24B+` local run, it automatically switches into the 26B profile.
- `balanced`: Keeps the wider default context and generation budget. This is the better fit for smaller local models when raw responsiveness is already good.
- `large-local-26b`: Uses a tighter prompt budget and smaller Ollama generation window so big local models spend less time chewing through workspace context before the first token lands.

When `large-local-26b` is active, LLeM intentionally becomes more selective about context:

- active editor context gets first priority,
- attached text files are budgeted per file and across the whole turn,
- workspace tree and vault index are clipped more aggressively,
- and older low-relevance chat history is pruned before the current request is allowed to grow out of control.

This is designed to improve real-world latency, not benchmark token counts in isolation. The point is to keep the answer useful while reducing the hidden prompt tax that large local models pay.

### Diagnostics And What To Watch

Use **LLeM: Show Diagnostics** when tuning a larger model. The diagnostics channel now surfaces the key numbers you need:

- selected model and resolved performance profile,
- estimated prompt size before send,
- final request size after pruning,
- history, attachment, active-editor, workspace, and vault character breakdowns,
- pruned message count and attachment trim amount,
- first-token latency,
- total stream duration,
- and token throughput.

If a 26B-class model still feels sluggish, the fastest knobs to check are:

1. `llem.performancePreset`
2. `llem.requestTimeout`
3. total attachment size in the current turn
4. whether the active file or vault index is unusually large

In practice, this makes it much easier to see whether the bottleneck is model load time, prompt size, or generation speed.

---

## 🛠️ Development

### Prerequisites

- **Node.js** (v18+)
- **npm**

### Commands

- **Compile**: `npm run compile`
- **Build VSIX**: `npm run package:vsix`
- **Local Test VSIX**: `npm run package:vsix:local`

---

## ⚠️ Known Issues

- **Context Limits**: Large file attachments might hit the context window limit of your local model.
- **Large-Model Warmup**: The first request to a 24B+ local model can still feel slow even after prompt trimming, especially right after loading the model into memory.
- **Server Check**: Make sure your local engine (Rapid-MLX/LM Studio/Ollama) is actually running before you start chatting.

---

## 📝 Release Notes

### v3.5.13

- Moved execution mode selection into the chat composer and refreshed the LLeM icon with transparent background.
- Added chat header mode toggles for Default, Plan, and Agent modes.
- Improved Ollama Gemma 4 multimodal detection and image attachment forwarding.
- Packaged `release/llem-3.5.13.vsix`.

### v3.5.12

- Support context-mode utility command aliases and render MCP text results directly.
- Packaged `release/llem-3.5.12.vsix`.

### v3.5.11

- Show MCP slash command results directly in chat responses.
- Packaged `release/llem-3.5.11.vsix`.

### v3.5.10

- MCP slash commands such as /ctx_stats now execute directly and placeholder MCP server names are resolved from available tools.
- Packaged `release/llem-3.5.10.vsix`.

### v3.5.9

- Added execution modes and Windows HOME prolog loading
- removed profile fallback from prolog discovery
- Packaged `release/llem-3.5.9.vsix`.

### v3.5.8

- Moved the active neon animation from the header tagline to the Running now queue card
- Packaged `release/llem-3.5.8.vsix`.

### v3.5.7

- Moved MCP runtime modules into src/mcp for clearer source organization
- Packaged `release/llem-3.5.7.vsix`.

### v3.5.6

- Prevent partial file paths from expanding into nested MCP folders
- Packaged `release/llem-3.5.6.vsix`.

### v3.5.5

- Added ~/.llem/prolog markdown prolog loading before every prompt
- Applied prolog files in numeric and alphabetical filename order
- Documented prompt prolog behavior in README
- Packaged `release/llem-3.5.5.vsix`.

### v3.5.4

- Recognized codex as an MCP config source alias so synced Codex servers appear in LLeM server lists
- Packaged `release/llem-3.5.4.vsix`.

### v3.5.3

- Moved synced MCP snapshots from VS Code settings into ~/.llem/llem-mcp-synced.json
- Documented the home-profile MCP sync storage path in README
- Added neon highlighting for the active running queue prompt
- Removed the header neon underline below the LLeM tagline
- Packaged `release/llem-3.5.3.vsix`.

### v3.5.2

- Added MCP server discovery and stdio tool-call support
- Added Codex MCP config sync with diff preview and masked environment changes
- Added GitHub MCP server import flow
- Packaged `release/llem-3.5.2.vsix`.

### v3.5.0

**v3.5.0** expands LLeM's local engine support beyond the original Ollama/LM Studio flow and makes OpenAI-compatible MLX runtimes a first-class path.

- Bumped the extension version from `3.4.3` to `3.5.0`.
- Added **Rapid-MLX** support as a local OpenAI-compatible backend.
- Added automatic first-run discovery for Rapid-MLX at `http://127.0.0.1:8000`.
- Added `/v1/models` model discovery for Rapid-MLX and other OpenAI-compatible local engines.
- Normalized Rapid-MLX requests to `/v1/chat/completions`, matching the same streaming chat shape used by LM Studio.
- Kept **LM Studio** support explicit at `http://127.0.0.1:1234`, including `/v1/chat/completions` and `/v1/models`.
- Kept **Ollama** support on the native `http://127.0.0.1:11434` path with `/api/chat`, `/api/tags`, and Ollama metadata/capability checks.
- Updated the Settings menu so **Rapid-MLX**, **LM Studio**, and **Ollama** can all be selected from **Swap model engine**.
- Updated active runtime labels so prompts and diagnostics report `Rapid-MLX`, `LM Studio`, `Ollama`, or a generic OpenAI-compatible local engine instead of mislabeling every `/v1` endpoint as LM Studio.
- Improved connection and model-not-found guidance so errors point users toward the selected engine's expected local port and startup flow.
- Fixed the first action icon under chat results so it copies the message to the clipboard without pasting it into the composer or opening the edit-branch banner.
- Refreshed README setup guidance with Rapid-MLX install/serve examples, LM Studio selection notes, and the complete local engine compatibility list.

### v3.4.3

- Renamed the VS Code tab and view labels from Assistant to LLeM.
- Refreshed the compiled extension and webview bundles for the release.
- Packaged `release/llem-3.4.3.vsix`.

### v3.4.2

- Removed MCP and context-mode integration from runtime, prompts, and docs
- cleaned vault handling guidance and saved context-mode rules into the local vault
- refreshed package contents after the MCP removal
- Packaged `release/llem-3.4.2.vsix`.

### v3.4.1

- Removed LLeM branding from visible UI strings
- removed context-mode integration
- restored local TypeScript tooling so typecheck works again
- Packaged `release/llem-3.4.1.vsix`.

### v3.4.0

This release focuses on making agentic file edits visible, debuggable, and easier to trust when running local models such as Ollama Gemma-family models.

- **Codex-style file change summaries in chat**: When LLeM creates, edits, or deletes files, the chat now shows a compact change card with one row per file. Each row includes the action, file name, and line-level `+` / `-` counts so you can immediately see what changed without opening the filesystem first.
- **Whole-turn change totals**: Multi-file edits now include a footer such as `2 files changed +75 -20`, giving a clear overview of the total edit impact for the current agent action.
- **Clickable changed files**: File rows in the change summary can be clicked to open the affected file directly from the chat UI.
- **Review Changes shortcut**: The change summary includes a `Review changes` button that opens VS Code's Source Control view, making it faster to inspect the workspace diff after an agent run.
- **Stronger edit failure visibility**: If the model emits an `<edit_file>` action but none of the `<find>` blocks match the current file, LLeM now reports it as a clear failure: `Edit failed ... replacement 0/N`. This makes silent no-op edits much harder to miss.
- **Immediate Action Report streaming**: External action results are now posted into the live chat stream as soon as they happen. File edits, failed replacements, safety blocks, and terminal actions no longer wait until later continuation logic to become visible.
- **Action Report preserved in the final answer**: The final assistant message keeps the action report attached, so the user can scroll back later and still see exactly what LLeM tried, what succeeded, and what failed.
- **Cleaner regenerate behavior**: `Regenerate reply` now removes the previous assistant response from the chat UI before streaming the replacement, so regeneration feels like a true retry instead of an extra appended answer.
- **Follow-up recovery guidance for local models**: When an edit fails because the `<find>` text does not match, LLeM now gives the follow-up model turn a stronger system observation telling it to retry with exact current file content instead of explaining the failure away.
- **Post-mortem logging for file actions**: File create/edit/delete paths now write structured diagnostics for validation blocks, missing files, invalid edit bodies, zero-replacement edits, successful writes, and exceptions. These logs include trace IDs, parsed action counts, file paths, replacement metadata, and previews to help reconstruct what happened after a failed run.
- **Safer testable logging outside VS Code**: The logger now lazily loads the VS Code API and falls back to diagnostics-file logging during Node-based tests, so action logging can be covered without requiring an extension host.
- **Regression coverage for edit metadata**: Tests now verify that file action results include structured change metadata for created, edited, and deleted files.

### v3.3.35

- Bumped version and upgraded axios before VSIX build.
- Packaged `release/llem-3.3.35.vsix`.

### v3.3.34

- Fixed image lightbox close behavior so the top-right close button and backdrop dismiss reliably. Reduced action-history bloat by keeping only the most recent file context per turn and trimming file/web observation payloads.
- Packaged `release/llem-3.3.34.vsix`.

### v3.3.33

- Reduced action-history bloat by keeping only the most recent file context per turn and trimming file/web observation payloads. Improved live output masking, offline vision detection, image lightbox preview, and request startup logging.
- Packaged `release/llem-3.3.33.vsix`.

### v3.3.32

- Masked create_file and edit_file code from live output and now show progress-only streaming states. Improved offline vision-model detection using local Ollama manifests and added vision decision logging.
- Packaged `release/llem-3.3.32.vsix`.

### v3.3.31

- Improved offline vision-model detection using local Ollama manifests. Fixed capability checks to use the active engine endpoint and added vision decision logging.
- Packaged `release/llem-3.3.31.vsix`.

### v3.3.30

- Implemented Intelligent Repetition Guard with tiered backoff (3s, 10s, 30s), non-blocking queue scheduling, and automated retry orchestration with UI cooldown feedback.
- Packaged `release/llem-3.3.30.vsix`.

### v3.3.29

- Implemented File System Access Transparency with user-approved out-of-workspace operations and high-fidelity UI feedback.
- Packaged `release/llem-3.3.29.vsix`.

### v3.3.28

- Action transparency and loop prevention improvements
- Packaged `release/llem-3.3.28.vsix`.

### v3.3.27

- Added live stream metadata (duration, chunks, chars) to action progress UI
- Packaged `release/llem-3.3.27.vsix`.

### v3.3.24

- Implemented AI self-correction loop and Codex-style action progress visualization
- Packaged `release/llem-3.3.24.vsix`.

### v3.3.22

- **B-1 fix**: Repeated/watchdog-aborted responses are no longer pushed to the chat history. Previously, the aborted assistant message would linger in history and seed the next turn with a contaminated context, causing cascading repetition loops. Now the pipeline returns immediately without writing the bad response to history.
- **B-2 fix**: Consecutive `assistant → assistant` or `user → user` message pushes during agentic action loops are now de-duplicated. If a `continuation` user message arrives when the last history entry is already a `user` entry, the content is merged rather than creating a second entry.
- **B-3 fix**: Images are no longer forwarded to text-only models (gemma, llama, mistral, etc.). The model name is inspected for known vision indicators (`llava`, `vision`, `:vl`, `bakllava`, `moondream`, etc.) and a clear in-chat notice is shown when an image is skipped.
- **B-4 fix**: `RequestRetryGuard` fingerprints now use a normalized, punctuation-stripped 300-character prompt core instead of the raw prompt string. Rephrased retries of the same request are blocked even when the exact wording changes.
- **FileStateGuard**: New `src/fileStateGuard.ts` computes SHA-256 hashes before and after every `edit_file` action. A `no-effect` warning is surfaced when the file is unchanged (typically a `<find>` mismatch). After 3 consecutive no-effect edits on the same file, `loop-detected` is returned and further edits on that path are blocked via `ActionLoopGuard`.
- Packaged `release/llem-3.3.22.vsix`.

### v3.3.21

- Live stream output now shows raw AI text without any HTML/Markdown parsing during generation — `<edit_file>`, `<find>`, `<replace>` action tags are visible as-is while streaming.
- Final reply (after stream completes) continues to render as full Markdown with code highlighting, file badges, and action summaries.
- Removed `sanitizeAssistantDisplayText()` call from the live `renderStreamNow()` path so the raw model output is never silently stripped mid-stream.
- Packaged `release/llem-3.3.21.vsix`.

### v3.3.20

- Hardened assistant output sanitization to prevent leaked action tags and scratchpad text in streamed replies
- Packaged `release/llem-3.3.20.vsix`.

### v3.3.19

- Fixed RepetitionWatchdog false positives that could truncate edit-file streams during repeated action-tag/code sequences. Added regression coverage for repeated closing-tag action streams.
- Packaged `release/llem-3.3.19.vsix`.

### v3.3.18

- Repackaged the current workspace state through the formal VSIX release flow.
- Packaged `release/llem-3.3.18.vsix`.

### v3.3.17

- Fixed RepetitionWatchdog false positives on markdown structure tokens so tables, fences, headers, list markers, blockquotes, and task markers no longer abort valid replies
- added regression tests for markdown-safe watchdog behavior
- Packaged `release/llem-3.3.17.vsix`.

### v3.3.16

- Bumped the extension version from `3.3.15` to `3.3.16`.
- Added structured repetition abort handling, retry and action loop guards, safer file mutation validation, restored clickable editable files, and added default-browser opening for chat URL links.
- Fixed Korean IME Enter handling so composing Hangul no longer sends a duplicated trailing message.
- Added composition-aware Enter submission logic with regression coverage for `isComposing` and IME confirm keycode `229`.
- Hardened stream loop handling so repetition detection is promoted into structured pipeline state instead of being treated like a normal completion.
- Stopped follow-up execution after repetition aborts, including watchdog-triggered stops and turn-to-turn repeated continuation loops.
- Added request fingerprinting and retry fencing so the same request cannot immediately restart after a repetition stop.
- Added action loop guarding so repeated `create_file` and `edit_file` patterns are blocked before they spin in place.
- Added file mutation guarding so the same file cannot be mutated twice at the same time during model-driven actions.
- Rejected incomplete `<find>/<replace>` edit bodies before disk write, preventing truncated edit actions from corrupting files.
- Rejected obviously truncated `create_file` output such as unbalanced fenced code blocks before writing files.
- Generalized plan-first enforcement for implementation requests, not just special design-guideline file names.
- Added implementation planning mode so code-generation requests are guided toward a compact file split and smaller Next.js/TypeScript steps first.
- Added a stronger post-processing guard that blocks action-tag execution if the model disobeys the initial plan-only response.
- Restored clickable editable-file behavior in chat by improving local file link validation, workspace-path resolution, and message rerendering after workspace file sync.
- Added default-browser opening for URL links in chat by routing external links through the extension host with `vscode.env.openExternal(...)`.
- Expanded tests for stream outcome handling, retry guards, action loop guards, file mutation guards, design planning mode, editable file resolution, external link routing, and file-safety edge cases.
- Packaged `release/llem-3.3.16.vsix`.

### v3.3.15

- Fixed Korean IME Enter handling to prevent duplicate trailing messages
- added regression tests for composition-safe prompt submission
- Packaged `release/llem-3.3.15.vsix`.

### v3.3.14

- Added queued request pause/resume and reordering
- Added direct editing for queued items
- Expanded queue tests and stabilized package test suite
- Packaged `release/llem-3.3.14.vsix`.

### v3.3.12

- Fix stop button UI and edit banner visibility
- Packaged `release/llem-3.3.12.vsix`.

### v3.3.11

- Fix main-view layout causing input to overflow
- Packaged `release/llem-3.3.11.vsix`.

### v3.3.10

- Fix terminal executing logged messages
- Packaged `release/llem-3.3.10.vsix`.

### v3.3.9

- Fix immediate deletion of history items in UI
- Packaged `release/llem-3.3.9.vsix`.

### v3.3.8

- Fix edit banner visibility on initial chat load
- Packaged `release/llem-3.3.8.vsix`.

### v3.3.7

- Fix edit banner visibility on initial chat load
- Fix terminal rendering, layout stability, and improve hardware summary quality
- Packaged `release/llem-3.3.7.vsix`.

### v3.3.6

- Implemented sequence-aware RepetitionWatchdog and improved action parsing to prevent infinite loops.
- Packaged `release/llem-3.3.6.vsix`.

### v3.2.9

- Fixed model output streaming issues with buffering and enhanced token extraction for reasoning fields.
- Packaged `release/llem-3.2.9.vsix`.

### v3.2.7

- Fixed AI response truncation, improved action tag stripping with smart quote support, and tuned model performance profiles for 26B models.
- Packaged `release/llem-3.2.7.vsix`.

### v3.2.5

- Enabled unlimited response length by setting predict token limits to -1. Added handling for unlimited output in both Ollama and LM Studio engines.
- Packaged `release/llem-3.2.5.vsix`.

### v3.2.3

- Increased token prediction limits to 4096+ to prevent response truncation. Fixed LM Studio max_tokens mapping.
- Packaged `release/llem-3.2.3.vsix`.

### v3.2.1

- Implemented repetition penalty for large models to prevent hallucination loops, fixed model selection persistence in settings.json, and added overwrite protection for user settings.
- Packaged `release/llem-3.2.1.vsix`.

### v3.1.9

- Revert to standard settings.json persistence and fix model selection overwrite issue
- Packaged `release/llem-3.1.9.vsix`.

### v3.1.8

- Added Codex-style message actions for user and assistant replies
- restored copy and edit flows for existing user messages
- added edit-in-new-branch composer state
- Packaged `release/llem-3.1.8.vsix`.

### v3.1.7

- Made the model dropdown persist the real active default model and pass runtime engine/model metadata into each request
- Removed the earlier-message editing banner and edit entrypoint from the chat UI so message composer stays in normal send mode
- Packaged `release/llem-3.1.7.vsix`.

### v3.1.6

- Added file-based diagnostics for stream debugging with per-request raw chunk capture and parsed token traces
- Logged final assistant text cleanup so empty replies can be traced from transport through final rendering
- Packaged `release/llem-3.1.6.vsix`.

### v3.1.5

- Improved stream parsing for object-shaped output chunks
- Fixed empty reply state when the model returned text in newer OpenAI-compatible stream formats
- Packaged `release/llem-3.1.5.vsix`.

### v3.1.4

- Fixed recurring empty replies by broadening stream parsing for additional LM Studio and Ollama response shapes
- Added raw stream preview logging when parsed output ends up empty so future payload mismatches are diagnosable instantly
- Packaged `release/llem-3.1.4.vsix`.

### v3.1.3

- Added model-aware performance presets for 26B-class local Ollama runs
- Added prompt budgeting and richer diagnostics for large local Gemma-family models
- Expanded the README with detailed performance profile guidance, 26B tuning notes, and diagnostics tips
- Packaged `release/llem-3.1.3.vsix`.

### v3.1.2

- Fixed empty-reply turns by hardening stream parsing for Ollama and LM Studio
- Flushed trailing stream buffers so the final token is not lost when a stream ends without a newline
- Saved assistant replies consistently into chat history so follow-up turns keep the right conversation context
- Updated the chat UI to distinguish truly empty replies from successful completed output
- Packaged `release/llem-3.1.2.vsix`.

## Release Notes

### v3.6.4

- Fix MLLM token cap error for rapid-mlx engine without image attachments
- Packaged `release/llem-3.6.4.vsix`.

### v3.6.1

- Changed `/ctx_stats` to report LLeM-local chat/context statistics instead of Codex CLI context-mode adapter data.
- Added local stats output for saved LLeM sessions, current chat messages, model/profile, context sizes, pruning, vault scan timing, and stream timing.
- Added `PerfLogger.snapshot()` for read-only access to the latest LLeM Performance metrics.
- Hardened pasted-image dispatch by validating image data, forcing file-bearing prompts through the file-aware path, attaching images to the latest user message, and logging outgoing image payload counts/sizes.
- Added a webview MCP Servers panel with per-server enable/disable toggles for editable LLeM and Codex-synced servers plus global MCP runtime controls.
- Added live MCP tool status during generation so the chat shows which server/tool is currently running.
- Packaged `release/llem-3.6.1.vsix`.

### v3.6.0

- Added a Codex-style `/` command palette inside the chat composer for quick access to `/agent`, `/plan`, `/default`, `/approve`, `/run-plan`, and `/list_mcp_tools`.
- Added `@` workspace file mention suggestions with path-aware narrowing and keyboard selection.
- Added suggestion menu keyboard handling: arrow keys navigate, `Enter`/`Tab` accept, and `Esc` closes the menu.
- Updated the composer helper text so the new `/` command and `@` file workflows are discoverable from the input area.
- Clarified the attachment picker path and kept image attachment support available outside drag-and-drop.
- Fixed pasted and attached image payloads across all supported local engines:
  - Ollama receives native `/api/chat` `messages[].images`.
  - LM Studio receives OpenAI-compatible `image_url` content parts.
  - Rapid-MLX receives MLX-VLM-style `input_image` content parts.
- Split engine-specific image request shaping into a dedicated helper and added regression tests for Ollama, LM Studio, and Rapid-MLX payloads.
- Added engine-kind logging to stream request diagnostics so future local runtime routing issues are easier to inspect.
- Fixed direct context-mode slash output rendering so `/ctx_stats` displays as preserved plain text inside LLeM.
- Changed `/ctx_stats` to render LLeM-local chat/context statistics from LLeM history and performance metrics instead of showing Codex CLI context-mode adapter data.
- Fixed `/list_mcp_tools` slash handling so it does not double-run as an unresolved MCP tool command.
- Packaged `release/llem-3.6.0.vsix`.
