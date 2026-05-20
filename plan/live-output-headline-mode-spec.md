# LLeM Live Output Headline Mode — Spec

> 작성일: 2026-05-20
> 상태: 설계 단계 (미구현)
> 관련 파일: `src/webview/main.ts`, `src/webview/styles.css`, `src/webviewHtml.ts`, `src/sidebarChatProvider.ts`, `src/streamOutcome.ts`, `src/assistantOutputSanitizer.ts`

---

## 1. 목표

현재 LLeM의 live output 영역은 AI가 생성하는 **모든 텍스트를 실시간으로 표시**한다. 이로 인해:

- 무한반복되는 AI 응답이 그대로 사용자에게 노출됨
- action 태그(`<create_file>`, `<edit_file>` 등)와 일반 텍스트가 뒤섞여 가독성 저하
- 화면이 계속 스크롤되며 불필요한 정보로 사용자를 압도함

**목표**: Live output을 **Codex 스타일의 헤드라인 모드**로 전환하여, 진행 중인 action 단계만 아이콘+텍스트 한 줄로 표시하고, AI의 상세 생성 텍스트는 숨긴다.

---

## 2. 사용자 요구사항 (인터뷰 결과)

| 질문 | 답변 | 결정 사항 |
|------|------|-----------|
| 표시할 정보 | 진행 단계만 | action 단계(파일 읽기/수정/생성/명령어 실행)만 표시 |
| 일반 텍스트 처리 | 숨김 | AI의 계획/설명 텍스트는 live output에서 완전히 숨김 |
| 반복 감지 시 표시 | 간단한 메시지 | `⚠️ 반복 출력 감지, 중단됨` 한 줄 메시지 |
| UI 레이아웃 | 컴팩트 단일 라인 | Codex 스타일의 단일 라인/컴팩트 형식 |
| 완료 후 표시 | 간단한 완료 메시지 | `✅ 완료 (3개 파일 수정, 2개 명령어 실행)` 요약 |
| 상세 보기 접근 | 클릭/호버로 확장 | 헤드라인 클릭 또는 호버 시 상세 내용 펼쳐짐 |
| 진행 단계 형식 | 아이콘 + 텍스트 | `✏️ Editing src/app.ts` 형식 |
| MCP 상태 표시 | 동일한 헤드라인 형식 | `🔌 Calling MCP tool: server.tool` |
| 다중 단계 표시 | 전체 나열 | 모든 단계를 시간순으로 각각 한 줄씩 |
| 메타 정보 | 경과 시간만 | `⏱ 12s` 형식으로 경과 시간만 표시 |
| 스트림 시작 전 | Thinking 표시 | `🤔 Thinking...` 메시지 |
| UI 위치 | 상태 표시줄만 | stream-preview 영역 제거, 간결한 상태 표시줄만 |
| 활성화 방식 | 항상 헤드라인 모드 | 기본값으로 적용, 설정 토글 불필요 |

---

## 3. 현재 아키텍처 분석

### 3-1. 현재 Live Output UI 구조

```
stream-shell (streamEl)
├── stream-status (streamStatusEl)
│   ├── stream-dot (상태 표시 도트)
│   ├── stream-title (streamStatusTitleEl): "Live output" / "Warming up output"
│   └── stream-meta (streamMetaEl): "12s · 45 chunks · 1200 chars"
└── stream-preview (streamPreviewEl)
    ├── (action 감지 시) → stream-action-progress 박스
    │   ├── action-step-badge: "✏️ Editing file"
    │   ├── action-step-detail: "src/app.ts"
    │   └── action-step-meta: "⏱ 12s · 🧩 45 chunks · 📝 1200 chars"
    └── (일반 텍스트) → fmt() 렌더링된 전체 텍스트
```

### 3-2. 관련 함수 및 변수

