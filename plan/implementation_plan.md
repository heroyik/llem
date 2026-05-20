# Implementation Plan: Monolithic Module Decomposition

## Overview

This document details the refactoring of Codebuff's two largest source files — `src/webview/main.ts` (webview frontend) and `src/sidebarChatProvider.ts` (VS Code extension backend) — into ~45 focused, single-responsibility modules.

### Goals

- **Maintainability**: Reduce cognitive load by grouping related code into focused modules
- **Testability**: Enable unit testing of pure functions and state management
- **Readability**: Make the codebase easier to navigate for new contributors
- **Reusability**: Extract reusable utilities (drop handling, formatting, queue state)

### Key Pattern: Factory + Deps Interface

All extractions from `sidebarChatProvider.ts` follow a consistent pattern:

```
Module → createXxxManager(deps: XxxManagerDeps): XxxManager
```

- **Deps interface**: Describes what the module needs from the parent class (typed callbacks)
- **Factory function**: Returns an object implementing the module's public API
- **Parent class**: Creates a `deps` object (binding `this.xxx`) and delegates to the factory

This avoids inheritance, keeps the module testable via mock deps, and preserves the class's lifecycle management.

---

## Phase 1: `src/webview/main.ts` Decomposition

**Before**: `main.ts` — ~3,200 lines, monolithic DOM manipulation, event handling, rendering, state, and streaming logic.

**After**: `main.ts` — 437 lines (module loader + coordinator)

### Extracted Modules (32 files in `src/webview/`)

| Module | Lines | Responsibility |
|---|---|---|
| `types.ts` | — | Shared TypeScript type definitions |
| `state-store.ts` | 52 | Generic `createStateStore<T>()` reactive state pattern (read/write/subscribe) |
| `dom-elements.ts` | 133 | 61 cached DOM element references (`$chatMessages`, `$textInput`, etc.) |
| `event-registrations.ts` | 439 | All event listeners (keyboard, mouse, drag/drop, resize, mutation observer) |
| `event-delegates.ts` | — | Event delegation helpers (click, change, input) |
| `format.ts` | — | Text formatting utilities |
| `strings.ts` | — | String manipulation helpers |
| `history.ts` | — | Message history navigation (arrow keys) |
| `drag-drop.ts` | — | Drag-and-drop file handling |
| `drag-handlers.ts` | — | Drag event handlers (dragenter, dragover, dragleave, drop) |
| `file-attachment.ts` | 412 | File attachment UI and logic (inline display, drag-drop, paste) |
| `file-refs.ts` | — | File reference display in chat |
| `clipboard.ts` | — | Clipboard operations (copy, paste) |
| `highlight.ts` | — | Syntax highlighting |
| `markdown-renderer.ts` | — | Markdown-to-HTML rendering |
| `message-renderer.ts` | 364 | Chat message DOM rendering (user, assistant, system messages) |
| `message-handler.ts` | 347 | Webview message handling (receive from extension, update UI) |
| `stream-handler.ts` | — | Streaming response display (token-by-token rendering) |
| `stream-actions.ts` | — | Stream action buttons (copy, retry, etc.) |
| `image-lightbox.ts` | — | Image lightbox viewer |
| `error-overlay.ts` | 19 | Error overlay UI |
| `slider-setup.ts` | 37 | Settings slider setup |
| `render-file-changes.ts` | 52 | File change summary rendering |
| `animations.ts` | — | CSS animations and transitions |
| `input-suggest.ts` | — | Input autocomplete suggestions |
| `queue-helpers.ts` | — | Webview-side queue display helpers |
| `queue-manager.ts` | — | Webview-side queue state display (distinct from `src/queue-manager.ts`) |
| `settings.ts` | — | Settings UI panel rendering |
| `terminal.ts` | — | Terminal output display |
| `drop-utils.ts` | 108 | Attachment/drop utility functions (extracted from sidebarChatProvider.ts) |
| `mcp-slash-utils.ts` | 55 | MCP slash command helpers (extracted from sidebarChatProvider.ts) |
| `format-utils.ts` | 18 | Formatting helpers (extracted from sidebarChatProvider.ts) |

