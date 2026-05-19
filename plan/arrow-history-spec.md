# Arrow Up/Down Message History Navigation — Spec

## Overview

Implement keyboard navigation of the user's sent message history in the chat input field using Arrow Up and Arrow Down keys (similar to a terminal command history or browser URL bar).

## Behavior

### Trigger

- **Arrow Up** while focus is on the `<textarea id="input">` and the **suggestion popup is NOT visible**: navigate **backward** (older) through the history of user-sent messages.
- **Arrow Down** while focus is on the `<textarea id="input">` and the **suggestion popup is NOT visible**: navigate **forward** (newer) through the history.
- When the suggestion popup (`#inputSuggest`) **IS** visible, ArrowUp/ArrowDown continue to **only** navigate suggestions (existing behavior). No message history navigation occurs.

### What is tracked

- Only **actually sent** user messages are tracked in the history stack.
- "Sent" means the user pressed Enter (or clicked Send) and the message was submitted.
- Messages that were **edited** (edit mode) count as their **original sent text**, not the revised text. Only the original submission is tracked.
- The history stack is scoped to the **current session only**. It is **not** persisted across sessions.

### History stack behavior

- The history is an in-memory array in the webview JavaScript (`main.ts`).
- When the user sends a message, the message text is pushed onto this array.
- **Navigation state**:
  - `historyIndex = -1` means the input shows a **fresh/current draft** (not navigating history).
  - Pressing **Arrow Up** from index -1:
    1. **Save** the current input text (even if empty) into a temporary `draftBuffer` variable.
    2. Set `historyIndex` to `history.length - 1` (last sent message).
    3. Load `history[historyIndex]` into the input.
  - Pressing **Arrow Up** again: decrement `historyIndex`, load previous message.
  - Pressing **Arrow Down** while `historyIndex` is at the **last entry** (newest): increment `historyIndex`, eventually reaching a state where `historyIndex >= history.length`, which means **restore the draft buffer**.
  - Pressing **Arrow Down** while in draft restore mode: clear input (if draft buffer is empty, show empty input).
- The `draftBuffer` preserves whatever the user had typed before starting history navigation.

### Cursor position

- When loading a historical message into the input, move the **cursor to the end** of the text.
- `input.selectionStart = input.selectionEnd = input.value.length`.

### Counter indicator

- Show a small counter indicator in the input footer area when navigating history.
- Format: `(<currentIndex+1>/<total>)` — e.g., `(2/5)` when viewing the 2nd of 5 messages.
- The counter element should:
  - Be hidden when `historyIndex === -1` (not navigating).
  - Be shown when `historyIndex >= 0 && historyIndex < history.length`.
  - Update reactively as the user presses ArrowUp/ArrowDown.
- **Position:** Inside `.input-btns`, before the first button (attachBtn). The narrow `3/5` format fits easily alongside buttons.
- **Element creation:** Created **dynamically in JS** (`main.ts`) and appended to `.input-btns` via `insertBefore`. No changes to `webviewHtml.ts`.
- **Hint visibility conflict:** The `.input-hint` element shows `"Enter sends · Shift+Enter adds a line · / commands · @ files"`. Since the counter occupies very little space, the hint can remain visible. No need to hide it.

### Empty state (no user messages yet)

- If the history array is empty (fresh chat, no messages sent yet), ArrowUp/ArrowDown do nothing special — the default textarea cursor movement is allowed.

### IME handling

- ArrowUp/ArrowDown history navigation is **blocked** while IME composition is active (same pattern as the existing Enter-submission logic that checks `inputCompositionActive`).

### Interaction with textarea height

- After loading a message into the input, recalculate textarea height: `input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 150) + 'px'`

### Modified draft behavior

- If the user presses ArrowUp to load a historical message, then **modifies the text**, then presses ArrowDown — the modifications are **discarded** and the original `draftBuffer` is restored.
- This matches the `historyIndex`-based navigation model: the input always reflects the exact historical message text until the user exits history mode (reaches the draft buffer or sends a message).

### Edge cases

- **Rapid repeated presses**: handled naturally — each press just adjusts the index.
- **New message sent while navigating history**: the history array already includes the newly sent message. Reset `historyIndex = -1` after sending, input clears normally (existing behavior).
- **Empty history + draftBuffer**: ArrowUp from -1 when history is empty: do nothing.
- **Loading very long messages**: same as entering a long message by typing — scrollHeight adjustment will handle it.

## Implementation Plan

### Files to modify

1. **`src/webview/main.ts`** — the only file that needs changes:
   - Add variables:
     - `let userMessageHistory: string[] = [];`
     - `let historyIndex = -1;`
     - `let draftBuffer = '';`
   - In the `send()` function: **at the beginning of `send()`, before clearing `input.value`**: push `text` to `userMessageHistory` and reset `historyIndex = -1`.
  - The push must happen before `input.value = ''` (line ~2367 in main.ts) since the input is cleared right after.
  - **Edit-mode sends** (when `editingMessageIndex >= 0`, the code path at line ~2320) are **excluded** from history — only original sent messages are recorded.
  - In the **existing `keydown` handler** (`safeListen(input, 'keydown', ...)` around line 2497): **no new event listener is needed.** The new ArrowUp/ArrowDown logic sits inside the existing handler, after the suggestion-popup check block and before the Enter-submission check:
    - After the `if (inputSuggest && !inputSuggest.hidden && suggestItems.length > 0)` block ends (which already handles ArrowUp/Down for suggestions).
    - Before the `if (!shouldSubmitOnEnter(...)) return;` Enter check.
    - If ArrowUp and not IME composing → handle history back.
    - If ArrowDown and not IME composing → handle history forward.
    - Implement the `draftBuffer` save/restore logic.
    - After loading a message, move cursor to end, adjust height.
    - **Note:** The suggestion popup check already returns early for ArrowUp/ArrowDown, so the history code naturally only runs when the popup is hidden — no extra guard needed.
   - Add counter indicator element to the DOM (create it near the send button area in the input footer).
   - Create CSS rules for `.history-counter` in `src/webview/styles.css` (minimal: small text, subtle styling).

### Visual design (counter)

- The counter should be a small, subtle label like `(2/5)` styled similar to the existing `.queue-meta` / `.input-hint` text:
  - Font size: 10px
  - Color: `var(--text-faint)`
  - No background, no border — just plain text.
  - Font family: `'SF Mono', 'JetBrains Mono', 'Menlo', monospace` for tabular alignment.
  - Added as a child of `.input-btns`, inserted before the first button (attachBtn).
  - Hidden by default (`display: none`).

## Out of Scope

- Persisting history navigation state across sessions.
- Navigating AI assistant messages (only user messages).
- Loading messages from other saved chat sessions.
- Any keyboard shortcut customization.
- Regenerating/re-queuing a historical message (the user can press Enter to re-send the loaded text).

## Build Artifacts

- `assets/webview.js` is the compiled/bundled output. If `main.ts` is compiled via a build step, `assets/webview.js` must be regenerated after changes. Check the project's build pipeline (`package.json` scripts) before assuming source files are used directly.