| 이름 | 위치 | 역할 |
|------|------|------|
| `streamRaw` | `main.ts` (전역) | 스트림의 모든 raw 텍스트 누적 |
| `streamPreviewRaw` | `main.ts` (전역) | 미리보기용 sanitize된 텍스트 |
| `renderStreamNow()` | `main.ts:1544` | 80ms 간격으로 stream-preview 업데이트 |
| `scheduleStreamRender()` | `main.ts:1597` | 렌더 타이머 스케줄링 |
| `finalizeStream()` | `main.ts:1606` | 스트림 완료/중단 시 최종 렌더링 |
| `updateStreamMeta()` | `main.ts:1502` | 메타 정보(시간, 청크, 글자 수) 업데이트 |
| `sanitizeAssistantDisplayText()` | `main.ts:1091` | 출력 텍스트에서 action 태그 제거 |
| `sanitizeAssistantOutput()` | `assistantOutputSanitizer.ts` | action 태그 제거 (별도 파일) |
| `setMcpToolStatus()` | `main.ts:1524` | MCP 툴 상태 표시 |

### 3-3. 스트림 상태 흐름

```
streamStart (서버 → webview)
  → streamChunk (서버 → webview) * N (80ms 간격 렌더)
  → streamEnd (서버 → webview) → finalizeStream('done')
  → streamAbort (서버 → webview) → finalizeStream('stopped')
```

MCP 툴 상태:
```
mcpToolStatus { state: 'running', server, tool }
mcpToolStatus { state: 'done', server, tool, durationMs }
```

---

## 4. 새로운 디자인: Headline Mode

### 4-1. 새로운 UI 구조

```
stream-status-bar (streamStatusBarEl) [신규]
├── stream-dot (기존 유지, 상태 표시)
├── stream-status-text (streamStatusTextEl) [변경]
│   ├── "🤔 Thinking..." (스트림 시작 전)
│   ├── "✏️ Editing src/app.ts" (현재 진행 단계)
│   ├── "📁 Creating src/new.ts" (파일 생성 중)
│   ├── "▶ Running command" (명령어 실행 중)
│   ├── "📖 Reading README.md" (파일 읽는 중)
│   ├── "🔌 Calling MCP tool: server.tool" (MCP 호출 중)
│   └── "⚠️ 반복 출력 감지, 중단됨" (반복 감지 시)
└── stream-elapsed (streamElapsedEl) [변경]
    └── "⏱ 12s" (경과 시간만)

[완료 시]
stream-complete-banner [신규, 기존 stream-preview-final 대체]
├── 헤드라인 모드 → "✅ Completed (3 files modified, 1 command executed)"
└── [Show details] 버튼 (클릭 시 펼쳐짐)
```

### 4-2. 핵심 변경 사항

#### 4-2-1. stream-preview 영역 제거

**파일**: `src/webviewHtml.ts`, `src/webview/main.ts`

`stream-preview` (`.stream-preview`) 엘리먼트와 관련 CSS 클래스를 제거한다. 대신 `stream-status` 표시줄에 모든 정보를 통합한다.

**변경 전**:
```html
<div class="stream-shell">
  <div class="stream-status live">
    <div class="stream-dot"></div>
    <span class="stream-title">Live output</span>
    <span class="stream-meta">12s · 45 chunks · 1200 chars</span>
  </div>
  <div class="stream-preview stream-preview-live">
    <!-- 전체 생성 텍스트 -->
  </div>
</div>
```

**변경 후**:
```html
<div class="stream-shell">
  <div class="stream-status live" tabindex="0" title="Click to expand details">
    <div class="stream-dot"></div>
    <span class="stream-title">✏️ Editing src/app.ts</span>
    <span class="stream-elapsed">⏱ 12s</span>
  </div>
</div>
```

#### 4-2-2. Headline 텍스트 생성 로직 (renderStreamNow 대체)

**파일**: `src/webview/main.ts`

기존 `renderStreamNow()` 함수를 `renderHeadlineStream()`으로 대체한다.

