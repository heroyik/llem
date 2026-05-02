# Implementation Plan - Resolving AI Response Truncation and UI Tag Leakage

The goal is to ensure the AI can generate long-form responses without premature truncation and to clean up the UI by correctly removing action tags (like `<read_file/>`) from the final message.

## Proposed Changes

### [Core] [aiClient.ts](file:///Users/nick/proj/llem/src/aiClient.ts)
- Modify `buildStreamBody` to set `max_tokens: 32768` for LM Studio when unlimited generation (`predictTokens: -1`) is requested, instead of omitting the parameter. This prevents falling back to low internal defaults.

### [Config] [performanceProfiles.ts](file:///Users/nick/proj/llem/src/performanceProfiles.ts)
- Remove `"User:"` and `"Assistant:"` from the `stop` tokens list. These common words cause truncation if they appear in code explanations.
- Increase `repeatPenalty` from `1.1` to `1.15` to improve stability during long generations and prevent "The enough to enough to" repetition issues.

### [Pipeline] [chatPipeline.ts](file:///Users/nick/proj/llem/src/chatPipeline.ts)
- Rewrite `stripActionTags` to use robust regular expressions that handle:
    - Self-closing tags (e.g., `<read_file path="..."/>`).
    - Standard tag pairs (e.g., `<read_file>...</read_file>`).
    - Both `<tag>` and `<call:tag>` formats.
    - All tool types including `read_brain`, `read_url`, etc.

### [Version] [package.json](file:///Users/nick/proj/llem/package.json)
- Bump version to `3.2.6`.

## Verification Plan

### Automated Tests
- None (manual verification required due to dependency on local AI engines).

### Manual Verification
1. Run the extension in development mode.
2. Ask a question that requires reading multiple files (e.g., "Analyze the project structure").
3. Verify that:
    - The full response is generated without cutting off mid-sentence.
    - No raw `<read_file.../>` tags are visible in the chat bubble after the action completes.
    - The "Action Report" summary is still visible.
4. Test with both Ollama and LM Studio if available.
