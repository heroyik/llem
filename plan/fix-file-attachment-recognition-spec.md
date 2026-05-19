# Fix File Attachment Recognition — Spec

## Problem Summary

Files attached via **drag & drop** or **@ mentions** in the LLeM chat are not properly recognized:

| Path | Issue | Root Cause |
|------|-------|------------|
| **Drag & drop** (Finder/VS Code sidebar) | Files appear in attachment preview but AI ignores content | **Two separate problems**: (1) Drop requires Shift key (obscure, users don't know), (2) Rapid-MLX image format mismatch (`input_image` vs OpenAI `image_url`) |
| **@ mentions** | File content is never read or attached — only `@path` text is inserted into the prompt | No code path exists to read the file and create a `FileAttachment` |
| **Clipboard paste** (working reference) | ✅ Works correctly — reads image data, creates `FileAttachment`, calls `appendAttachmentRecords()` | Correct pattern to follow |

The user confirmed:
- **Engine**: Rapid-MLX (with `--mllm` flag for vision)
- **Source**: Drops from both Finder and VS Code sidebar
- **Symptom**: "Attached but AI ignores it" — files appear in preview but model doesn't see them

---

## Architecture & Data Flow

### Current Data Flow

```
User Action          Webview                       Extension Host            AI Engine
─────────────────────────────────────────────────────────────────────────────────────
Clipboard paste  →  paste event handler           (no extension needed)  →  image sent
                     reads clipboard items              ↕                      ↕
                     FileReader → base64             already works         FORMAT ?
                     appendAttachmentRecords()

Drag & drop      →  drop event handler             fetchUris (for URIs)   →  file sent
                     (REQUIRES Shift key!)           ↓                        ↕
                     appendPendingFiles()           injectAttachment        FORMAT ?
                     OR fetchUris (for URIs)         (for URIs)

@ mention         →  acceptInputSuggest()           (no attachment)       →  "@path" as text
                     inserts "@path" text only                              AI gets no content
```

### Desired Data Flow

```
User Action          Webview                       Extension Host            AI Engine
─────────────────────────────────────────────────────────────────────────────────────
Clipboard paste  →  (no change — already works)

Drag & drop      →  drop event handler             fetchUris (for URIs)   →  file sent
                     (NO Shift key required!)        ↓                        ↕
                     appendPendingFiles()           injectAttachment        FORMAT FIXED
                     OR fetchUris (URIs)             (for URIs)

@ mention         →  acceptInputSuggest()           fetchFileContent       →  file attached
                     sends fetchFileContent msg      ↓
                     (file path)                   injectAttachment
                                                    (read file, base64)
```

---

## Requirements

### 1. Remove Shift Key Requirement for Drag & Drop

**Files**: `src/webview/main.ts`

**Change**: Modify `canAcceptDropEvent()` (line 1729-1731) to drop the Shift key check.

```typescript
// Current (line 1729-1731):
function canAcceptDropEvent(event: DragEvent): boolean {
    return Boolean(event && event.shiftKey && hasFilePayload(event));
}

// New:
function canAcceptDropEvent(event: DragEvent): boolean {
    return Boolean(event && hasFilePayload(event));
}
```

**Visual**: Keep the drop overlay (`.drop-overlay` / `inputBox.drag-over`) as-is.

**Why this is safe**:
- `hasFilePayload()` checks for actual file data in the dataTransfer (`files`, `text/uri-list`, `text/plain`, VS Code drag types).
- Text selection/dragging in the textarea does NOT set these types (except `text/plain` — see critical note below).
- The `dragCounter` mechanism prevents overlay from flashing on partial drags.
- Standard UX: most file upload UIs (GitHub, Slack, Gmail) don't require modifier keys.

**⚠️ CRITICAL: Must also remove `text/plain` from `hasFilePayload()`**

The current `hasFilePayload()` function (line 1791-1803) includes `types.includes('text/plain')`:

```typescript
function hasFilePayload(event: DragEvent): boolean {
    const transfer = event.dataTransfer;
    if (!transfer) return false;
    const types = getLowerTransferTypes(transfer);
    const items = Array.from(transfer.items || []);
    // Include 'text/plain' to catch some VS Code file/tree drag actions.
    return types.includes('files') ||
           types.includes('text/uri-list') ||
           types.includes('text/plain') ||              // ← THIS LINE
           types.some(isVsCodeDragType) ||
           items.some(function(item) { return item.kind === 'file'; });
}
```

**Problem**: When the Shift check is removed, text selection drags (which set `text/plain` in dataTransfer) will trigger the drop overlay. The comment says `text/plain` was added "to catch some VS Code file/tree drag actions," but `isVsCodeDragType()` already catches all `application/vnd.code.*` drag types from VS Code. So `text/plain` is **redundant** for VS Code drags and **harmful** for text selection drags.

**Fix**: Remove `types.includes('text/plain')` from `hasFilePayload()`.

**Edge cases considered**:
| Case | Behavior | Verification |
|------|----------|-------------|
| Drag-select text in textarea | Won't trigger — only `text/plain` is set, which is now removed from check | ✅ |
| Drag file from VS Code file explorer | Accepted — `isVsCodeDragType()` catches `application/vnd.code.*` drag event types | ✅ Verified: VS Code sets `application/vnd.code.tree.*` types |
| Drag file from Finder | Accepted — `types.includes('files')` catches it | ✅ |
| Drag file browser link | Accepted — `types.includes('text/uri-list')` catches URIs | ✅ |
| Drop from Finder | Accepted — files read via `appendPendingFiles()` | ✅ |
| Drop from VS Code sidebar tree | Accepted — URIs collected via `collectDroppedUris()`, sent via `fetchUris` | ✅ |
| Drag file across window toward panel | Overlay shows briefly — same as any drag & drop UI | ✅

---

### 2. @ Mention Reads & Attaches File Content

**Files**: `src/webview/main.ts`, `src/webviewMessageRouter.ts`, `src/sidebarChatProvider.ts`

#### User Experience
1. User types `@` in the input field → suggestion dropdown shows workspace files
2. User selects a file (via click or keyboard Enter) → `@path/to/file.ts` text is inserted into the input
3. **Immediately after**: A `fetchFileContent` message is sent to the extension to read the file
4. Extension reads the file (first ~512KB), converts to base64, sends `injectAttachment` back to webview
5. Webview calls `appendAttachmentRecords()` → file chip appears in the attachment preview area
6. When user sends the message, both the `@text` stays in the prompt AND the file is attached as a real `FileAttachment`

**Trigger**: Only when file is selected from the `@` suggestion dropdown (not when `@` is typed manually).

#### Code Change: `acceptInputSuggest()` in webview/main.ts

After the text insertion and cleanup (`hideInputSuggest()`, `input.focus()`), add:

```typescript
// At the end of acceptInputSuggest(), before "return true;":
if (suggestTrigger?.kind === 'mention') {
    const filePath = suggestItems[Math.max(0, Math.min(index, suggestItems.length - 1))].detail;
    vscode.postMessage({
        type: 'fetchFileContent',
        requestId: 'mention-' + Date.now(),
        path: filePath
    });
}
```

Note: `suggestTrigger` is a local variable in the try block, so it's accessible. `item.detail` contains the full file path (e.g., `src/file.ts`).

#### New Webview → Extension Message Type

```typescript
// webview sends to extension:
vscode.postMessage({
    type: 'fetchFileContent',
    requestId: string,
    path: string          // workspace-relative or absolute path
});
```

#### Extension Host: Interface & Routing

In `src/webviewMessageRouter.ts`, add to `WebviewMessageRouterHost`:
```typescript
fetchFileContent(path: string, requestId?: string): Promise<void>;
```

Add route case:
```typescript
case 'fetchFileContent':
    await host.fetchFileContent(message.path, message.requestId);
    break;
```

#### Extension Side: `_fetchFileContent()` in sidebarChatProvider.ts

New method on `SidebarChatProvider`:

```typescript
private async _fetchFileContent(path: string, requestId?: string): Promise<void> {
    if (!this._view) return;
    logInfo(`[FETCH] fetchFileContent start requestId=${requestId || 'none'} path=${path}`);

    // 1. Resolve path
    let uri: vscode.Uri;
    if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) {
        // Absolute path
        uri = vscode.Uri.file(path);
    } else {
        // Workspace-relative path (from @ suggestions)
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceRoot) return;
        uri = vscode.Uri.joinPath(workspaceRoot, path);
    }

    const name = basenameFromUri(uri);
    const type = attachmentTypeFromName(name);

    try {
        // 2. Check file exists and is not a directory
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.Directory) return;

        // 3. Size check (same limits as drag & drop)
        const limit = type.startsWith('image/') ? MAX_DROPPED_IMAGE_BYTES : MAX_DROPPED_TEXT_BYTES;
        const isTruncated = stat.size > limit;

        // 4. Read file (truncated if necessary)
        const readSize = isTruncated ? limit : stat.size;
        const readResult = await vscode.workspace.fs.readFile(uri);
        const data = Buffer.from(readResult).toString('base64');

        logInfo(`[FETCH] fetchFileContent read requestId=${requestId || 'none'} name=${name} type=${type} bytes=${readResult.length} encodedChars=${data.length} truncated=${isTruncated}`);

        // 5. Send attachment back to webview
        this._view.webview.postMessage({
            type: 'injectAttachment',
            value: {
                name,
                type,
                data,
                sourceUri: uri.toString(true),
                requestId,
                originalSize: stat.size,
                truncated: isTruncated
            }
        });
    } catch (err) {
        logError(`[FETCH] fetchFileContent failed requestId=${requestId || 'none'} name=${name} path=${path}: ${summarizeDropError(err)}`);
        // Silently skip — don't show error to user for @ mentions
    }
}
```

#### Timing & Async Considerations

| Issue | Analysis |
|-------|----------|
| User sends message before file data arrives | The `injectAttachment` message arrives async. If user types fast and hits Enter before the file data arrives, the file won't be in `pendingFiles` at send time. **Acceptable risk**: same as drag & drop for VS Code sidebar drops (which also go through `fetchUris`). User learns to wait for the chip to appear. |
| Multiple @ mentions | Each `@` sends a separate `fetchFileContent`. `appendAttachmentRecords()` deduplicates via `attachmentFingerprint()`. Each file arrives as a separate `injectAttachment`. The preview updates each time. |
| Ordering | Files appear in the order they arrive, not the order they were selected. Acceptable. |

#### @ Mention & Image Files

If the user @-mentions an image file (e.g., `@screenshot.png`), the extension detects the `.png` extension and sets `type: 'image/png'`. The `injectAttachment` handler adds it to `pendingFiles`. When the message is sent, the pipeline handles it correctly (including the Rapid-MLX format fix from Requirement 3).

**Do NOT silently skip image files.** They are valid attachments. Only truly binary/non-text non-image files are silently skipped (e.g., `.zip`, `.exe`, `.o`, `.dylib`), and even those would just be rejected by the model — the attachment chip still shows but the content is empty. For @ mentions, we don't need explicit binary detection since the extension just reads bytes and sends them; the AI pipeline handles truncation/formatting.

---

### 3. Fix Image Format for Rapid-MLX (input_image → image_url)

**Files**: `src/imageRequestPayload.ts`

**Problem**: Line 42-48 currently uses the Ollama-style format for ALL non-LM Studio engines:

```typescript
if (endpoint.engineKind === 'ollama' || !endpoint.isLMStudio) {
    messages[targetIndex] = {
        ...lastUserMsg,
        content: text,
        images: imageFiles.map(img => img.data)  // ← input_image field
    } as any;
    return;
}
```

This means **Rapid-MLX also gets the Ollama `images` format**. But Rapid-MLX's `vllm_mlx` runtime expects the **OpenAI-compatible `image_url` format**:
```json
{ "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
```

**Fix**: Split into three distinct branches:

```typescript
if (endpoint.engineKind === 'ollama') {
    // 1. Ollama native format: uses `images` array field
    messages[targetIndex] = {
        ...lastUserMsg,
        content: text,
        images: imageFiles.map(img => img.data)
    } as any;
    return;
}

if (endpoint.engineKind === 'rapid-mlx') {
    // 2. Rapid-MLX: uses OpenAI-compatible image_url format
    const imageParts = imageFiles.map(img => ({
        type: 'image_url',
        image_url: { url: `data:${img.type || 'image/png'};base64,${img.data}` }
    }));
    messages[targetIndex] = {
        role: 'user',
        content: [
            { type: 'text', text },
            ...imageParts
        ]
    };
    return;
}

if (!endpoint.isLMStudio) {
    // 3. Other non-LM Studio engines (generic OpenAI-compatible)
    const imageParts = imageFiles.map(img => ({
        type: 'image_url',
        image_url: { url: `data:${img.type || 'image/png'};base64,${img.data}` }
    }));
    messages[targetIndex] = {
        role: 'user',
        content: [
            { type: 'text', text },
            ...imageParts
        ]
    };
    return;
}

// 4. LM Studio: same OpenAI-compatible format
const imageParts = imageFiles.map(img => ({
    type: 'image_url',
    image_url: { url: dataUrlForImage(img) }
}));
messages[targetIndex] = {
    role: 'user',
    content: [
        { type: 'text', text },
        ...imageParts
    ]
};
```

**Note**: The existing `dataUrlForImage()` helper (line 3-5 in `imageRequestPayload.ts`) already constructs the exact same URL:
```typescript
function dataUrlForImage(image: AttachedFile): string {
    return `data:${image.type || 'image/png'};base64,${image.data}`;
}
```
Therefore branches 2, 3, and 4 can all **use `dataUrlForImage()`** for consistency:
```typescript
const imageParts = imageFiles.map(img => ({
    type: 'image_url',
    image_url: { url: dataUrlForImage(img) }
}));
```

---

### 4. Expand Supported Drop File Extensions

**Files**: `src/webview/main.ts` (line 279-284), `src/sidebarChatProvider.ts` (line 135-140)

Both files define the same extensions in slightly different formats (with/without leading dot). Update both.

**Current** (both files):
```
txt, md, csv, json, js, ts, html, css, py, java, rs, go, yaml, yml, xml, toml
```

**Proposed expanded set**:

```typescript
// src/webview/main.ts (with dots):
const ATTACHABLE_EXTENSIONS = new Set([
    '.txt', '.md', '.csv', '.json',
    '.js', '.ts', '.html', '.css',
    '.py', '.java', '.rs', '.go',
    '.yaml', '.yml', '.xml', '.toml',
    // Code:
    '.c', '.cpp', '.h', '.hpp', '.cxx', '.cc', '.hh',
    '.rb', '.php', '.sh', '.bash', '.zsh', '.fish',
    '.swift', '.kt', '.kts',
    '.svelte', '.vue',
    '.jsx', '.tsx', '.mjs', '.cjs',
    '.scss', '.less', '.styl',
    '.sql', '.proto',
    // Build/config:
    '.gradle', '.cmake', '.makefile',
    '.dockerfile',
    '.env', '.gitignore', '.editorconfig', '.prettierrc', '.eslintrc',
    // Shell:
    '.ps1', '.bat', '.cmd'
]);
```

```typescript
// src/sidebarChatProvider.ts (without dots):
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
    'txt', 'md', 'csv', 'json',
    'js', 'ts', 'html', 'css',
    'py', 'java', 'rs', 'go',
    'yaml', 'yml', 'xml', 'toml',
    // Code:
    'c', 'cpp', 'h', 'hpp', 'cxx', 'cc', 'hh',
    'rb', 'php', 'sh', 'bash', 'zsh', 'fish',
    'swift', 'kt', 'kts',
    'svelte', 'vue',
    'jsx', 'tsx', 'mjs', 'cjs',
    'scss', 'less', 'styl',
    'sql', 'proto',
    // Build/config:
    'gradle', 'cmake', 'makefile',
    'dockerfile',
    'env', 'gitignore', 'editorconfig', 'prettierrc', 'eslintrc',
    // Shell:
    'ps1', 'bat', 'cmd'
]);
```

---

## Files to Modify

| File | Line(s) | Change |
|------|---------|--------|
| `src/webview/main.ts` | 1729-1731 | Remove `event.shiftKey` from `canAcceptDropEvent()` |
| `src/webview/main.ts` | 279-284 | Expand `ATTACHABLE_EXTENSIONS` Set |
| `src/webview/main.ts` | ~477 (end of `acceptInputSuggest()`) | Add `fetchFileContent` postMessage after @ mention insertion |
| `src/webviewMessageRouter.ts` | interface + switch | Add `fetchFileContent` method and route case |
| `src/sidebarChatProvider.ts` | 135-140 | Expand `TEXT_ATTACHMENT_EXTENSIONS` Set |
| `src/sidebarChatProvider.ts` | ~551 (host object) | Add `fetchFileContent` to the webview message router host |
| `src/sidebarChatProvider.ts` | ~1160 (after `_fetchUris`) | Add `_fetchFileContent()` method |
| `src/imageRequestPayload.ts` | 42-48 | Split `ollama || !isLMStudio` into separate branches for ollama vs rapid-mlx |

---

## Edge Cases & Design Decisions

| Edge Case | Decision | Rationale |
|-----------|----------|-----------|
| **User sends message before @ file data arrives** | File won't be attached. Same risk as VS Code sidebar drag. User learns to wait for chip. | The `injectAttachment` message is async; no way to synchronously block send. |
| **Same file @-mentioned twice** | Deduplicated by `appendAttachmentRecords()` fingerprinting. | No special handling needed. |
| **User @-mentions a directory** | Extension's `vscode.workspace.fs.stat` detects directory → silently skip. | No error shown to user. |
| **@-mentioned file is too large** | Extension reads only up to the limit (512KB for text, 8MB for images). Truncated flag set. | Same behavior as drag & drop. |
| **@-mentioned file is a binary (`.zip`, `.exe`)** | Still read and sent as base64. The model pipeline will handle (or ignore) it. | No need for explicit binary detection — the pipeline already has truncation. |
| **VS Code sidebar drop — file too large** | Extension already has size check in `_fetchUris()` with user notification. | No change needed. |
| **VS Code sidebar drop — directory** | Extension already skips directories in `_fetchUris()`. | No change needed. |
| **Multiple drag & drop files at once** | `appendPendingFiles()` iterates sequentially, each calls `buildAttachment()`. | Works as-is. |
| **Drop with files AND URIs** | Both `droppedFiles` and `droppedUris` are handled in the drop handler. | Works as-is. |
| **textarea text selection drag** | `hasFilePayload()` returns false for text drags after `text/plain` is removed. No interference. | **Requirement 1 includes `text/plain` removal from `hasFilePayload()`** — see critical note above. |
| **@ mention bypasses `isSupportedAttachment()`** | `injectAttachment` goes directly to `appendAttachmentRecords()` without going through `buildAttachment()` → no extension check. Any file selected via @ mention is attached regardless of extension. | **Intentional.** The user explicitly selected the file from the suggestion dropdown — they know what they're doing. The AI pipeline handles truncation/formatting on send. |
| **No loading indicator for @ mention** | After selecting a file from the @ dropdown, there's a delay while the extension reads and base64-encodes the file before `injectAttachment` arrives. No loading spinner is shown during this delay. | Acceptable trade-off. Same behavior as VS Code sidebar drag (`fetchUris`). Future improvement: add a brief loading indicator. |
| **ClearChat / New Chat while @ mention is in-flight** | `clearChat` resets `pendingFiles = []` and re-renders. If an `injectAttachment` arrives after `clearChat`, the file would be added to the new (empty) chat's pending files. | Low risk. The new chat will have an unexpected file attached. Mitigation: the `requestId` on the message could be checked, but not implemented for simplicity. Acceptable given the async timing is <100ms. |
| **@ mention of a file that doesn't exist on disk** | `vscode.workspace.fs.stat` throws → caught by try/catch → silently skipped. No error shown. | Silent skip is appropriate for @ mentions (unlike drag & drop where a notification is shown). The `@path` text remains in the input. |
| **`attachmentFingerprint` dedup uses `getAttachmentSize`** | `attachmentFingerprint()` uses `getAttachmentSize(file)` which checks `file.size || file.originalSize || 0`. The `_fetchFileContent` sends `originalSize` in the injectAttachment value, so O(1) dedup works. | No action needed — the `originalSize` field in the message value is read by `getAttachmentSize()`. |
| **Rapid-MLX engine detection** | `detectEngineKind()` in `aiClient.ts` detects rapid-mlx when base URL has port 8000 or contains 'rapid-mlx' in the URL. The `attachImagesToChatMessages()` function in `imageRequestPayload.ts` already has access to `endpoint.engineKind`. | The conditional in the fix can directly check `endpoint.engineKind === 'rapid-mlx'`. No risk of false positives. |
| **Rapid-MLX without `--mllm`** | Server reports `model_type: "llm"` — images bypassed by server. This is a separate issue (user should use `--mllm`). Note: a future improvement could check `/health` endpoint. | Out of scope for this plan. User confirmed they use `--mllm`. |

---

## Validation

1. **Build**: `npm run compile:webview` and `npm run typecheck` must pass
2. **Drag & drop without Shift**: Drop a `.ts` file from Finder into LLeM chat — file chip should appear in preview, no Shift key needed
3. **@ mention file attachment**: Type `@`, select a file from suggestions — both `@path` text remains in input AND file chip appears in preview
4. **@ mention image**: Type `@`, select a `.png` image — image chip should appear in preview thumbnail view
5. **Rapid-MLX image format**: Paste an image via clipboard, verify the API request body uses `{ type: "image_url", image_url: { url: "data:..." } }` for Rapid-MLX engine
6. **Expanded extensions**: Drop `.c`, `.cpp`, `.sh` files — should be accepted instead of showing "not a supported attachment"
7. **VS Code sidebar drag**: Drag a file from VS Code file explorer tree into LLeM — file should attach (no Shift needed)
8. **Multiple @ mentions**: Select two different files via `@` — both chips should appear in preview