**의사코드**:
```typescript
function renderHeadlineStream(): void {
    if (activeMcpToolLabel) {
        // MCP 툴 실행 중
        streamStatusTitleEl.textContent = `🔌 ${activeMcpToolLabel}`;
        streamStatusEl.className = 'stream-status mcp-active';
        return;
    }

    if (streamRaw.length === 0) {
        // 스트림 시작 전
        streamStatusTitleEl.textContent = '🤔 Thinking...';
        streamStatusEl.className = 'stream-status pending';
        return;
    }

    // action 태그 감지 → 헤드라인 생성
    const headline = extractActionHeadline(streamRaw);
    if (headline) {
        streamStatusTitleEl.textContent = headline;
        streamStatusEl.className = 'stream-status live';
    } else {
        // 일반 텍스트는 숨김 → "⏳ Generating..." 표시
        streamStatusTitleEl.textContent = '⏳ Generating...';
        streamStatusEl.className = 'stream-status live';
    }

    // 경과 시간 업데이트
    streamElapsedEl.textContent = `⏱ ${formatElapsed(Date.now() - streamStartedAt)}`;
}

function extractActionHeadline(text: string): string | null {
    const raw = text || '';

    // 가장 최근 action 태그를 찾음 (우선순위: 나중에 열린 태그가 우선)
    const actions: Array<{ type: string; path?: string }> = [];

    // create_file
    const createMatches = raw.matchAll(/<create_file\s+path="([^"]*)"/gi);
    for (const m of createMatches) actions.push({ type: 'create_file', path: m[1] });

    // edit_file
    const editMatches = raw.matchAll(/<edit_file\s+path="([^"]*)"/gi);
    for (const m of editMatches) actions.push({ type: 'edit_file', path: m[1] });

    // run_command
    const cmdMatches = raw.matchAll(/<run_command\s*>/gi);
    for (const m of cmdMatches) actions.push({ type: 'run_command' });

    // read_file
    const readMatches = raw.matchAll(/<read_file\s+path="([^"]*)"/gi);
    for (const m of readMatches) actions.push({ type: 'read_file', path: m[1] });

    // delete_file
    const deleteMatches = raw.matchAll(/<delete_file\s+path="([^"]*)"/gi);
    for (const m of deleteMatches) actions.push({ type: 'delete_file', path: m[1] });

    if (actions.length === 0) return null;

    // 가장 최근 action 기준으로 헤드라인 생성
    const latest = actions[actions.length - 1];

    // 진행 중인 action은 닫는 태그가 없을 수 있음 → 열린 태그 기준
    const isOpen = !raw.includes(`</${latest.type}>`);
    const prefix = isOpen ? '' : ''; // 완료된 action도 일단 표시

    switch (latest.type) {
        case 'create_file':
            return `📁 Creating ${latest.path ? fileNameFromPath(latest.path) : 'file'}`;
        case 'edit_file':
            return `✏️ Editing ${latest.path ? fileNameFromPath(latest.path) : 'file'}`;
        case 'run_command':
            return `▶ Running command`;
        case 'read_file':
            return `📖 Reading ${latest.path ? fileNameFromPath(latest.path) : 'file'}`;
        case 'delete_file':
            return `🗑️ Deleting ${latest.path ? fileNameFromPath(latest.path) : 'file'}`;
        default:
            return null;
    }
}
```

#### 4-2-3. 완료 시 표시 변경

**파일**: `src/webview/main.ts`

`finalizeStream()` 함수를 수정하여 완료 시 헤드라인 요약을 표시한다.

**변경 전**:
```typescript
if (streamPreviewEl) {
    if (hasFinalText) {
        streamPreviewEl.className = 'stream-preview stream-preview-final';
        streamPreviewEl.innerHTML = fmt(sanitizedFinalText);
    } else {
        // ...
    }
}
```

**변경 후**:
```typescript
// 완료 시: 헤드라인 요약 배너 표시 (stream-preview 영역 없음)
if (streamStatusTitleEl) {
    if (state === 'done') {
        const summary = generateCompletionSummary(streamRaw);
        streamStatusTitleEl.textContent = summary;
        streamStatusEl.className = 'stream-status done';
        streamElapsedEl.textContent = `⏱ ${formatElapsed(Date.now() - streamStartedAt)}`;
    } else {
        streamStatusTitleEl.textContent = state === 'stopped'
            ? (repetitionDetected ? '⚠️ 반복 출력 감지, 중단됨' : '⏹ Generation stopped')
            : '⏹ Generation stopped';
        streamStatusEl.className = 'stream-status stopped';
    }
}

function generateCompletionSummary(rawText: string): string {
    const fileChanges = rawText.match(/@@LLEM_FILE_CHANGES\s+(\{.+\})/);
    if (fileChanges) {
        try {
            const data = JSON.parse(fileChanges[1]);
            const files = Array.isArray(data.files) ? data.files.length : 0;
            const additions = Number(data.additions || 0);
            const deletions = Number(data.deletions || 0);
            return `✅ ${files} file${files !== 1 ? 's' : ''} changed (+${additions}/-${deletions})`;
        } catch {}
    }

    // action 태그 개수로 요약
    const createCount = (rawText.match(/<create_file/g) || []).length;
    const editCount = (rawText.match(/<edit_file/g) || []).length;
    const cmdCount = (rawText.match(/<run_command/g) || []).length;

    const parts: string[] = [];
    if (createCount > 0) parts.push(`${createCount} file${createCount > 1 ? 's' : ''} created`);
    if (editCount > 0) parts.push(`${editCount} file${editCount > 1 ? 's' : ''} edited`);
    if (cmdCount > 0) parts.push(`${cmdCount} command${cmdCount > 1 ? 's' : ''} run`);

    return parts.length > 0 ? `✅ Completed (${parts.join(', ')})` : '✅ Done';
}
```