### Key Design Decisions

- **Reactive State Store**: `createStateStore()` generic factory for reactive state management with subscribe pattern — used for `workspaceFiles`, `currentBranch` and other reactive state
- **Event Registration Isolation**: All `addEventListener` calls moved to `event-registrations.ts` with a single `registerAllEvents()` entry point
- **DOM Query Caching**: All `querySelector`/`getElementById` calls extracted to `dom-elements.ts` with typed accessors

---

## Phase 2: `src/sidebarChatProvider.ts` Decomposition

**Before**: `sidebarChatProvider.ts` — ~2,100 lines, monolithic class with queue management, webview routing, settings, and utility functions.

**After**: `sidebarChatProvider.ts` — 1,373 lines (core class logic only)

### Extracted Modules (6 modules)

#### 2.1 `src/webview/drop-utils.ts` — 108 lines

**Pure functions extracted**:
- `cleanDroppedUriString()` — Normalize dropped URI strings
- `parseDroppedUri()` — Parse dropped URI into components
- `droppedUriKey()` — Generate lookup key for dropped URI
- `basenameFromUri()` — Extract file basename from URI path
- `extensionFromName()` — Extract file extension
- `attachmentTypeFromName()` — Classify attachment type (image/audio/text)
- `isSupportedDroppedAttachment()` — Check if attachment type is supported
- `droppedAttachmentLimit()` — Get max count for attachment type
- `summarizeDropError()` — Human-readable drop error messages
- `isSafeAttachmentLookupName()` — Validate attachment lookup name safety

**Constants**: `MAX_DROPPED_IMAGE_BYTES`, `MAX_DROPPED_TEXT_BYTES`, `IMAGE_ATTACHMENT_EXTENSIONS`, `AUDIO_ATTACHMENT_EXTENSIONS`, `TEXT_ATTACHMENT_EXTENSIONS`

#### 2.2 `src/webview/mcp-slash-utils.ts` — 55 lines

**MCP slash command helpers**:
- `extractMcpTextParts()` — Parse MCP slash command text
- `renderMcpSlashResultMessage()` — Render MCP result as message text
- `collectMcpSlashResultMessages()` — Collect all MCP result messages

#### 2.3 `src/webview/format-utils.ts` — 18 lines

**Formatting utilities**:
- `formatApproxKb()` — Format byte count as approximate KB
- `formatMs()` — Format milliseconds as human-readable time
- `countRole()` — Count role occurrences in chat messages

#### 2.4 `src/webview-router-host.ts` — 114 lines

**Webview message router host factory**:
- `RouterHostDeps` interface — 45 typed methods matching `SidebarChatProvider` private methods
- `createWebviewMessageRouterHost(deps)` — Creates `WebviewMessageRouterHost` object
  - Routes all webview messages to appropriate deps callbacks
  - `showBrainNetwork()` implemented directly (calls `vscode.commands`)
  - `log()` implemented directly (calls `logError`/`logInfo`)
  - `restoreDisplayMessages()` is compound: calls both `deps.restoreDisplayMessages()` and `deps.sendExecutionMode()`

#### 2.5 `src/settings-command-host.ts` — 63 lines

**Settings command host factory**:
- `SettingsCommandHostDeps` interface — Settings getters/setters
- `createSettingsCommandHost(deps)` — Creates `SettingsCommandsHost` object
  - Handles `globalState.update()` persistence in the factory layer
  - `resetConversationForSystemPromptChange()` kept in parent as compound operation
  - Covers: `systemPrompt`, `rapidMlxTextSampling`, `temperature`, `topK`, `topP`, `maxTokens`

#### 2.6 `src/queue-manager.ts` — 417 lines

