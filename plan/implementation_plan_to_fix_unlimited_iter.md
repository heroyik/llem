# LLeM Infinite Iteration Fix Plan

## Goal

Fix the class of issues where LLeM keeps repeating coding work after design-guideline-driven requests, especially in Next.js/TypeScript flows, and ensure file creation or editing never leaves partially broken content when a run is interrupted.

This plan covers:

- repeated implementation loops after referencing a design guideline markdown file,
- continued looping even after `[LLeM: 무한 반복이 감지되어 생성을 중단했습니다.]`,
- repeated generation of the same Next.js/TypeScript patterns,
- oversized single-file output instead of small file decomposition,
- partial or corrupted file content when generation stops mid-run.

## Current Problem Summary

### 1. Text-level repetition can be detected, but control flow still continues

The current system already detects some loop patterns in streaming output, but loop detection is not consistently promoted into a hard pipeline state. As a result, a response can still be treated like a normal completion after a repetition warning appears.

### 2. Repetition is not only textual

The current defenses are stronger against repeated text than repeated actions. The model may:

- recreate the same file,
- issue nearly identical edits repeatedly,
- regenerate the same layout structure across turns,
- continue follow-up turns that re-open the same implementation path.

### 3. Large design-guideline requests encourage over-generation

When a markdown design guide is attached or referenced, the model tends to overfit to the whole document at once and generate too much code in one pass. This increases:

- repeated code patterns,
- bloated `page.tsx`-style outputs,
- interrupted or malformed file content when a loop is cut off.

### 4. File safety needs stronger end-to-end guarantees

Even though atomic write support already exists, we should make the full create/edit flow transactional so an interrupted generation never leaves a half-broken file.

## Design Principles

1. Loop detection must become a hard execution state, not just a visible warning.
2. Requests referencing design guideline documents should enter a plan-first flow.
3. Next.js/TypeScript work should be decomposed into small files by default.
4. File mutations must be all-or-nothing per file.
5. Repeated actions must be blocked even when the repeated text is slightly different.
6. Interrupted or incomplete action blocks must never touch disk.

## High-Level Strategy

### A. Promote repetition detection into structured pipeline state

Instead of embedding a repetition warning as plain text inside the model output, return a structured stream outcome that tells the caller whether the generation:

- completed normally,
- was aborted by repetition detection,
- was aborted by watchdog logic,
- was manually stopped,
- or ended with an error.

This lets the pipeline stop follow-up turns immediately and prevents post-warning continuation.

### B. Add request-level and action-level loop guards

We need two additional protections:

- request retry guard: prevents the same request from re-running immediately after loop abort,
- action loop guard: prevents the same create/edit pattern from being executed repeatedly.

### C. Force planning before implementation for design-guideline-driven work

If the user asks LLeM to implement code based on a design guideline markdown document, the first model step should produce:

- a short design summary,
- a file split plan,
- an ordered implementation sequence.

Only after that should code generation begin.

### D. Make file writes transactional and completion-safe

A file create or edit should only reach disk after:

- the action block is complete,
- the generated content is structurally valid enough,
- the full file mutation has been prepared,
- the system is sure the operation will finish.

## Required Behavioral Changes

### 1. After repetition is detected, the request must not continue

When `[LLeM: 무한 반복이 감지되어 생성을 중단했습니다.]` would previously appear, the new behavior should be:

- stop the current stream,
- mark the request outcome as repetition-aborted,
- skip all internal-action follow-up work,
- skip all external-action follow-up work,
- skip continuation turns,
- finalize the request once,
- avoid treating the result as a normal successful completion.

### 2. Repetition warnings must be emitted once

The user should not see multiple overlapping stop notices from different layers. The stop decision should be made in one layer and rendered once.

### 3. Same or near-same requests should not auto-repeat

If a request was recently stopped for repetition, the system should recognize the same request fingerprint and block or downgrade immediate retries.

### 4. Same file actions should not repeat

Repeated actions on the same target should be recognized, especially:

- same `create_file` path with same or near-same body,
- same `edit_file` path with same find/replace pairs,
- repeated attempts to generate the same Next.js section/component files.

### 5. Single-file overload should be discouraged

When implementing UI from a design guideline, the system should prefer:

- page shell in one file,
- sections in separate component files,
- types in separate files where sensible,
- style helpers or constants extracted when useful.

Avoid putting the entire design implementation into one file unless the task is genuinely tiny.

## File Safety Plan

### Objective

If the system starts creating or editing a file, it must either finish that file safely or leave the previous file contents intact.

### Safeguards

#### 1. File-level transaction behavior

For each file mutation:

- build the full intended final content in memory,
- validate the mutation block,
- write once using atomic replace,
- never stream partial file content into the file itself.

#### 2. Incomplete action blocks must never execute

Do not execute:

- unclosed `<create_file>` blocks,
- unclosed `<edit_file>` blocks,
- malformed `<find>/<replace>` pairs,
- trailing cut-off action fragments caused by interruption.

If the action is incomplete, discard it and stop safely.

#### 3. File mutation lock per path

Only one active mutation per file path should be allowed at a time. If repetition or follow-up logic tries to mutate the same file again before the prior file mutation is safely resolved, the second mutation should be blocked.

#### 4. Repetition abort must not leave partial writes

If repetition is detected during generation:

- pending incomplete file actions are discarded,
- already prepared but not committed mutations are dropped,
- disk only ever contains the last known complete version.

#### 5. Lightweight completeness checks

Before committing newly generated file content, add cheap sanity checks where appropriate:

- non-empty content,
- balanced action structure,
- basic TS/TSX/JSX structural heuristics,
- suspicious truncation detection for unexpectedly tiny replacements,
- optional file-type-sensitive checks if they remain lightweight.

The goal is not perfect parsing. The goal is to catch obvious breakage before disk write.

## Next.js / TypeScript Specific Plan

### Desired generation behavior

For design-guideline-based frontend work:

- do not generate the entire feature inside one `page.tsx`,
- prefer 1 to 2 new files per implementation turn,
- split large visual sections into separate components,
- keep types, constants, and helpers out of large view files when they grow,
- avoid repeating identical Tailwind or JSX structures across multiple files.

### Prompting rules to add

The system prompt or continuation instructions should guide the model to:

- plan first for design-guide-driven requests,
- decompose UI work into small files,
- avoid repeating previously generated structures,
- read existing files before editing,
- extend instead of recreating when an existing file already covers the area.

## Proposed Implementation Units

Keep changes small and decomposed. Prefer adding focused helper files instead of building all logic into one existing file.

### New files

#### `src/streamOutcome.ts`

Purpose:

- define a structured stream result,
- represent normal completion vs repetition abort vs manual stop.

#### `src/requestFingerprint.ts`

Purpose:

- compute stable request fingerprints based on prompt, files, model, and request kind.

#### `src/requestRetryGuard.ts`

Purpose:

- track recently repetition-aborted request fingerprints,
- block immediate replays of the same request.

#### `src/actionLoopGuard.ts`

Purpose:

- detect repeated create/edit action patterns,
- block repeated file actions across continuation turns.

#### `src/fileMutationGuard.ts`

Purpose:

- track active file mutations,
- ensure one mutation per file path at a time,
- help prevent interrupted or overlapping writes.

### Existing files to update

#### `src/aiClient.ts`

Changes:

- stop returning repetition as plain text-only semantics,
- return structured stream outcome,
- keep repetition detection logic but surface it as state.

#### `src/chatPipeline.ts`

Changes:

- stop follow-up turns after repetition abort,
- integrate request retry guard and action loop guard,
- gate internal/external action execution on structured stream outcome,
- support file-safe handling for incomplete action sequences.

#### `src/fileActions.ts`

Changes:

- integrate file mutation guard,
- reject incomplete or invalid action bodies before write,
- strengthen “no-op vs invalid vs committed” reporting.

#### `src/prompts.ts`

Changes:

- add plan-first behavior for design guideline requests,
- explicitly instruct smaller file decomposition,
- discourage giant single-file Next.js/TypeScript output,
- instruct the model not to repeat completed implementation work.

#### `src/sidebarChatProvider.ts`

Changes:

- recognize repetition-aborted requests,
- avoid immediate retry loops for equivalent requests,
- optionally pause or fence retry behavior after loop abort.

## Execution Flow Target

### For a design-guideline-driven coding request

1. User references a design guideline markdown document.
2. LLeM produces a short implementation plan only.
3. The plan includes small file decomposition.
4. Code generation begins in narrow units.
5. Each file mutation is prepared fully before disk write.
6. If repetition starts, the active request is marked repetition-aborted.
7. No further continuation turn or repeated file action is allowed from that request.
8. No partial file contents are committed.

## Validation and Testing Plan

### Add focused tests

#### `tests/streamOutcome.test.mjs`

Validate:

- repetition abort is returned as structured state,
- normal completion and repetition abort are distinguishable.

#### `tests/requestRetryGuard.test.mjs`

Validate:

- the same request fingerprint is blocked after repetition abort,
- unrelated requests still run normally.

#### `tests/actionLoopGuard.test.mjs`

Validate:

- duplicate `create_file` actions are detected,
- duplicate `edit_file` actions are detected,
- slightly different text with the same action pattern is still recognized when appropriate.

#### `tests/fileMutationGuard.test.mjs`

Validate:

- only one mutation per path can be active,
- lock release happens on success and failure,
- overlapping file writes are blocked safely.

#### `tests/chatPipeline.test.mjs`

Add cases for:

- repetition abort stops continuation turns,
- incomplete action blocks do not execute,
- no extra follow-up run happens after loop warning,
- repeated requests are fenced after a repetition stop.

#### `tests/fileActions.test.mjs`

Add cases for:

- malformed edit action bodies do not write,
- incomplete create/edit actions do not touch disk,
- interrupted flows preserve original file contents,
- atomic write keeps old content on failure.

## Delivery Order

### Phase 1. Hard-stop repetition correctly

- add `streamOutcome.ts`
- wire `aiClient.ts`
- wire `chatPipeline.ts`
- ensure post-warning continuation stops

### Phase 2. Prevent immediate repeat of the same request

- add `requestFingerprint.ts`
- add `requestRetryGuard.ts`
- connect through `sidebarChatProvider.ts` and `chatPipeline.ts`

### Phase 3. Prevent repeated file actions

- add `actionLoopGuard.ts`
- integrate with action execution flow

### Phase 4. Protect file integrity

- add `fileMutationGuard.ts`
- harden `fileActions.ts`
- reject incomplete action blocks
- ensure file-level all-or-nothing behavior

### Phase 5. Improve design-guideline-driven generation behavior

- update `prompts.ts`
- push plan-first flow
- enforce smaller Next.js/TypeScript file decomposition

## Success Criteria

This work is successful when all of the following are true:

- repetition detection stops the active request exactly once,
- no continuation turn runs after a repetition abort,
- the same request does not immediately restart the same loop,
- the same file action pattern is not executed repeatedly,
- design-guideline-driven coding is planned before implementation,
- Next.js/TypeScript output is split into smaller files by default,
- interrupted generations never leave partially broken file contents on disk.