#### 4-2-4. 완료 후 Detail 보기 (클릭/호버 확장)

**파일**: `src/webview/main.ts`

완료된 stream-status 표시줄을 클릭하면 상세 내용을 펼쳐서 볼 수 있다.

```typescript
// stream-status 바인딩
streamStatusEl.addEventListener('click', function() {
    if (streamStatusEl.classList.contains('done') || streamStatusEl.classList.contains('stopped')) {
        toggleStreamDetails();
    }
});

function toggleStreamDetails(): void {
    const detailEl = document.querySelector('.stream-details');
    if (detailEl) {
        detailEl.remove();
        return;
    }

    const raw = streamRaw || ''; // streamRaw에 마지막 스트림 텍스트가 저장되어 있음
    if (!raw) return;

    const sanitized = sanitizeAssistantDisplayText(raw);
    if (!sanitized) return;

    const details = document.createElement('div');
    details.className = 'stream-details';
    details.innerHTML = fmt(sanitized);

    // stream-shell 뒤에 삽입
    const shell = document.querySelector('.stream-shell');
    if (shell) {
        shell.after(details);
        details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}
```

#### 4-2-5. 반복 감지 시 표시

**파일**: `src/webview/main.ts`, `src/chatPipeline.ts`

반복 감지가 발생하면 기존의 긴 경고 메시지 대신 간단한 한 줄 메시지를 live output에 표시한다.

**변경 전** (chatPipeline.ts):
```typescript
this.host.postWebviewMessage({
    type: 'streamChunk',
    value: `\n\n> ⚠️ **[LLeM] Repeating output detected. Stopping this run before it loops again.**\n\n`
});
```

**변경 후** (webview/main.ts에서 처리):
```typescript
// chatPipeline.ts에서 streamChunk로 전송된 repetition 메시지 대신
// webview에서 자체적으로 처리

// streamAbort 메시지에 stopReason 필드 추가
// 서버 → webview: { type: 'streamAbort', stopReason: 'repetition_detected' }

// webview/main.ts onmessage 핸들러:
if (msg.type === 'streamAbort' && msg.stopReason === 'repetition_detected') {
    streamStatusTitleEl.textContent = '⚠️ 반복 출력 감지, 중단됨';
    streamStatusEl.className = 'stream-status stopped';
    streamElapsedEl.textContent = `⏱ ${formatElapsed(Date.now() - streamStartedAt)}`;
    // 더 이상 streamChunk 메시지를 통한 긴 경고 메시지 표시 안 함
    return;
}
```

#### 4-2-6. 헤드라인에서 사용될 아이콘/레이블 매핑

```typescript
const ACTION_HEADLINE_MAP: Record<string, { icon: string; label: string }> = {
    create_file:  { icon: '📁', label: 'Creating' },
    edit_file:    { icon: '✏️', label: 'Editing' },
    run_command:  { icon: '▶',  label: 'Running command' },
    read_file:    { icon: '📖', label: 'Reading' },
    delete_file:  { icon: '🗑️', label: 'Deleting' },
    list_files:   { icon: '📁', label: 'Listing directory' },
    call_mcp_tool:{ icon: '🔌', label: 'Calling MCP tool' },
    list_mcp_tools:{ icon: '🔌', label: 'Listing MCP tools' },
};
```