**Queue state management factory** (the largest extraction):
- `QueueManagerDeps` interface — Callbacks for chat pipeline, retry auth, webview sync
- `createQueueManager(deps)` — Creates `QueueManager` object with:
  - **Internal state**: `queueState` (array), `abortController`, `activeRequestPromise`, `isProcessingQueue`, `queueCheckTimer`
  - **Public API** (10 methods):
    - `createQueuedRequest()` — Build a new queued request from prompt/files/options
    - `enqueueRequest()` — Enqueue and trigger processing
    - `cancelQueuedRequest()` — Cancel by ID with auth retry awareness
    - `clearQueuedRequests()` — Clear all pending requests
    - `moveQueuedRequest()` — Reorder queue (drag-to-reorder support)
    - `editQueuedRequest()` — Edit a pending request
    - `resumeQueue()` — Resume processing after auth retry
    - `reset()` — Full state reset (abort active, clear queue, reset webview)
    - `stopGeneration()` — Abort active generation
    - `setAbortController()` — Set the abort controller for the current request
  - **Internal functions**:
    - `summarizeQueuedRequest()` — Summarize request for display
    - `buildQueueStatePayload()` — Build webview state payload
    - `syncToWebview()` — Sync queue state to webview
    - `runNextRequestIfIdle()` — Process queue if idle
    - `executeQueuedRequest()` — Execute a single request with retry & auth handling
    - `handleExecutionResult()` — Process execution result (success/skip/auth/error)

---

## Phase 3: `src/chatPipeline.ts` Decomposition

**Before**: `chatPipeline.ts` — ~1,220 lines, monolithic class with streaming, attachment processing, vision checks, and utility functions.

**After**: `chatPipeline.ts` — 642 lines (core pipeline orchestration only)

### Extracted Modules (4 modules in `src/`)

#### 3.1 `src/pipeline-utils.ts` — 121 lines

**Pure functions extracted**:
- `normalizeImageData()` — Normalize base64 image data with optional `data:` prefix stripping
- `decodeBase64TextPrefix()` — Decode prefix of base64 string as UTF-8
- `sliceBase64Prefix()` / `sliceBase64Suffix()` — Slice base64 strings to byte-aligned boundaries
- `estimateBase64Bytes()` — Estimate decoded byte count from base64 string length
- `formatBytes()` — Format byte count as human-readable string (B/KB/MB)
- `cleanHtmlText()` — Strip HTML tags, scripts, and styles from text
- `extractChunkHint()` — Extract `<read_file>` target from fetched content for chunked reading
- `isAbortError()` — Detect various abort/cancel error patterns
- `formatPromptWithFileError()` / `formatPromptError()` — User-facing error messages with engine-specific guidance

**Pattern**: Pure exports, no factory needed (zero dependencies on class context)

#### 3.2 `src/pipeline-attachments.ts` — 132 lines

**Attachment processing utilities**:
- `MAX_IMAGE_ATTACHMENT_BYTES` / `MAX_TEXT_ATTACHMENT_CHARS` / `MAX_TEXT_ATTACHMENT_DECODE_BYTES` — Attachment size constants
- `PreparedAttachments` interface — Typed result shape for attachment processing
- `prepareAttachments()` — Process attached files (classify, decode, budget allocation, truncation notices)
  - Iterates files, classifies image vs text, normalizes/skips oversized images
  - Decodes text files, applies attachment budget limits, generates file context string
  - Collects display files, notices, and pruning stats
- `compactFilesForReuse()` — Compact attached files for followup turns (re-encode oversized text)
- `attachImagesToRequest()` — Delegate to `imageRequestPayload.attachImagesToChatMessages()`

**Pattern**: Pure exports (imports `pipeline-utils.ts` and `promptBudgeting.ts`)

#### 3.3 `src/pipeline-vision.ts` — 85 lines

