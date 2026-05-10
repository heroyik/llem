# Fix Regenerate Reply Behavior

## Summary

`Regenerate reply` reruns the last user request, but the old assistant message used to remain visible until the new response appeared. The fix makes regenerate behave like a replacement: remove the last assistant response from the webview immediately, keep the existing session-side removal, then stream the new response in the same conversation flow.

## Implementation Plan

- Add an explicit AI message marker in the webview by applying `msg-ai` to normal assistant messages and streaming assistant messages.
- When the regenerate button is clicked, remove the button, remove the last `.msg-ai` element from the chat DOM, and pop the last `displayMessages` item when it is an AI message.
- Keep the extension host regenerate path based on `_lastPrompt`, `_lastModel`, `_lastFiles`, and `_lastInternetEnabled`.
- Keep `ChatSession.removeLastAssistantResponse()` in the queued regenerate execution path so persisted session state matches the UI.
- If regenerate is requested without a stored previous prompt, show a visible LLeM warning response instead of silently returning.
- Keep queue and retry guard behavior unchanged.

## Acceptance Criteria

- Clicking `Regenerate reply` after an assistant response immediately removes that response from the chat UI.
- The regenerated response streams as the replacement answer and gets a fresh `Regenerate reply` button when complete.
- Regenerate keeps the previous model, attachments, and internet setting.
- Calling regenerate without a previous prompt stops the loader and shows a user-visible warning.
- Session state does not retain the removed assistant response.

## Test Plan

- `npm run typecheck`
- `npm run build:test`
- `node --test tests/*.test.mjs`
- `npm run compile`
- Manual check: normal prompt, prompt with attachments, internet-enabled prompt, and no-previous-prompt fallback.

## Assumptions

- This change supports only the last assistant response.
- Regenerating an older middle response remains out of scope.
- Queue semantics stay unchanged.