#### 4-2-7. 다중 단계 타임라인

모든 진행 단계를 시간순으로 나열하되, 각각 한 줄씩 표시한다. 완료된 단계는 체크 표시(✅) prefix, 현재 진행 중인 단계는 진행 중인 아이콘으로 표시한다.

```typescript
// 완료 단계 로그 (메모리에 유지)
interface StreamStep {
    type: string;
    path?: string;
    startedAt: number;
    completedAt?: number;
}

let streamSteps: StreamStep[] = [];

function recordStreamStep(type: string, path?: string): void {
    const existing = streamSteps.find(s => s.type === type && s.path === path && !s.completedAt);
    if (existing) {
        // 이미 같은 단계가 있으면 업데이트
        existing.completedAt = Date.now();
    }
    streamSteps.push({ type, path, startedAt: Date.now() });
    
    // 최대 20개 step만 유지 (메모리 관리)
    if (streamSteps.length > 20) {
        streamSteps = streamSteps.slice(-20);
    }
}

// 태그 닫힘 감지 시 완료 기록
function completeStreamStep(type: string, path?: string): void {
    const step = streamSteps.find(s => s.type === type && s.path === path && !s.completedAt);
    if (step) {
        step.completedAt = Date.now();
    }
}
```

### 4-3. CSS 변경

**파일**: `src/webview/styles.css`

```css
/* 1. 헤드라인 모드 stream-status 확장 */
.stream-status {
    cursor: pointer; /* 클릭 가능하도록 */
    transition: border-color .18s ease, box-shadow .18s ease;
}
.stream-status:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow);
}

/* 2. 경과 시간 라벨 */
.stream-elapsed {
    margin-left: auto;
    font-size: 10px;
    color: var(--text-faint);
    font-family: 'SF Mono', 'JetBrains Mono', 'Menlo', monospace;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

/* 3. 헤드라인 텍스트 */
.stream-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
}

/* 4. 완료 배너 스타일 */
.stream-status.done {
    border-color: rgba(141, 224, 159, 0.28);
    background: linear-gradient(180deg, rgba(141, 224, 159, 0.04), transparent);
}
.stream-status.stopped {
    border-color: rgba(255, 107, 122, 0.28);
    background: linear-gradient(180deg, rgba(255, 107, 122, 0.04), transparent);
}

/* 5. 펼쳐진 상세 내용 */
.stream-details {
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--panel);
    padding: 12px 14px;
    max-height: min(48vh, 460px);
    overflow: auto;
    line-height: 1.7;
    animation: expandIn .2s ease;
}
@keyframes expandIn {
    from { opacity: 0; max-height: 0; padding: 0 14px; }
    to { opacity: 1; max-height: min(48vh, 460px); padding: 12px 14px; }
}

/* 6. Thinking 상태 */
.stream-status.pending .stream-title {
    color: var(--text-faint);
    font-style: italic;
}

/* 7. stream-preview 관련 구 CSS 제거 */
/* .stream-preview, .stream-preview-empty, .stream-preview-live, 
   .stream-preview-final, .stream-action-progress, .action-step-badge,
   .action-step-detail, .action-step-meta, @keyframes pulseProgress 제거 */

/* 8. 기존 stream-meta를 stream-elapsed로 대체 */
/* .stream-meta 제거 */
```

---

## 5. 변경될 파일 목록

| 파일 | 변경 사항 | 영향도 |
|------|----------|--------|
| `src/webview/main.ts` | `renderStreamNow()` → `renderHeadlineStream()` 대체. `extractActionHeadline()` 신규. `finalizeStream()` 완료 메시지 변경. `stream-preview` 관련 변수/로직 제거. 클릭 확장 기능 추가. 반복 감지 메시지 처리 변경. streamSteps 관리 로직 추가. `streamMetaEl` → `streamElapsedEl` 변경 | **High** |
| `src/webviewHtml.ts` | stream-preview 엘리먼트 제거. stream-status에 tabindex, title 추가 | **Low** |
| `src/webview/styles.css` | `.stream-preview-*`, `.stream-action-progress`, `.action-step-*` 제거. `.stream-elapsed`, `.stream-details` 신규. `.stream-title` 스타일 개선 | **Medium** |
| `src/chatPipeline.ts` | 반복 감지 시 전송하는 streamChunk 메시지 대신 streamAbort에 stopReason 포함 (webview에서 처리) | **Low** |
| `src/sidebarChatProvider.ts` | (변경 불필요 — webview 메시지만 변경) | **None** |