**Vision support detection**:
- `modelSupportsVision(modelName, endpoint, installedModel?)` — Async function returning `{ supportsVision: boolean, reason: string }`
  - **Name heuristic**: Matches Gemma 3/4, e4b/26b, multimodal, llava, moondream, qwen-vl, etc.
  - **Capability check**: Installed model metadata `capabilities.includes('vision')`
  - **Family check**: Installed model family name heuristic (multimodal, any-to-any, etc.)
  - **API fallback**: For non-LMStudio backends, calls `/api/show` via `getModelCapabilities()`

**Pattern**: Standalone async export function (no factory needed)

#### 3.4 `src/pipeline-stream.ts` — 240 lines

**Stream manager factory** (the largest pipeline extraction):
- `StreamManagerDeps` interface — Callbacks for webview messages, sampling settings (temperature, topK, topP, rapid-mlx sampling)
- `StreamManager` interface — `streamMessages()` and `postStreamErrorDetail()`
- `createStreamManager(deps)` — Factory returning `StreamManager` object with:
  - **Internal functions**:
    - `buildLivePreview()` — Condense action tags (create_file/edit_file) into emoji summaries for live preview
    - `createCombinedSignal()` — Merge two AbortSignals into one (for watchdog + parent abort)
    - `streamMessages()` — Core streaming logic:
      - Normalizes messages via `normalizeChatMessages()`
      - Selects rapid-mlx safe sampling profile (image vs text)
      - Runs repetition watchdog with 50ms flush interval
      - Auto-closes unclosed action tags on loop/abort
      - Returns `StreamOutcome` with stop reason, repetition metadata
    - `postStreamErrorDetail()` — Extract error detail from response stream, post as webview error

**Pattern**: `createStreamManager(deps: StreamManagerDeps): StreamManager` — same factory+deps pattern as `queue-manager.ts`

### Changes to `chatPipeline.ts`

After extraction, `chatPipeline.ts` retains:
- `ChatPipelineHost` interface (11 typed method signatures)
- `PromptExecutionResult` interface
- `ChatPipeline` class (642 lines) with:
  - Constructor: creates `_streamManager` via factory (binds `this.host` methods as deps)
  - `handlePromptWithFile()` / `handlePrompt()` — Public entry points (unchanged interface)
  - `runPrompt()` — Core orchestration (model selection, endpoint resolution, message building, attachment insertion, vision check, rapid-mlx MLLM token budgeting, image attach, multi-turn execution with action loop detection/dedup, error handling)
  - `resolveInternalActions()` — Brain/vault/URL/file reads in action loop
  - `postActionReport()` / `formatActionReport()` — Action report formatting
  - `selectedModel()` / `saveHistoryInBackground()` / `trimHistory()` / `stripActionTags()` — Small remaining helpers

**Removed (5 private methods)**: `streamMessages`, `createCombinedSignal`, `buildLivePreview`, `postStreamErrorDetail`, `modelSupportsVision`
**Removed (9 module-level functions)**: `decodeBase64TextPrefix`, `sliceBase64Prefix`, `estimateBase64Bytes`, `formatBytes`, `cleanHtmlText`, `extractChunkHint`, `isAbortError`, `formatPromptWithFileError`, `formatPromptError`
**Removed dead code**: `appendAgentReport()` private method (no callers after extraction)

---

## Phase 4: `src/actionExecutor.ts` Decomposition

**Before**: `actionExecutor.ts` — ~580 lines, monolithic module-level `executeActions()` function with inline `ActionLoopGuard`/`FileStateGuard` management.

**After**: `actionExecutor.ts` — 6 lines (re-export shim), replaced by `action-executor.ts` factory module.

### Extracted Module

#### 4.1 `src/action-executor.ts` — 584 lines

**Factory module** following the same `createXxx(deps)` pattern:
- `ActionExecutorDeps` interface — Callbacks for chat message operations, MCP tools, execution mode
- `type ActionExecutionHost = ActionExecutorDeps` — Backward-compat alias for `actionReport.ts`
- `ActionExecutor` interface — `{ executeActions(aiMessage: string): Promise<string[]> }`
- `createActionExecutor(deps)` — Factory returning `ActionExecutor` object

