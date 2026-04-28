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
3. Click on the latest release tag (e.g., `v3.0.5`).
4. Under the **Assets** section, click on the `.vsix` file (e.g., `llem-3.0.5.vsix`) to download it to your machine.

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