---

## 6. 새 메시지 타입 또는 변경

### Extension → Webview

| type | payload | 변경 |
|------|---------|------|
| `streamChunk` | `{ value: string }` | 변경 없음. 단 webview에서 더 이상 전체 텍스트를 표시하지 않음 |
| `streamAbort` | `{ stopReason?: string }` | **변경**: `stopReason` 필드 추가 (`'repetition_detected'` 등) |
| `streamEnd` | `{ message, messageIndex }` | 변경 없음. 단 webview에서 완료 배너 표시 방식 변경 |

---

## 7. 마이그레이션 계획

### Phase 1: 핵심 UI 변경

1. `src/webviewHtml.ts`: stream-preview 엘리먼트 제거
2. `src/webview/styles.css`: 기존 스트림 프리뷰 CSS 제거 및 새 CSS 추가
3. `src/webview/main.ts`: `renderHeadlineStream()` 구현, `extractActionHeadline()` 구현

### Phase 2: 완료/중단 처리 변경

4. `src/webview/main.ts`: `finalizeStream()` 수정 — 완료 배너 + 요약 생성
5. `src/webview/main.ts`: 클릭 확장 기능 구현
6. `src/webview/main.ts`: 스트림 단계 로깅 (streamSteps)

### Phase 3: 반복 감지 UI 개선

7. `src/chatPipeline.ts`: streamAbort 메시지에 stopReason 포함하도록 수정
8. `src/webview/main.ts`: 반복 감지 시 간단한 헤드라인 표시

### Phase 4: 정리 및 테스트

9. 불필요한 변수/함수 정리 (`streamPreviewRaw`, `streamPreviewEl` 등)
10. 모든 상태 (pending → live → done/stopped) 전환 테스트
11. 다중 action 연속 실행 시 타임라인 표시 검증

---

## 8. 주요 상태 전환 시나리오

### 시나리오 A: 정상 완료 (파일 수정)

```
[🤔 Thinking...] ──→ [✏️ Editing app.ts] ──→ [📁 Creating utils.ts] ──→ [✅ 2 files changed (+45/-12)]
                         (클릭)                          (클릭)
                     ┌──────────────┐              ┌──────────────┐
                     │ 상세 내용     │              │ 상세 내용     │
                     │ (펼쳐짐)     │              │ (펼쳐짐)     │
                     └──────────────┘              └──────────────┘
```

### 시나리오 B: 중단/반복 감지

```
[🤔 Thinking...] ──→ [✏️ Editing app.ts] ──→ [⚠️ 반복 출력 감지, 중단됨]
                                                  (클릭)
                                              ┌──────────────┐
                                              │ 중단된 내용   │
                                              │ (펼쳐짐)     │
                                              └──────────────┘
```

### 시나리오 C: MCP 툴 호출

```
[🤔 Thinking...] ──→ [🔌 context-mode · ctx_batch_execute] ──→ [✅ Done]
```

### 시나리오 D: 명령어 실행만

```
[🤔 Thinking...] ──→ [▶ Running command] ──→ [✅ 1 command run]
```

---

## 9. Edge Cases

| Edge Case | 처리 |
|-----------|------|
| **스트림 시작 후 첫 토큰이 오래 걸림** | `🤔 Thinking...` 유지 (60초 이상이면 `⏱ 60s` 표시) |
| **완료 후 다시 스트림 시작** | streamSteps 초기화, stream-status를 pending 상태로 리셋 |
| **action 태그 없이 일반 텍스트만 생성** | `⏳ Generating...` 표시 (action이 없어도 AI가 응답 중임을 알림) |
| **매우 긴 파일 경로** | `fileNameFromPath()`로 축약 (예: `src/components/NavBar.tsx` → `NavBar.tsx`) |
| **완료 후 상세 내용 펼친 상태에서 새 스트림 시작** | stream-details 자동 제거 + stream-shell 리셋 |
| **반복 감지 + 이미 생성된 내용** | 반복 감지 시점까지의 내용은 상세 보기로 열람 가능 |
| **다중 action 동시 진행** | 가장 최근에 열린 action 태그를 헤드라인으로 표시 |
| **완료 메시지에 file changes 요약이 없음** | action 태그 개수 기반으로 fallback 요약 생성 |
| **완료되었지만 action이 하나도 없음** | `✅ Done` (기본 메시지) |
| **사용자가 중단 버튼 누름** | `⏹ Generation stopped` (반복 감지와 구분됨) |

