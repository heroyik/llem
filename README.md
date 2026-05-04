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

### v3.3.25
- **[UI/UX] Live Stream Metadata**: Action progress badges now display real-time statistics, including total duration, chunk count, and character count, giving you full visibility into the AI's generation performance.

### v3.3.23
- **[Robustness] AI Self-Correction Loop**: When a file edit fails due to context mismatch, LLeM now automatically feeds the actual file content back to the AI for an immediate, accurate retry.
- **[UI/UX] Action Progress Visualization**: Live streaming now shows clean, "Codex-style" progress badges for file operations instead of raw XML, keeping you informed without the clutter.
- **[Reliability] Tag Normalization**: Improved handling of aborted or incomplete streams to ensure actions are executed even if the connection drops.

---

## 📥 Installation

Since **LLeM** is currently in early flight, we distribute it via `.vsix` files. Follow these steps to get airborne:

### 1. Download the Extension
1. Go to the [LLeM GitHub Repository](https://github.com/heroyik/llem).
2. Look at the **Releases** section on the right sidebar.
3. Click on the latest release tag (e.g., `v3.1.3`).
4. Under the **Assets** section, click on the `.vsix` file (e.g., `llem-3.1.3.vsix`) to download it to your machine.

### 2. Install in VS Code or Cursor
1. Open **VS Code** or **Cursor**.
2. Open the **Extensions** view by clicking the square icon in the left sidebar or pressing `Cmd+Shift+X` (macOS) or `Ctrl+Shift+X` (Windows/Linux).
3. Click the **`...` (More Actions)** menu icon in the top right corner of the Extensions view title bar.
4. Select **Install from VSIX...** from the dropdown menu.
5. Locate and select the `.vsix` file you just downloaded.
6. Once installed, you might need to click **Reload** or restart your editor.

---

## ✨ Features

- **🛡️ Local-First Workflow**: Connects directly to local engines like **Ollama** or **LM Studio**. No cloud, no API costs.
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
ollama pull gemma6:26b
ollama serve
```

#### **LM Studio**

Typical URL: `http://127.0.0.1:1234`

1. Download and load your favorite model.
2. Enable the **Local Server**.
3. Confirm the server is active.

---

## ⚙️ Configuration

Open your VS Code `settings.json` to customize the experience.

| Setting | Description | Default |
| :--- | :--- | :--- |
| `llem.engineUrl` | Local/remote model endpoint URL. | `http://127.0.0.1:11434` |
| `llem.defaultModel` | The default model slug used for requests. | `gemma4:e4b` |
| `llem.performancePreset` | Prompt and generation budget profile. Use `auto`, `balanced`, or `large-local-26b`. | `auto` |
| `llem.requestTimeout` | Request timeout in seconds. | `300` |
| `llem.vaultPath` | Path to your markdown vault. | `~/.llem-vault` |
| `llem.bridgeEnabled` | Enable the local HTTP bridge on port 4825. | `false` |
| `llem.bridgeToken` | Security token for authenticated bridge callers. | `(empty)` |
| `llem.maxHistoryItems` | Maximum number of sessions to keep in history. | `100` |

> [!TIP]
> If you're using a slower model or long prompts, try bumping up the `llem.requestTimeout`.

### 26B Local Model Tuning

For bigger local models such as `gemma6:26b` or other 24B+ Gemma-family builds:

- prefer **Ollama** for the current optimized path,
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
- **Server Check**: Make sure your local engine (Ollama/LM Studio) is actually running before you start chatting.

---

## 📝 Release Notes

### v3.1.1 — Editable Message Branching, Preference Memory, and Markdown Rendering Fixes

**v3.1.1** builds on the `v3.1.0` chat UX refresh and adds the missing piece: editing earlier user messages in a Gemini Web-style flow.

#### Edit earlier messages like Gemini Web

You can now go back to a previous **user** message, click **Edit**, revise the prompt, and continue from there.

- the old thread stays intact,
- LLeM creates a new branch from the point before that message,
- the edited prompt is resubmitted into that branch,
- and any reusable attached files from the original message can travel with the edit flow.

This keeps the conversation history safe while making prompt iteration much faster and less destructive.

#### Reply actions are now a full iteration loop

With `Copy`, `Branch`, `Edit`, `👍`, and `👎`, each finished exchange can now be reused in multiple ways:

- **Copy** a strong answer,
- **Branch** an assistant response into a new direction,
- **Edit** a user message to retry from an earlier point,
- **Like** a response style you want repeated,
- **Dislike** a response style you want avoided later.

That makes LLeM feel much closer to modern consumer chat tools while staying inside VS Code and staying local-first.

#### Persistent response memory still carries across everything

Preference memory continues to apply across:

- normal follow-up turns,
- new chats,
- chat branches,
- and edited-message branches.

So if you teach LLeM what kind of answers you like, that preference signal survives even when you fork or revise the conversation path.

#### File click behavior is stricter and smarter

Clickable file references in chat are now more accurate:

- only editable file types can be opened from chat,
- basename-only references like `extension.ts` can resolve to a real workspace file when the match is unambiguous,
- and chat attachments preserve enough metadata to reopen the right source more reliably.

#### Markdown rendering is more reliable inside chat

The webview renderer now handles leftover inline Markdown markers more gracefully in normal prose.

- inline bold and emphasis markers render more reliably in mixed-language text,
- bullet items such as `- **“로컬 환경에 뿌리내린(Local-first) 지능형 에이전트”**` now display with the intended emphasis,
- and the fallback logic avoids touching fenced code blocks while cleaning up visible chat output.

#### Technical highlights

- added editable earlier-message branching from the webview action bar,
- preserved reusable attachment payloads in display history for edit/retry flows,
- added branch generation from the point before a selected user message,
- improved workspace filename resolution for clickable chat file references,
- added a safe inline-Markdown fallback for webview chat rendering,
- kept reply-style preference memory persistent across branch variants.

#### Why `v3.1.1` matters

The big shift here is that LLeM is no longer just good at answering or branching. It is now better at **revising**. That means less copy-paste, less losing context, and much smoother iteration when you're tightening prompts or trying alternate implementation directions.

### v3.1.0 — Gemini-Style Reply Actions, Branching, and Preference Memory

**v3.1.0** is the first release that makes each completed reply feel more like a modern chat product, while still keeping the whole workflow local-first.

#### New reply actions after every completed assistant turn

Once an assistant reply finishes streaming, LLeM now shows a compact action row directly under that message.

- **Copy**: Copies just that specific assistant response to your clipboard.
- **Branch**: Creates a brand-new chat branch from that response so you can explore a different direction without losing the original thread.
- **👍 Like**: Marks that answer style as something the user wants more of.
- **👎 Dislike**: Marks that answer style as something the user wants less of.

This interaction model is intentionally inspired by the post-reply controls you see in Gemini Web, but adapted to LLeM's local VS Code workflow.

#### Chat branching

Branching is now a first-class concept inside the chat experience.

- You can branch from any completed assistant response.
- The new branch becomes its own saved chat session.
- The original conversation remains untouched in history.
- The branch inherits the visible conversation context up to the selected reply, making it easy to explore alternate plans, implementations, or follow-up prompts.

This is especially useful when you want to:

- compare two implementation strategies,
- keep one thread focused on debugging while another explores a refactor,
- or preserve a "good state" before taking the conversation in a different direction.

#### Persistent response-preference memory

Likes and dislikes are not cosmetic. They now update a persistent memory layer that survives:

- new chats,
- branched chats,
- and extension restarts.

When you give feedback on a reply, LLeM stores a compact memory of that preference and uses it to steer future responses. In practice, that means:

- replies you like help reinforce the kind of tone, structure, and answer shape you want,
- replies you dislike tell the assistant to avoid similar response patterns later unless you explicitly ask for them.

This preference memory is injected into the system context for future requests, so LLeM can adapt over time instead of acting like every conversation starts from zero.

#### Better alignment between UI behavior and file opening rules

This release also tightens the file interaction model inside chat:

- only editable file types are shown as clickable in message content,
- only editable attachments can be opened from chat,
- and dropped file attachments preserve enough metadata to open the correct source more reliably.

That keeps chat interactions cleaner and avoids misleading "clickable" affordances on files that are not actually editable in the intended way.

#### What changed technically

Under the hood, this release adds several important building blocks:

- a shared editable-file classifier used by both the webview and extension host,
- per-message feedback state in persisted chat history,
- a new response preference manager backed by extension global state,
- message-level UI actions for copy, branching, and feedback,
- and branch session generation from the currently visible conversation timeline.

#### Why this matters

LLeM has always focused on local execution, real file edits, and practical repo-aware assistance. With **v3.1.0**, the chat UX becomes much more iterative:

- you can fork thought paths without losing your place,
- quickly reuse or share strong replies,
- and gradually teach the assistant how you want it to respond.

Still local. Still yours. Just much more adaptable.

### v3.0.5 — The "First Flight" Public Drop ✈️

Sup world! 🌍 **v3.0.5** is officially out in the wild and it's our **first public release**. 🚀

- **Branding on Point**: We ditched the boring stuff for a fresh icon and a UI that actually looks good.
- **Gemma Optimization**: We tweaked the engine to hunt down Ollama's or LM Studio's default model automatically.
- **Chat History 2.0**: Full persistence layer implemented. Your conversations now survive VS Code restarts.
- **Workspace Sync**: Instant UI updates when you rename, delete, or add files to your project.
- **Security Audit**: Completed a deep-dive security pass on the Bridge Server, adding rate limiting and token-based auth.
- **Better Vibes**: Smoother logging and descriptive errors so you're never left guessing.
- **Public Launch**: This is it. The first time we're letting this thing out of the hangar for everyone to use.

**Local-first, offline-always. Let's cook.** 🛫💻

## Release Notes

### v3.3.31

- Bumped the VSIX build from `3.3.30` to `3.3.31`.
- Improved offline vision-model detection using local Ollama manifests. Fixed capability checks to use the active engine endpoint and added vision decision logging.
- Packaged `release/llem-3.3.31.vsix`.

### v3.3.30

- Bumped the VSIX build from `3.3.29` to `3.3.30`.
- Implemented Intelligent Repetition Guard with tiered backoff (3s, 10s, 30s), non-blocking queue scheduling, and automated retry orchestration with UI cooldown feedback.
- Packaged `release/llem-3.3.30.vsix`.

### v3.3.29

- Bumped the VSIX build from `3.3.28` to `3.3.29`.
- Implemented File System Access Transparency with user-approved out-of-workspace operations and high-fidelity UI feedback.
- Packaged `release/llem-3.3.29.vsix`.

### v3.3.28

- Bumped the VSIX build from `3.3.27` to `3.3.28`.
- Action transparency and loop prevention improvements
- Packaged `release/llem-3.3.28.vsix`.

### v3.3.27

- Bumped the VSIX build from `3.3.26` to `3.3.27`.
- Added live stream metadata (duration, chunks, chars) to action progress UI
- Packaged `release/llem-3.3.27.vsix`.

### v3.3.24

- Bumped the VSIX build from `3.3.23` to `3.3.24`.
- Implemented AI self-correction loop and Codex-style action progress visualization
- Packaged `release/llem-3.3.24.vsix`.

### v3.3.22

- Bumped the VSIX build from `3.3.21` to `3.3.22`.
- **B-1 fix**: Repeated/watchdog-aborted responses are no longer pushed to the chat history. Previously, the aborted assistant message would linger in history and seed the next turn with a contaminated context, causing cascading repetition loops. Now the pipeline returns immediately without writing the bad response to history.
- **B-2 fix**: Consecutive `assistant → assistant` or `user → user` message pushes during agentic action loops are now de-duplicated. If a `continuation` user message arrives when the last history entry is already a `user` entry, the content is merged rather than creating a second entry.
- **B-3 fix**: Images are no longer forwarded to text-only models (gemma, llama, mistral, etc.). The model name is inspected for known vision indicators (`llava`, `vision`, `:vl`, `bakllava`, `moondream`, etc.) and a clear in-chat notice is shown when an image is skipped.
- **B-4 fix**: `RequestRetryGuard` fingerprints now use a normalized, punctuation-stripped 300-character prompt core instead of the raw prompt string. Rephrased retries of the same request are blocked even when the exact wording changes.
- **FileStateGuard**: New `src/fileStateGuard.ts` computes SHA-256 hashes before and after every `edit_file` action. A `no-effect` warning is surfaced when the file is unchanged (typically a `<find>` mismatch). After 3 consecutive no-effect edits on the same file, `loop-detected` is returned and further edits on that path are blocked via `ActionLoopGuard`.
- Packaged `release/llem-3.3.22.vsix`.

### v3.3.21

- Bumped the VSIX build from `3.3.20` to `3.3.21`.
- Live stream output now shows raw AI text without any HTML/Markdown parsing during generation — `<edit_file>`, `<find>`, `<replace>` action tags are visible as-is while streaming.
- Final reply (after stream completes) continues to render as full Markdown with code highlighting, file badges, and action summaries.
- Removed `sanitizeAssistantDisplayText()` call from the live `renderStreamNow()` path so the raw model output is never silently stripped mid-stream.
- Packaged `release/llem-3.3.21.vsix`.

### v3.3.20

- Bumped the VSIX build from `3.3.19` to `3.3.20`.
- Hardened assistant output sanitization to prevent leaked action tags and scratchpad text in streamed replies
- Packaged `release/llem-3.3.20.vsix`.

### v3.3.19

- Bumped the VSIX build from `3.3.18` to `3.3.19`.
- Fixed RepetitionWatchdog false positives that could truncate edit-file streams during repeated action-tag/code sequences. Added regression coverage for repeated closing-tag action streams.
- Packaged `release/llem-3.3.19.vsix`.

### v3.3.18

- Bumped the VSIX build from `3.3.17` to `3.3.18`.
- Repackaged the current workspace state through the formal VSIX release flow.
- Packaged `release/llem-3.3.18.vsix`.

### v3.3.17

- Bumped the VSIX build from `3.3.16` to `3.3.17`.
- Fixed RepetitionWatchdog false positives on markdown structure tokens so tables, fences, headers, list markers, blockquotes, and task markers no longer abort valid replies
- added regression tests for markdown-safe watchdog behavior
- Packaged `release/llem-3.3.17.vsix`.

### v3.3.16

- Bumped the VSIX build from `3.3.16` to `3.3.16`.
- Added structured repetition abort handling, retry and action loop guards, safer file mutation validation, restored clickable editable files, and added default-browser opening for chat URL links
- Packaged `release/llem-3.3.16.vsix`.

### v3.3.16

- Bumped the extension version from `3.3.15` to `3.3.16`.
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

### v3.3.15

- Bumped the VSIX build from `3.3.14` to `3.3.15`.
- Fixed Korean IME Enter handling to prevent duplicate trailing messages
- added regression tests for composition-safe prompt submission
- Packaged `release/llem-3.3.15.vsix`.

### v3.3.14

- Bumped the VSIX build from `3.3.14` to `3.3.14`.
- Added queued request pause/resume and reordering
- Added direct editing for queued items
- Expanded queue tests and stabilized package test suite
- Packaged `release/llem-3.3.14.vsix`.

### v3.3.12

- Bumped the VSIX build from `3.3.11` to `3.3.12`.
- Fix stop button UI and edit banner visibility
- Packaged `release/llem-3.3.12.vsix`.

### v3.3.11

- Bumped the VSIX build from `3.3.10` to `3.3.11`.
- Fix main-view layout causing input to overflow
- Packaged `release/llem-3.3.11.vsix`.

### v3.3.10

- Bumped the VSIX build from `3.3.9` to `3.3.10`.
- Fix terminal executing logged messages
- Packaged `release/llem-3.3.10.vsix`.

### v3.3.9

- Bumped the VSIX build from `3.3.8` to `3.3.9`.
- Fix immediate deletion of history items in UI
- Packaged `release/llem-3.3.9.vsix`.

### v3.3.8

- Bumped the VSIX build from `3.3.7` to `3.3.8`.
- Fix edit banner visibility on initial chat load
- Packaged `release/llem-3.3.8.vsix`.

### v3.3.7

- Bumped the VSIX build from `3.3.7` to `3.3.7`.
- Fix edit banner visibility on initial chat load
- Packaged `release/llem-3.3.7.vsix`.

### v3.3.7

- Bumped the VSIX build from `3.3.6` to `3.3.7`.
- Fix terminal rendering, layout stability, and improve hardware summary quality
- Packaged `release/llem-3.3.7.vsix`.

### v3.3.6

- Bumped the VSIX build from `3.3.5` to `3.3.6`.
- Implemented sequence-aware RepetitionWatchdog and improved action parsing to prevent infinite loops.
- Packaged `release/llem-3.3.6.vsix`.

### v3.2.9

- Bumped the VSIX build from `3.2.8` to `3.2.9`.
- Fixed model output streaming issues with buffering and enhanced token extraction for reasoning fields.
- Packaged `release/llem-3.2.9.vsix`.

### v3.2.7

- Bumped the VSIX build from `3.2.6` to `3.2.7`.
- Fixed AI response truncation, improved action tag stripping with smart quote support, and tuned model performance profiles for 26B models.
- Packaged `release/llem-3.2.7.vsix`.

### v3.2.5

- Bumped the VSIX build from `3.2.4` to `3.2.5`.
- Enabled unlimited response length by setting predict token limits to -1. Added handling for unlimited output in both Ollama and LM Studio engines.
- Packaged `release/llem-3.2.5.vsix`.

### v3.2.3

- Bumped the VSIX build from `3.2.2` to `3.2.3`.
- Increased token prediction limits to 4096+ to prevent response truncation. Fixed LM Studio max_tokens mapping.
- Packaged `release/llem-3.2.3.vsix`.

### v3.2.1

- Bumped the VSIX build from `3.2.0` to `3.2.1`.
- Implemented repetition penalty for large models to prevent hallucination loops, fixed model selection persistence in settings.json, and added overwrite protection for user settings.
- Packaged `release/llem-3.2.1.vsix`.

### v3.1.9

- Bumped the VSIX build from `3.1.8` to `3.1.9`.
- Revert to standard settings.json persistence and fix model selection overwrite issue
- Packaged `release/llem-3.1.9.vsix`.

### v3.1.8

- Bumped the VSIX build from `3.1.7` to `3.1.8`.
- Added Codex-style message actions for user and assistant replies
- restored copy and edit flows for existing user messages
- added edit-in-new-branch composer state
- Packaged `release/llem-3.1.8.vsix`.

### v3.1.7

- Bumped the VSIX build from `3.1.6` to `3.1.7`.
- Made the model dropdown persist the real active default model and pass runtime engine/model metadata into each request
- Removed the earlier-message editing banner and edit entrypoint from the chat UI so message composer stays in normal send mode
- Packaged `release/llem-3.1.7.vsix`.

### v3.1.6

- Bumped the VSIX build from `3.1.5` to `3.1.6`.
- Added file-based diagnostics for stream debugging with per-request raw chunk capture and parsed token traces
- Logged final assistant text cleanup so empty replies can be traced from transport through final rendering
- Packaged `release/llem-3.1.6.vsix`.

### v3.1.5

- Bumped the VSIX build from `3.1.4` to `3.1.5`.
- Improved stream parsing for object-shaped output chunks
- Fixed empty reply state when the model returned text in newer OpenAI-compatible stream formats
- Packaged `release/llem-3.1.5.vsix`.

### v3.1.4

- Bumped the VSIX build from `3.1.3` to `3.1.4`.
- Fixed recurring empty replies by broadening stream parsing for additional LM Studio and Ollama response shapes
- Added raw stream preview logging when parsed output ends up empty so future payload mismatches are diagnosable instantly
- Packaged `release/llem-3.1.4.vsix`.

### v3.1.3

- Bumped the VSIX build from `3.1.2` to `3.1.3`.
- Added model-aware performance presets for 26B-class local Ollama runs
- Added prompt budgeting and richer diagnostics for large local Gemma-family models
- Expanded the README with detailed performance profile guidance, 26B tuning notes, and diagnostics tips
- Packaged `release/llem-3.1.3.vsix`.

### v3.1.2

- Bumped the VSIX build from `3.1.1` to `3.1.2`.
- Fixed empty-reply turns by hardening stream parsing for Ollama and LM Studio
- Flushed trailing stream buffers so the final token is not lost when a stream ends without a newline
- Saved assistant replies consistently into chat history so follow-up turns keep the right conversation context
- Updated the chat UI to distinguish truly empty replies from successful completed output
- Packaged `release/llem-3.1.2.vsix`.
