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

---

## 📥 Installation

Since **LLeM** is currently in early flight, we distribute it via `.vsix` files. Follow these steps to get airborne:

### 1. Download the Extension
1. Go to the [LLeM GitHub Repository](https://github.com/heroyik/llem).
2. Look at the **Releases** section on the right sidebar.
3. Click on the latest release tag (e.g., `v3.1.1`).
4. Under the **Assets** section, click on the `.vsix` file (e.g., `llem-3.1.1.vsix`) to download it to your machine.

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
| `llem.requestTimeout` | Request timeout in seconds. | `300` |
| `llem.vaultPath` | Path to your markdown vault. | `~/.llem-vault` |
| `llem.bridgeEnabled` | Enable the local HTTP bridge on port 4825. | `false` |
| `llem.bridgeToken` | Security token for authenticated bridge callers. | `(empty)` |
| `llem.maxHistoryItems` | Maximum number of sessions to keep in history. | `100` |

> [!TIP]
> If you're using a slower model or long prompts, try bumping up the `llem.requestTimeout`.

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

### v3.1.2

- Bumped the VSIX build from `3.1.1` to `3.1.2`.
- Fixed empty-reply turns by hardening stream parsing for Ollama and LM Studio
- Flushed trailing stream buffers so the final token is not lost when a stream ends without a newline
- Saved assistant replies consistently into chat history so follow-up turns keep the right conversation context
- Updated the chat UI to distinguish truly empty replies from successful completed output
- Packaged `release/llem-3.1.2.vsix`.