---

## 10. 제거/대체될 기존 요소

### 제거될 HTML 엘리먼트

- `stream-preview` (`.stream-preview`)
- `stream-preview-empty` (`.stream-preview-empty`)
- `stream-preview-live` (`.stream-preview-live`)
- `stream-preview-final` (`.stream-preview-final`)

### 제거될 CSS 클래스/애니메이션

- `.stream-preview`
- `.stream-preview-empty`
- `.stream-preview-live`
- `.stream-preview-final`
- `.stream-action-progress`
- `.action-step-badge`
- `.action-step-detail`
- `.action-step-meta`
- `@keyframes pulseProgress`

### 제거될 JavaScript 변수/함수

| 변수/함수 | 사유 |
|-----------|------|
| `streamPreviewRaw` | 더 이상 미리보기 텍스트 필요 없음 |
| `streamPreviewEl` | 더 이상 stream-preview DOM 엘리먼트 필요 없음 |
| `streamMetaEl` | `streamElapsedEl`로 대체 |
| `streamMetaTimer` / `STREAM_META_INTERVAL` | 간단한 elapsed는 setInterval 불필요 (requestAnimationFrame 또는 status 업데이트 시 함께 갱신) |
| `sanitizeAssistantDisplayText()` | 일반 텍스트를 더 이상 표시하지 않으므로 불필요 (단, detail 확장 시에는 사용할 수 있음) |
| `STREAM_RENDER_INTERVAL` | 렌더링 주기 불필요 (action 태그 감지만 하면 됨) |
| `streamRenderTimer` | 타이머 불필요 |

---

## 11. 성능 고려사항

- **action 태그 검색**: `streamRaw`에서 정규식으로 action 태그를 찾는 것은 매 렌더링마다 수행됨. 현재 `streamRaw`는 최대 수만 자이므로 정규식 검색은 sub-millisecond 수준. 부담 없음.
- **상세 내용 확장**: 사용자가 클릭했을 때만 `fmt()` 호출 → 성능 영향 없음.
- **메모리**: `streamRaw`는 그대로 유지 (최종 메시지 저장용). `streamSteps`는 최대 20개로 제한. 메모리 영향 최소.
- **DOM 크기 감소**: stream-preview 영역이 제거되므로 DOM 노드 수가 크게 줄어듦 (특히 긴 응답 생성 시). **성능 향상 예상.**

---

## 12. 테스트 계획

| 테스트 항목 | 방법 |
|------------|------|
| 정상 완료 시 헤드라인 표시 | 프롬프트 전송 → 파일 수정 → 완료 메시지 확인 |
| action 태그 없는 응답 | 일반 텍스트만 생성되는 프롬프트 → `⏳ Generating...` 표시 확인 |
| 반복 감지 | 반복 유발 프롬프트 → `⚠️ 반복 출력 감지, 중단됨` 표시 확인 |
| 완료 후 상세 확장 | 완료된 stream-status 클릭 → 상세 내용 펼쳐짐 확인 |
| MCP 툴 호출 | MCP 툴 호출 포함 프롬프트 → `🔌 server.tool` 표시 확인 |
| 다중 action 연속 실행 | 여러 action 순차 실행 → 각 단계 헤드라인 표시 확인 |
| 새 스트림 시작 시 이전 스트림 정리 | 완료 후 새 프롬프트 → 이전 상세 내용 제거 확인 |
| 스트림 중단 | 중단 버튼 → `⏹ Generation stopped` 표시 확인 |
| Thinking 표시 | 스트림 시작 직후 → `🤔 Thinking...` 표시 확인 |
| 경과 시간 | 스트림 진행 중 → `⏱ Ns` 실시간 업데이트 확인 |
