# Live Output → File 미반영 원인 분석

## 전체 실행 흐름 (정상 케이스)

```
AI 스트림 → streamCompletion() → onToken() → buffer → webview(streamChunk)
                                                ↓
                                       streamedText / output 누적
                                                ↓
                              StreamOutcome { text: output } 반환
                                                ↓
                        chatPipeline.ts: executeActions(currentAiResponse.text)
                                                ↓
                        actionExecutor.ts: parseEditActions(aiMessage)
                                                ↓
                        fileActions.ts: applyFindReplacePairs() → 파일 쓰기
```

---

## 🔴 원인 1 (가장 유력): `<find>` 텍스트가 실제 파일 내용과 다름

### 코드 증거 (`fileActions.ts` L308-L323)

```typescript
const findReplaceRegex = /<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>/g;
...
while ((match = findReplaceRegex.exec(body)) !== null) {
    const findText = match[1];
    const replaceText = match[2];
    if (result.includes(findText)) {   // ← 이 조건이 실패하면 파일 무변경
        result = result.replace(findText, replaceText);
        editCount += 1;
    } else {
        missingTargets += 1;   // ← 카운트만 올리고 넘어감
    }
}
```

`editCount === 0`이면:
```typescript
if (edited.editCount === 0) {
    return {
        report,           // ← "⚠️ could not find the target text" 메시지만 포함
        workspaceModified: false,   // ← 파일 안 씀
        brainModified: false
    };
}
```

### 왜 발생하는가?

AI는 `<find>` 블록에 **기억 속의 코드**를 씁니다. 하지만 실제 파일은:
- 탭/공백이 다름
- 줄바꿈이 다름 (CRLF vs LF)
- 파일이 이미 다른 edit에 의해 변경된 상태
- AI가 파일 내용을 `read_file`로 읽지 않고 추측으로 작성

---

## 🔴 원인 2: action 태그가 완성되기 전에 watchdog이 스트림을 중단

### 코드 경로 (`chatPipeline.ts` L600-L608)

```typescript
if (!loopDetected && token.trim().length > 0) {
    if (watchdog.addToken(token)) {
        loopDetected = true;
        abortController.abort();   // ← 스트림 강제 종료
    }
}
```

### 코드 경로 (`chatPipeline.ts` L622-L629)

```typescript
if (loopDetected && !result.repeated) {
    return {
        text: streamedText || result.text,   // ← 중단 시점까지의 불완전한 텍스트
        stopReason: 'watchdog_loop',
        repeated: true,
        aborted: true
    };
}
```

그러나 **B-1 수정 후**:
```typescript
if (currentAiResponse.repeated) {
    // 즉시 return — executeActions() 호출 안 됨!
    return { repeated: true, stopReason: repeatedStopReason };
}
```

> ⚠️ **문제**: Watchdog이 `<edit_file ...>` 태그를 쓰는 도중 스트림을 중단하면,
> `</edit_file>` 닫는 태그가 없어서 regex가 매칭 안 됨.
> 화면에는 코드가 보이지만, `executeActions()`로 전달되는 텍스트는 **닫는 태그가 없는 불완전한 XML**.

---

## 🟡 원인 3: `executeActions()`에 전달되는 text와 화면에 보이는 text가 다를 때

### 코드 경로

- **화면**: `buffer`를 통해 50ms 간격으로 `streamChunk` → webview로 전달
- **액션 실행**: `streamedText` (혹은 `output`) → `StreamOutcome.text` → `executeActions(currentAiResponse.text)`

두 변수는 동일해야 하지만, **AbortError 처리 경로가 다르면** 불일치 발생:

```typescript
// aiClient.ts L265
return completedStreamOutcome(output);   // ← 정상 종료: output 사용

// chatPipeline.ts L636
return {
    text: streamedText,   // ← AbortError: streamedText 사용 (별도 변수)
    ...
};
```

`output` (aiClient 내부)과 `streamedText` (chatPipeline 내부)는 **같은 onToken 콜백으로 동시에 누적**되므로 정상적으로는 동일합니다. 단, Watchdog abort 시 `output`은 마지막 chunk가 반영 안 될 수 있음.

---

## 🟡 원인 4: `ActionLoopGuard`가 유사한 edit를 차단

### 코드 경로 (`actionExecutor.ts`)

```typescript
if (actionLoopGuard.shouldBlock({ kind: 'edit', path: action.path, body: action.body })) {
    ctx.fileResult.report.push(`⚠️ Edit skipped: ${action.path} — repeated edit action was blocked.`);
    continue;
}
```

AI가 동일한 파일에 동일한 `<find>` 블록으로 재시도하면 차단됩니다.
채팅창에는 코드가 보이지만 실제로 skip 됩니다.

---

## 🟡 원인 5: `parseFallbackFileBlocks`에서 잘못된 action 파싱

AI가 `<edit_file>` 대신 마크다운 코드블록으로 코드를 출력하면
`parseFallbackFileBlocks()`가 이를 **create_file**로 해석해서
edit 대신 덮어쓰기를 시도하거나 아예 무시합니다.

---

## 진단 체크리스트

| 증상 | 원인 |
|------|------|
| Action Report가 `⚠️ could not find the target text` | **원인 1** — find 텍스트 불일치 |
| Action Report에 아무것도 없고 파일 변경도 없음 | **원인 2** — 태그 불완전, 파싱 실패 |
| `⚠️ Edit skipped: ... repeated edit action was blocked` | **원인 4** — ActionLoopGuard 차단 |
| `🛑 Edit loop detected` | **FileStateGuard** — 해시 불변 3회 |
| 채팅에 아무 Action Report가 없고 파일도 안 바뀜 | **원인 5** — 태그 형식 오류로 파싱 자체 실패 |

---

## 가장 시급한 수정 — 원인 1 해결

### 현재 문제
AI가 `<find>` 블록을 생성할 때 `read_file`을 먼저 하지 않으면
메모리 속 코드로 작성 → 실제 파일과 불일치.

### 해결 방향

**A) 시스템 프롬프트 강화**: `edit_file` 전 `read_file` 필수 지시
```
Before using <edit_file>, ALWAYS call <read_file path="..."/> first to confirm the exact current content. 
The <find> block must be an EXACT verbatim copy from the file — no approximations.
```

**B) find 실패 시 자동 복구**: find 실패 시 AI에게 파일 내용을 자동으로 주입해서 재시도 유도

```typescript
// fileActions.ts의 executeEditFileAction에서 missingTargets > 0이면
// chatMessage에 실제 파일 내용을 포함시켜 AI가 정확한 find 블록을 다시 쓰도록 함
if (edited.missingTargets > 0 && edited.editCount === 0) {
    return {
        report: [`⚠️ Edit had no effect: <find> text not found in ${relPath}.`],
        workspaceModified: false,
        brainModified: false,
        chatMessage: {
            role: 'user',
            content: `[SYSTEM: edit_file failed — <find> text not found in ${relPath}.\nCurrent file content:\n\`\`\`\n${originalContent.slice(0, 8000)}\n\`\`\`\nPlease re-issue <edit_file> with the correct <find> text matching the actual file content above.]`
        }
    };
}
```

이렇게 하면 AI가 실제 파일 내용을 보고 정확한 `<find>` 블록을 재생성할 수 있습니다.