**Closure-encapsulated state**:
- `actionLoopGuard` — Tracks repeated action patterns to prevent infinite loops
- `fileStateGuard` — Tracks file hash snapshots to detect no-effect edits and edit loops

**Module-level helpers (9 functions, no closure needed)**:
| Function | Role |
|---|---|
| `buildActionTraceId()` | Generate unique trace ID for action execution logging |
| `summarizeAiMessageForActions()` | Summarize AI message for structured logging |
| `buildFileChangesReport()` | Build `@@LLEM_FILE_CHANGES` report from file change summaries |
| `resolveActionPath()` | Resolve file path relative to workspace root |
| `applyFileActionResult()` | Merge file action result into handler context |
| `resolveMcpToolTarget()` | Resolve MCP tool + server from tool name |
| `approveCommand()` | Show VS Code modal to approve terminal commands |
| `approveFileAction()` | Show VS Code modal to approve file operations outside workspace |

**HANDLERS array (10 action handlers)**:
| Index | Handler | Closure vars used |
|---|---|---|
| 0 | Create file actions | `actionLoopGuard` |
| 1 | Edit file actions | `actionLoopGuard`, `fileStateGuard` |
| 2 | Delete file actions | — |
| 3 | Read file actions | — |
| 4 | List files actions | — |
| 5 | Terminal command actions | — |
| 6 | URL read actions | — |
| 7 | List MCP tools | — |
| 8 | Call MCP tool | — |
| 9 | MCP slash commands | — |

**Internal `executeActions()` function**:
1. Build trace ID, resolve root path (VS Code workspace or active editor)
2. Parse all action types from AI message, log structured execution start
3. Create `ActionHandlerContext` (extends `ActionReportContext`)
4. Run each handler in order through the HANDLERS array
5. Handle fallback file blocks (action tag–less `<file>` blocks auto-detected as creates)
6. Build and append file changes report
7. Call `finalizeActionReport()` for UI notification, auto-sync, cache invalidation
8. Log structured execution end, return report strings

### Changes to `sidebarChatProvider.ts`

- **Import**: `import { createActionExecutor, type ActionExecutor } from './action-executor'`
- **New field**: `private _actionExecutor: ActionExecutor` (beside `_queueManager`)
- **Constructor**: Calls `this._actionExecutor = createActionExecutor(deps)` after binding deps
- **`_executeActions()`**: Changed from `executeActions(aiMessage, hostObj)` to `this._actionExecutor.executeActions(aiMessage)`

### Changes to `actionReport.ts`

- **Import path**: `import type { ActionExecutionHost } from './action-executor'` (instead of `'./actionExecutor'`)

### Changes to `actionExecutor.ts` (the old file)

- Replaced entire ~580-line implementation with a single re-export line:
  ```ts
  export { createActionExecutor, type ActionExecutorDeps, type ActionExecutionHost, type ActionExecutor } from './action-executor';
  ```

### Unused Imports Removed

- `getConfig`, `getVaultDir` — Not used in action-executor.ts (getVaultDir used only via finalizeActionReport)
- `PathValidationStatus`, `safeResolveActionPath` — Not used in the extracted code

---

## Phase 5: Supporting Changes

### README.md Updates

- **What's New (v3.7.0)**: Comprehensive entry describing all extractions, the reactive state store pattern, and the Tab key bug fix
- **Release Notes**: Consolidated three duplicate `### v3.7.0` entries into one

### VSIX Packaging

- Built as `release/llem-3.7.0.vsix` (~2.2 MB)
- `--no-bump` used to stay at v3.7.0 (single release for all refactoring)

### Cleanup

- Removed `_stopGeneration()` dead code (was a thin wrapper after delegation to `_queueManager`)
- Deleted 19 obsolete `plan/` implementation specification files (~168 KB)
- Fixed: missing import (`RapidMlxTextSamplingSettings`), variable name shadowing (`modelSupportsVision` → `visionSupported`)

---

## Statistics

| Metric | Before | After | Delta |
|---|---|---|---|
| `src/webview/main.ts` | ~3,200 lines | 437 lines | **−86%** |
| `src/sidebarChatProvider.ts` | ~2,100 lines | 1,373 lines | **−35%** |
| `src/chatPipeline.ts` | ~1,220 lines | 642 lines | **−47%** |
| `src/actionExecutor.ts` | ~580 lines | 6 lines (shim) | **−99%** |
| Total modules in `src/webview/` | 1 (main.ts) | 33 (main.ts + 32 extracted) | **+32** |
| New modules in `src/` | — | 8 (action-executor, router, settings, queue, pipeline-stream, pipeline-utils, pipeline-attachments, pipeline-vision) | **+8** |
| Total extracted modules | — | ~45 modules | **−** |
| TypeScript errors | 0 | 0 | **✓** |
| Tests passing | 134 | 134 | **✓** |
| VSIX size | ~2.3 MB | ~2.2 MB | **−** |

## Version History

| Commit | Message |
|---|---|
| `c242d38` | `feat: decompose monolithic sidebarChatProvider and main.ts into focused modules` |
| *(uncommitted)* | `feat: refactor chatPipeline.ts → pipeline-stream, pipeline-utils, pipeline-attachments, pipeline-vision` |
| *(uncommitted)* | `feat: refactor actionExecutor.ts → action-executor.ts with createActionExecutor factory` |

---

## Architecture Diagram

```
sidebarChatProvider.ts (1,373 lines, coordinator)
├── _actionExecutor ─→ action-executor.ts (file/terminal/web/MCP action execution, loop guard)
├── _queueManager ───→ queue-manager.ts (queue state, retry, webview sync)
├── _settingsHost ───→ settings-command-host.ts (settings UI persistence)
├── _routerHost ─────→ webview-router-host.ts (webview message routing)
└── (inline helpers) ─→ drop-utils.ts, mcp-slash-utils.ts, format-utils.ts

chatPipeline.ts (642 lines, coordinator)
├── _streamManager ──→ pipeline-stream.ts (streaming, watchdog, flush, error detail)
├── (utilities)      → pipeline-utils.ts (format, clean, abort detect, 12 pure funcs)
├── (attachments)    → pipeline-attachments.ts (prepare, compact, attach images)
└── (vision)         → pipeline-vision.ts (model vision support detection)

webview/main.ts (437 lines, coordinator)
├── createStateStore()  → state-store.ts (reactive state)
├── registerAllEvents() → event-registrations.ts (DOM events)
├── event-delegates.ts  → event-delegates.ts (delegation helpers)
├── (DOM caching)       → dom-elements.ts (61 cached elements)
├── (message handling)  → message-handler.ts, message-renderer.ts
├── (file attachment)   → file-attachment.ts, drag-drop.ts, drag-handlers.ts
├── (streaming)         → stream-handler.ts, stream-actions.ts
├── (queue display)     → queue-helpers.ts, queue-manager.ts
├── (rendering)         → render-file-changes.ts, markdown-renderer.ts, highlight.ts
├── (UI utilities)      → error-overlay.ts, slider-setup.ts, image-lightbox.ts, settings.ts
├── (input utilities)   → input-suggest.ts, history.ts, clipboard.ts
├── (formatting)        → format.ts, strings.ts
├── (animations)        → animations.ts
├── (file references)   → file-refs.ts
└── (terminal)          → terminal.ts
```

---

## Future Opportunities

- `brainGitSync.ts` — Self-contained enough to stay, but could benefit from the factory pattern
- Unit tests for extracted modules (especially `drop-utils.ts`, `queue-manager.ts`, `pipeline-utils.ts`, `pipeline-stream.ts`)
- `chatPipeline.ts` — Further simplification possible: extract `resolveInternalActions()` into its own module with `readBrainFile`, `readUrl`, `readFile` handlers
