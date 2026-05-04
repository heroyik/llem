# LLeM 무한반복 출력 감지 로직 전체 조사

> 조사 일시: 2026-05-04  
> 대상 모델: Ollama에 연결된 Gemma4 계열 (26b, e4b 등)  
> 조사 목적: AI가 생성한 코드 스트림을 실시간 모니터링하여 같은 패턴 반복 / 같은 파일 반복 수정을 감지하는 로직 전체 파악

---

## 1. 전체 구조 개요

무한반복 감지는 **4개의 계층**으로 나뉘어 동작한다.

```
[스트림 레벨]           RepetitionWatchdog     (토큰 단위 실시간 감지)
[스트림 결과 레벨]      StreamOutcome          (반복 종료 상태 구조화)
[요청 레벨]            RequestRetryGuard       (동일 요청 즉시 재실행 차단)
[액션 레벨]            ActionLoopGuard         (동일 파일 작업 반복 차단)
[파일 레벨]            FileMutationGuard       (동일 파일 동시 수정 차단)
```

---

## 2. 계층별 상세 분석

### 2-1. RepetitionWatchdog — 스트림 실시간 감지

**파일**: `src/repetitionWatchdog.ts`  
**크기**: 420줄 / 14,295 bytes

Ollama 스트림에서 토큰이 하나씩 도착할 때마다 `addToken(token)` 을 호출하고, **true**가 반환되면 즉시 스트림을 abort한다.

#### 내부 감지 알고리즘 (5종)

| # | 감지 이름 | 설명 | 핵심 파라미터 |
|---|-----------|------|---------------|
| 1 | **Single Token Spam** | 동일 토큰이 최근 10개 중 8회 이상 등장 | `≥ 8 / 10` |
| 2 | **Token Sequence Loop** | 최근 N개 토큰 시퀀스가 3회 연속 반복 | `minTokenSequence=4` |
| 3 | **Character Suffix Loop** | 최근 500자 내에서 문자열 suffix가 그대로 반복 | `minTextMatch=30` |
| 4 | **Recent Block Loop** | 최근 100자 블록이 전체 텍스트에서 3회 이상 등장 | `blockSize=100, threshold=3` |
| 5 | **Important Sentence Loop** | 40자 이상의 핵심 문장이 3회 이상 반복 | `minSentenceLength=40, threshold=3` |

#### 오탐 방지 로직 (False Positive 억제)

코드 작성 중에는 반복처럼 보이지만 정상인 패턴이 많다. 다음 상황은 감지에서 **제외**된다.

- **마크다운 구조 토큰**: ` ``` `, `---`, `|:---|`, `#`, `>`, `- ` 등
- **코드 / 액션 시퀀스**: 
  - action 태그: `<create_file>`, `<edit_file>`, `<run_command>` 등
  - TypeScript 키워드: `interface`, `export const`, `function`, `return` 등
  - 코드 구조적 패턴: `{}`, `;`, 세미콜론으로 끝나는 라인 수 기반 판단
- **저신호 구조 fragment**: 80% 이상이 마크다운/코드 토큰인 시퀀스는 무시

#### 데이터 관리

```typescript
private tokens: string[] = [];        // 최대 150개 유지 (FIFO)
private fullText: string = '';         // 최근 2000자 윈도우 유지
private abortedReason: string;         // 중단 사유 기록
```

#### 중단 사유 포맷 예시

```
"token spam: \"........\""
"sequence loop (len=6)"
"text suffix loop (len=45)"
"recent block loop (len=100, count=3)"
"important sentence loop (count=3)"
```

---

### 2-2. StreamOutcome — 스트림 결과 구조화

**파일**: `src/streamOutcome.ts`  
**크기**: 38줄 / 905 bytes

반복 감지 결과를 단순한 텍스트 경고가 아닌 **구조화된 상태값**으로 표현한다.

```typescript
export type StreamStopReason =
    | 'completed'           // 정상 완료
    | 'repetition_detected' // 반복 패턴 감지로 중단
    | 'watchdog_loop'       // 워치독이 abort한 경우
    | 'manual_abort';       // 사용자가 직접 중단

export interface StreamOutcome {
    text: string;           // 생성된 텍스트 (중단 시점까지)
    stopReason: StreamStopReason;
    repeated: boolean;      // 반복으로 인한 중단 여부
    aborted: boolean;       // abort 발생 여부
}
```

`isLoopStopReason()` 헬퍼 함수로 반복 중단 여부를 판별:

```typescript
export function isLoopStopReason(stopReason: StreamStopReason): boolean {
    return stopReason === 'repetition_detected' || stopReason === 'watchdog_loop';
}
```

---

### 2-3. ChatPipeline — 파이프라인 레벨 감지

**파일**: `src/chatPipeline.ts`  
**크기**: 775줄 / 34,236 bytes

실제로 스트림을 구동하고 RepetitionWatchdog를 통합하는 핵심 오케스트레이터.

#### 스트림 모니터링 (streamMessages 함수)

```typescript
const watchdog = new RepetitionWatchdog();
let loopDetected = false;

// 각 토큰 도착 시
token => {
    if (!loopDetected && token.trim().length > 0) {
        if (watchdog.addToken(token)) {
            loopDetected = true;
            const reason = watchdog.getAbortedReason();
            logInfo(`[WATCHDOG] Loop detected (${reason}). Aborting stream.`);
            abortController.abort();  // 스트림 즉시 abort
        }
    }
}
```

- 스트림이 abort되면 `StreamOutcome.repeated = true`, `stopReason = 'watchdog_loop'`로 반환
- 50ms 간격으로 버퍼를 flush해서 UI에 청크를 실시간 전송

#### 턴 간 반복 감지 (Turn-to-Turn Loop)

AI가 여러 턴에 걸쳐 실행될 때, 이전 턴과 현재 턴의 시작 부분을 비교:

```typescript
const isSimilar = currentAiResponse.text.trim().slice(0, 300) === previousAiResponsePrefix;
if (isSimilar && currentAiResponse.text.length > 30) {
    logInfo('[PIPELINE] Turn-to-turn loop detected. Breaking execution chain.');
    repeatedStopReason = 'turn_to_turn_loop';
    this.postSingleLoopStopNotice('repetition_detected');
    break;  // 더 이상 continuation turn 진행 안 함
}
```

- 최대 10턴 (`maxTurns = 10`) 내에서만 continuation 허용
- 반복 감지 즉시 break, 더 이상 action 실행 안 함

#### 사용자 알림 (단일 표시)

```typescript
private postSingleLoopStopNotice(stopReason?: string): void {
    const label = isLoopStopReason(stopReason as any)
        ? '[LLeM] Repeating output detected. Stopping this run before it loops again.'
        : '[LLeM] This run was stopped before continuing.';
    this.host.postWebviewMessage({
        type: 'streamChunk',
        value: `\n\n> ⚠️ **${label}**\n\n`
    });
}
```

---

### 2-4. RequestRetryGuard — 요청 레벨 차단

**파일**: `src/requestRetryGuard.ts`  
**크기**: 58줄 / 1,761 bytes

반복으로 중단된 요청과 **동일한 요청이 즉시 재실행되는 것**을 차단한다.

```typescript
constructor(private readonly ttlMs = 2 * 60 * 1000) {} // 2분간 차단
```

#### 요청 fingerprint 계산 (`src/requestFingerprint.ts`)

```typescript
return [
    input.kind,                                    // 'prompt' | 'editMessage' 등
    normalizeText(input.prompt),                   // 정규화된 프롬프트
    normalizeText(input.modelName || ''),           // 모델명
    input.internetEnabled ? 'web:on' : 'web:off',  // 인터넷 옵션
    typeof input.messageIndex === 'number'
        ? `msg:${input.messageIndex}` : 'msg:none', // 편집 대상 메시지 인덱스
    fingerprintFiles(input.files)                   // 첨부 파일 (name:type:size)
].join('::');
```

#### 동작 흐름

1. 반복 중단 발생 → `markRepeated(request)` 호출 → fingerprint를 2분 TTL로 저장
2. 다음 요청 진입 시 `shouldBlock(request)` 호출 → 동일 fingerprint면 차단
3. 큐에 대기 중인 동일 요청도 `filterBlocked(pendingRequests)`로 일괄 제거
4. 차단 시 사용자에게 메시지 표시:  
   `> ⚠️ [LLeM] 방금 반복 중단된 요청과 같은 요청이라 잠시 다시 실행하지 않았습니다.`

---

### 2-5. ActionLoopGuard — 액션 레벨 차단

**파일**: `src/actionLoopGuard.ts`  
**크기**: 56줄 / 1,377 bytes

동일한 `create_file` 또는 `edit_file` 액션이 **반복 실행되는 것**을 차단한다.

```typescript
constructor(private readonly ttlMs = 90_000) {} // 90초간 차단
```

#### Action fingerprint 계산

```typescript
export function buildActionFingerprint(action: GuardedAction): string {
    return [
        action.kind,                       // 'create' | 'edit'
        normalizeText(action.path),         // 정규화된 파일 경로
        normalizeText(action.body)          // 정규화된 파일 내용
    ].join('::');
}
```

#### 통합 위치 (`src/actionExecutor.ts`)

모든 파일 액션 실행 전에 `shouldBlock()` 체크:

```typescript
// create_file 처리 시
if (actionLoopGuard.shouldBlock({ kind: 'create', path: action.path, body: action.body })) {
    ctx.fileResult.report.push(`⚠️ Create skipped: ${action.path} — repeated create action was blocked.`);
    continue;  // 해당 파일 작업 스킵
}
// 성공 시에만 remember
actionLoopGuard.remember({ kind: 'create', path: action.path, body: action.body });

// edit_file 처리 시도 동일하게 적용
```

---

### 2-6. FileMutationGuard — 파일 동시 수정 차단

**파일**: `src/fileMutationGuard.ts`  
**크기**: 21줄 / 566 bytes

동일한 파일에 대해 **동시에 여러 쓰기 작업이 진행되는 것**을 차단한다.

```typescript
export class FileMutationGuard {
    private activePaths = new Set<string>();

    public tryAcquire(filePath: string): boolean {
        const normalized = this.normalize(filePath);
        if (this.activePaths.has(normalized)) {
            return false;  // 이미 작업 중이면 차단
        }
        this.activePaths.add(normalized);
        return true;
    }

    public release(filePath: string): void {
        this.activePaths.delete(this.normalize(filePath));
    }
}
```

파일 경로는 `trim().toLowerCase()`로 정규화하여 대소문자/공백 차이를 무시한다.

---

### 2-7. ActionTagGuard — 액션 태그 감지

**파일**: `src/actionTagGuard.ts`  
**크기**: 6줄 / 332 bytes

AI 응답 텍스트에 액션 태그가 포함되어 있는지 빠르게 확인하는 유틸리티.

```typescript
const ACTION_TAG_PATTERN = /
    <(?:create_file|file|edit_file|edit|delete_file|delete|
    read_file|read|list_files|list_dir|ls|run_command|command|
    bash|terminal|read_url|url|fetch_url|read_brain|read_vault)
    \b|<call:/i;

export function containsActionTags(text: string): boolean {
    return ACTION_TAG_PATTERN.test(String(text || ''));
}
```

**사용처**: 설계 계획(planning) 단계의 초기 응답이 action 태그를 포함했을 때 실행을 차단하는 용도로 `chatPipeline.ts`에서 사용.

---

## 3. 전체 데이터 흐름도

```
사용자 입력 (프롬프트)
        │
        ▼
SidebarChatProvider._enqueueRequest()
  │
  ├─ [RequestRetryGuard.shouldBlock()] ──→ 차단 시 사용자 알림 후 종료
  │
  ▼
ChatPipeline.runPrompt()
  │
  ▼
streamMessages()
  │   ┌─────────────────────────────────┐
  │   │ 토큰 도착마다                    │
  │   │  RepetitionWatchdog.addToken()  │
  │   │   └─ true 반환 시:              │
  │   │       loopDetected = true       │
  │   │       abortController.abort()   │
  │   └─────────────────────────────────┘
  │
  ▼
StreamOutcome { repeated, stopReason, text }
  │
  ├─ repeated=true → postSingleLoopStopNotice()  (UI에 경고 1회 표시)
  │                  break (continuation 턴 종료)
  │
  ├─ repeated=false & turnExecuted=true
  │     → 턴 간 반복 체크 (앞 300자 비교)
  │         └─ 동일하면 turn_to_turn_loop → break
  │
  └─ 정상 완료 → executeActions() 호출
                    │
                    ▼
              ActionExecutor
                │
                ├─ [ActionLoopGuard.shouldBlock()] ──→ 차단 시 스킵
                │
                ├─ [FileMutationGuard.tryAcquire()] ──→ 실패 시 스킵
                │
                └─ 파일 작업 실행 → 성공 시 remember() / release()

결과 반환 PromptExecutionResult { repeated, stopReason }
  │
  └─ repeated=true → RequestRetryGuard.markRepeated()
                      큐 내 동일 요청 filterBlocked() 제거
```

---

## 4. 감지 임계값 / 파라미터 정리

| 파라미터 | 값 | 위치 | 설명 |
|----------|-----|------|------|
| `maxHistory` | 150 토큰 | RepetitionWatchdog constructor | 토큰 히스토리 최대 크기 |
| `minTextMatch` | 30자 | RepetitionWatchdog constructor | suffix 반복으로 인정하는 최소 길이 |
| `minTokenSequence` | 4 토큰 | RepetitionWatchdog constructor | 시퀀스 반복 감지 최소 토큰 수 |
| `fullText` 윈도우 | 2,000자 | RepetitionWatchdog.addToken() | 전체 텍스트 슬라이딩 윈도우 |
| `blockSize` | 100자 | detectRecentBlockLoop() | 블록 반복 감지 단위 크기 |
| `blockThreshold` | 3회 | detectRecentBlockLoop() | 블록 반복 감지 최소 횟수 |
| `minSentenceLength` | 40자 | detectImportantSentenceLoop() | 중요 문장 최소 길이 |
| `sentenceThreshold` | 3회 | detectImportantSentenceLoop() | 문장 반복 감지 최소 횟수 |
| `minSignificantChars` | 30자 | 공통 | 의미있는 문자 최소 수 |
| `uniqueChars` | ≥ 5종 | 공통 | 최소 unique 문자 종류 수 |
| spam 조건 | 최근 10개 중 8개 | detectSingleTokenSpam | 토큰 스팸 감지 기준 |
| `ActionLoopGuard TTL` | 90초 | ActionLoopGuard constructor | 액션 차단 유효 시간 |
| `RequestRetryGuard TTL` | 2분 | RequestRetryGuard constructor | 요청 재실행 차단 유효 시간 |
| `maxTurns` | 10턴 | chatPipeline.runPrompt() | 최대 continuation 턴 수 |
| 턴 비교 길이 | 300자 / 200자 | chatPipeline.runPrompt() | 현재/이전 턴 비교 prefix 길이 |
| 버퍼 flush 간격 | 50ms | streamMessages() | UI 청크 전송 주기 |

---

## 5. 감지 대상별 방어 레이어 매핑

| 상황 | 감지 주체 | 대응 방식 |
|------|-----------|-----------|
| 스트림 중 동일 텍스트 반복 | RepetitionWatchdog (5종) | 스트림 abort, `repeated=true` 반환 |
| 같은 Action이 여러 턴에서 반복 | ActionLoopGuard | 해당 액션 실행 스킵, 보고서에 기록 |
| 같은 파일을 동시에 두 번 수정 | FileMutationGuard | 두 번째 수정 차단 |
| 같은 요청을 즉시 재실행 | RequestRetryGuard (2분 TTL) | 큐 진입 차단, 사용자 알림 |
| 이전 턴과 현재 턴 내용 동일 | ChatPipeline 턴 비교 | continuation break |
| 계획 단계에서 액션 태그 포함 | ActionTagGuard + ChatPipeline | 액션 실행 차단, 경고 표시 |

---

## 6. 사용자에게 표시되는 메시지

| 상황 | 메시지 |
|------|--------|
| 워치독 / 반복 감지 중단 | `> ⚠️ **[LLeM] Repeating output detected. Stopping this run before it loops again.**` |
| 일반 중단 | `> ⚠️ **[LLeM] This run was stopped before continuing.**` |
| 요청 재실행 차단 | `> ⚠️ **[LLeM]** 방금 반복 중단된 요청과 같은 요청이라 잠시 다시 실행하지 않았습니다. 이유: ...` |
| 계획 응답에서 액션 태그 감지 | `> ⚠️ **[LLeM]** 첫 계획 응답에서 액션 태그가 감지되어 실행을 차단했습니다.` |
| create 차단 | 보고서: `⚠️ Create skipped: {path} — repeated create action was blocked.` |
| edit 차단 | 보고서: `⚠️ Edit skipped: {path} — repeated edit action was blocked.` |

---

## 7. 관련 파일 목록

| 파일 | 역할 | 크기 |
|------|------|------|
| `src/repetitionWatchdog.ts` | 스트림 실시간 반복 감지 엔진 | 14,295 bytes |
| `src/streamOutcome.ts` | 스트림 종료 상태 구조 정의 | 905 bytes |
| `src/requestRetryGuard.ts` | 요청 레벨 재실행 차단 | 1,761 bytes |
| `src/requestFingerprint.ts` | 요청 fingerprint 계산 | 1,334 bytes |
| `src/actionLoopGuard.ts` | 액션 레벨 반복 차단 (90초 TTL) | 1,377 bytes |
| `src/fileMutationGuard.ts` | 파일 동시 수정 차단 | 566 bytes |
| `src/actionTagGuard.ts` | 액션 태그 포함 여부 감지 | 332 bytes |
| `src/chatPipeline.ts` | 파이프라인 오케스트레이터 (워치독 통합) | 34,236 bytes |
| `src/actionExecutor.ts` | 액션 실행 + 루프 가드 통합 | 7,867 bytes |
| `src/sidebarChatProvider.ts` | 큐 관리 + RequestRetryGuard 통합 | 46,985 bytes |
| `src/assistantOutputSanitizer.ts` | 응답에서 액션 태그 제거 (최종 정리) | 1,937 bytes |

---

## 8. 기존 구현 계획 참조

설계 배경 전체는 [`plan/implementation_plan_to_fix_unlimited_iter.md`](./implementation_plan_to_fix_unlimited_iter.md)에 상세히 기록되어 있다. 현재 코드베이스는 해당 계획의 Phase 1~4가 완전히 구현된 상태다.

### 구현 완료 항목

- [x] Phase 1: StreamOutcome으로 반복 감지 구조화
- [x] Phase 2: RequestRetryGuard + RequestFingerprint로 요청 차단
- [x] Phase 3: ActionLoopGuard로 액션 반복 차단
- [x] Phase 4: FileMutationGuard로 파일 동시 수정 차단
- [x] Phase 5 (일부): designPlanningMode를 통한 계획 우선 실행 지원

---

## 9. 실제 로그 분석 결과 (2026-05-04 stream-debug.log)

> 로그 파일: `~/Library/Application Support/Antigravity/User/globalStorage/nick.llem/diagnostics/`  
> 분석 범위: `stream-debug-2026-05-04.log` (205,356줄), `stream-debug-2026-05-03.log` (44,117줄)

### 9-1. 전체 수치 요약

| 항목 | 수치 |
|------|------|
| 오늘(05-04) 전체 스트림 수 | **110개** (supergemma4 102개, gemma4-e4b 계열 8개) |
| 정상 완료 finalize | **61건** |
| 반복 감지로 중단 | **26건** (비율 약 30%) |
| `[WATCHDOG] Loop detected` | **8건** |
| `[STREAM] repetition_detected` | **18건** |
| 이미지 입력 오류 (500) | **2건** |
| 모델 로드 실패 (500) | **2건** |

### 9-2. 반복 감지 유형 분류

오늘 WATCHDOG가 직접 잡은 8건 전부 **sequence loop**였다:

| 감지 유형 | 횟수 | 예시 |
|-----------|------|------|
| `sequence loop (len=5)` | 4건 | CSS 속성 시퀀스 반복 |
| `sequence loop (len=6)` | 3건 | 코드 토큰 시퀀스 반복 |
| `sequence loop (len=30)` | 1건 | 긴 패턴 반복 |

> **결론**: suffix loop나 block loop는 한 번도 발동되지 않았다. 실제 발화점은 **항상 Token Sequence Loop** 뿐이다.

### 9-3. 핵심 발견: 반복 출력 후 컨텍스트 오염 연쇄 (02:32~03:12 사례)

로그에서 **40분간 11개 스트림이 연속으로 반복 중단**되는 패턴이 관찰되었다.

```
02:31:34  moql2hnu  ← 시작 (messages=20, total=24,289자)
02:32:39  [WATCHDOG] Loop detected (sequence loop)
02:32:39  moql3vqw  ← 즉시 재시작 (messages=15, total=26,918자)  ← ❌ 반복 중단 텍스트 3,790자 포함
02:34:07  repetition_detected
02:34:07  moql5rnv  ← 즉시 재시작 (messages=11, total=26,244자)  ← ❌ 반복 중단 텍스트 4,949자 포함
02:36:20  repetition_detected
...
03:08:50  moqm9ew1  (messages=5, total=27,852자)  ← ❌ user 메시지 369자가 2번 삽입
03:12:17  repetition_detected
03:12:17  moqmeeyn  (messages=5, total=27,852자)  ← ❌ 완전히 동일한 컨텍스트로 재시작
```

#### 근본 원인 A: 반복 중단된 응답이 히스토리에 그대로 남음

반복 감지로 중단된 AI 응답(3,790자 ~ 9,081자 분량)이 **대화 히스토리(ChatSession)에서 제거되지 않은 채** 다음 스트림의 `messages` 배열 assistant 메시지로 그대로 전달되고 있다.

```
moqlix4u request_start:
  index=6  role=assistant  charLength=8281  ← 이전 반복 중단 응답
  index=7  role=user       charLength=500   ← 새 user 요청
```

이 상태에서 supergemma4-safe 모델은 8,000자짜리 반복 패턴을 **정상적인 이전 응답으로 착각**하고 동일 패턴을 이어서 생성한다.

#### 근본 원인 B: 중복 user 메시지 삽입 (Observation 이중 등록)

로그에서 **동일한 charLength를 가진 user 메시지가 연속 2개씩 삽입**되는 패턴이 19건 발견되었다:

```
moqok115 request_start:
  index=4  role=user  charLength=2639
  index=5  role=user  charLength=2639   ← 완전 동일 메시지 중복!
```

`buildContinuationSystemMessage()` 또는 observation 삽입 로직에서 **이미 큐에 등록된 observation이 다시 삽입**되고 있을 가능성이 높다.

#### 근본 원인 C: gemma4 계열의 image input 오류 후 컨텍스트 누적

```
04:10:28  [ERROR] Extension error: ⚠️ API detail: this model is missing data required for image input
04:10:51  [ERROR] Extension error: ⚠️ API detail: this model is missing data required for image input
```

`supergemma4-safe:latest` 모델에 **이미지 데이터가 포함된 메시지**가 전달되면서 500 오류가 발생했다. 이후 모델을 `gemma4-e4b-it-q8.0-code:latest`로 전환했으나, 오류 직전의 오염된 컨텍스트(78자짜리 user 메시지 2개, 10자 메시지 3개)가 그대로 이어졌다.

### 9-4. 연쇄 반복 발생 시 컨텍스트 크기 변화

```
Stream 1: totalChars = 24,289  (messages=20)
Stream 2: totalChars = 26,918  (messages=15)  +2,629
Stream 3: totalChars = 26,244  (messages=11)  -674 (메시지 정리 시도)
Stream 6: totalChars = 27,592  (messages=8)   +1,348
Stream 9: totalChars = 26,696  (messages=10)
Stream 10: totalChars = 27,852  (messages=5)
Stream 11: totalChars = 27,852  (messages=5)   ← 완전히 동일한 컨텍스트 반복 시작!
```

> **contextWindow=32,768** 대비 27,852자면 약 85% 이미 차있는 상태. 이 지점에서 모델이 가장 불안정해진다.

### 9-5. 오늘 발견된 버그 요약

| # | 버그 | 위치 추정 | 증거 |
|---|------|-----------|------|
| **B-1** | 반복 중단 응답이 히스토리에 잔류 | `chatSession.ts` 또는 `chatPipeline.ts` | moql~moqm 구간 전체: 이전 반복 응답이 assistant 메시지로 존재 |
| **B-2** | 동일 user 메시지 중복 삽입 | `chatPipelineHelpers.ts` 또는 observation 처리 | 19개 스트림에서 동일 charLength user 메시지 2개 연속 |
| **B-3** | 이미지 context가 텍스트 전용 모델에 전달 | `contextBuilder.ts` 또는 `aiClient.ts` | `missing data required for image input` 오류 2건 |
| **B-4** | RequestRetryGuard 우회 — 컨텍스트 변경으로 fingerprint 달라짐 | `requestRetryGuard.ts` + `requestFingerprint.ts` | 반복 후 user msg가 추가되어 fingerprint 변경, 재진입 허용 |

### 9-6. 권장 수정 방향

#### 즉시 수정 (High Priority)

1. **B-1 수정**: `chatPipeline.ts`에서 `repeated=true`인 스트림 완료 후, 해당 assistant 응답을 **ChatSession에서 제거**하거나 `[ABORTED]` 마킹하여 다음 요청에 전달하지 않도록 처리.

   ```typescript
   if (streamOutcome.repeated) {
       session.removeLastAssistantMessage(); // 또는 플래그 처리
   }
   ```

2. **B-2 수정**: `buildContinuationSystemMessage()` 또는 observation 삽입 전에 **이미 큐에 동일 내용이 있는지 deduplicate** 체크 추가.

3. **B-3 수정**: `contextBuilder.ts` 또는 `aiClient.ts`에서 모델의 멀티모달 지원 여부를 확인하고, 미지원 모델에는 이미지 메시지를 텍스트로 변환하거나 제거.

#### 중기 개선 (Medium Priority)

4. **B-4 수정**: RequestRetryGuard의 fingerprint를 **프롬프트 기반**이 아닌 **대화 히스토리 해시 기반**으로 강화. 사용자 메시지가 추가되어 fingerprint가 바뀌더라도 동일 주제가 감지되면 차단.

5. **컨텍스트 크기 경고**: contextWindow의 80% 이상 사용 시 (`≥ 26,214자 / 32,768`), 대화 히스토리를 자동으로 trim하거나 사용자에게 경고 표시.

---

## 10. 최종 요약 및 우선순위 정리

### 핵심 결론

> 현재 구현된 RepetitionWatchdog / ActionLoopGuard / RequestRetryGuard는 **감지 자체는 정상 작동**하고 있다.  
> 그러나 감지 후 **컨텍스트 정리가 누락**되어 오염된 히스토리가 다음 요청으로 전파되는 것이 진짜 문제다.

### 오늘 하루 통계 (2026-05-04)

| 항목 | 수치 |
|------|------|
| 전체 스트림 수 | 110개 |
| 정상 완료 | 61건 |
| **반복 감지 중단** | **26건 (약 30%)** |
| WATCHDOG 발동 유형 | 100% sequence loop (len=5~30) |
| suffix / block / sentence loop | **0건** — 한 번도 발동 안 됨 |
| 중복 user 메시지 삽입 발견 | 19건 |
| 이미지 입력 오류 | 2건 |

### 버그 우선순위

| 순위 | 버그 ID | 설명 | 예상 개선 효과 |
|------|---------|------|----------------|
| 🔴 1순위 | **B-1** | 반복 중단 응답이 히스토리에 잔류 → 연쇄 반복 폭탄 유발 | 반복 중단 사례의 약 85% 해소 |
| 🔴 2순위 | **B-2** | 동일 user 메시지 2개씩 중복 삽입 | 컨텍스트 오염 직접 원인 제거 |
| 🟡 3순위 | **B-3** | 이미지 context → 텍스트 전용 모델 전달 → 500 오류 | 모델 교체 후 컨텍스트 누적 방지 |
| 🟡 4순위 | **B-4** | RequestRetryGuard fingerprint 우회 | 즉시 재실행 차단 강화 |
| 🟢 5순위 | 최적화 | suffix/block/sentence loop 미발동 — 임계값 조정 검토 | 오탐 감소 / 조기 감지 강화 |

### 가장 시급한 1줄 수정

`chatPipeline.ts`에서 `streamOutcome.repeated === true`일 때:

```typescript
// 반복 중단된 assistant 응답을 히스토리에서 제거
if (streamOutcome.repeated) {
    session.removeLastAssistantMessage();
}
```

이것만 적용해도 **02:32~03:12 구간의 40분간 연쇄 반복 폭탄** 현상은 차단 가능하다.

---

## 11. edit_file이 코드를 보여줬는데 실제 파일이 안 바뀌는 이유

### 핵심 코드 (fileActions.ts L144~153)

```typescript
for (let i = 0; i < edited.missingTargets; i += 1) {
    report.push(`⚠️ ${relPath}: could not find the target text.`);
}

if (edited.editCount === 0) {
    return {
        report,                    // ⚠️ 경고만 추가하고
        workspaceModified: false,  // ← 파일 수정 없이 조용히 종료!
        brainModified: false
    };
}
```

### 3가지 실패 시나리오

| 상황 | 코드 흐름 | 결과 |
|------|-----------|------|
| `<find>` 텍스트가 현재 파일과 한 글자라도 다를 때 | `result.includes(findText) === false` → `missingTargets++` | ⚠️ 경고만, 파일 불변 |
| `editCount === 0` | early return | 파일 불변, AI는 성공으로 착각 |
| 스트림이 반복으로 abort될 때 | action 태그가 잘려서 파싱 실패 | action 자체가 실행 안 됨 |

### 근본 원인

AI가 `<find>` 블록을 생성할 때 **현재 실제 파일 내용을 정확히 모른다.**

- 이전 턴에서 파일을 읽었지만 그 사이에 파일이 바뀌었거나
- 공백·줄바꿈이 조금만 달라도 `String.includes()` 매칭 실패
- → `workspaceModified: false`
- → **AI는 다음 턴에 "또 수정하겠다"고 재시도 → 무한반복**

---

## 12. 해결책: FileStateGuard (수정 전후 hash 비교)

### 아이디어

```
수정 전 파일 hash  →  edit 실행  →  수정 후 파일 hash
          같으면 = 파일이 실제로 안 바뀜 = 루프 신호
```

### 현재 ActionLoopGuard의 맹점

```typescript
// 현재: action의 body(패치 내용)로 fingerprint
buildActionFingerprint = kind :: path :: body(패치 텍스트)
```

AI가 `<find>` 텍스트를 조금만 바꿔도 fingerprint가 달라져 **90초 차단을 우회한다.**  
실제 파일 결과물은 동일한데도 차단이 안 된다.

### 기존 방식 vs 제안 방식 비교

| | 현재 ActionLoopGuard | 제안: FileStateGuard |
|---|---|---|
| 비교 기준 | 패치 body 텍스트 hash | 실제 파일 내용 hash |
| find 실패 감지 | ❌ 못 잡음 (body가 다르면 통과) | ✅ 즉시 감지 |
| AI 우회 가능성 | 높음 (body 조금만 달리해도) | 없음 (파일 결과물 기준) |
| TTL | 90초 | 5분 (연속 편집 허용) |
| 구현 복잡도 | 낮음 | 낮음 (SHA-256만 추가) |

### 설계 코드 (`src/fileStateGuard.ts` — 신규)

```typescript
import * as crypto from 'crypto';
import * as fs from 'fs';

export class FileStateGuard {
    // path → { hash, noEffectCount, timestamp }
    private snapshots = new Map<string, { hash: string; noEffectCount: number; ts: number }>();
    private readonly ttlMs: number;
    private readonly maxNoEffect: number;

    constructor(ttlMs = 5 * 60 * 1000, maxNoEffect = 3) {
        this.ttlMs = ttlMs;
        this.maxNoEffect = maxNoEffect; // 3회 연속 무효 편집 → 루프로 간주
    }

    /** 수정 실행 전 현재 hash를 기록 */
    snapshot(filePath: string): void {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const hash = crypto.createHash('sha256').update(content).digest('hex');
            const existing = this.snapshots.get(filePath);
            this.snapshots.set(filePath, {
                hash,
                noEffectCount: existing?.noEffectCount ?? 0,
                ts: Date.now()
            });
        } catch { /* 파일 없으면 무시 */ }
    }

    /**
     * 수정 실행 후 호출.
     * @returns 'effective' | 'no-effect' | 'loop-detected'
     */
    checkResult(filePath: string): 'effective' | 'no-effect' | 'loop-detected' {
        const prev = this.snapshots.get(filePath);
        if (!prev) return 'effective';
        if (Date.now() - prev.ts > this.ttlMs) {
            this.snapshots.delete(filePath);
            return 'effective';
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const currentHash = crypto.createHash('sha256').update(content).digest('hex');

            if (currentHash !== prev.hash) {
                // 파일이 실제로 바뀜 → 정상 편집, 카운터 리셋
                this.snapshots.set(filePath, { hash: currentHash, noEffectCount: 0, ts: Date.now() });
                return 'effective';
            }

            // 파일이 안 바뀜 → 무효 편집 카운트 증가
            const noEffectCount = prev.noEffectCount + 1;
            this.snapshots.set(filePath, { ...prev, noEffectCount });

            if (noEffectCount >= this.maxNoEffect) {
                return 'loop-detected'; // 3회 연속 무효 → 루프
            }
            return 'no-effect'; // 경고만
        } catch {
            return 'effective';
        }
    }

    clearPath(filePath: string): void {
        this.snapshots.delete(filePath);
    }
}
```

### actionExecutor.ts 통합 위치

```typescript
// actionExecutor.ts — edit 핸들러 내부 (수정안)
const fileStateGuard = new FileStateGuard();

for (const action of parseEditActions(ctx.aiMessage)) {
    if (actionLoopGuard.shouldBlock({ kind: 'edit', path: action.path, body: action.body })) {
        ctx.fileResult.report.push(`⚠️ Edit skipped: ${action.path} — repeated edit action was blocked.`);
        continue;
    }

    // 1. 수정 전 hash 스냅샷
    const resolvedPath = (await resolveActionPath(ctx.rootPath, action.path)).absPath;
    fileStateGuard.snapshot(resolvedPath);

    const result = await executeEditFileAction(action.path, action.body, rel => resolveActionPath(ctx.rootPath, rel));
    applyFileActionResult(ctx, result);

    // 2. 수정 후 hash 비교
    const editEffect = fileStateGuard.checkResult(resolvedPath);

    if (editEffect === 'no-effect') {
        ctx.fileResult.report.push(
            `⚠️ Edit had no effect: ${action.path} — file content unchanged. ` +
            `The <find> text may not match the current file.`
        );
    } else if (editEffect === 'loop-detected') {
        ctx.fileResult.report.push(
            `🛑 Edit loop detected: ${action.path} — same file edited 3 times with no change. Blocking further edits.`
        );
        // ActionLoopGuard에도 등록해서 다음 턴도 차단
        actionLoopGuard.remember({ kind: 'edit', path: action.path, body: action.body });
        break; // 이 파일에 대한 이후 edit 모두 중단
    } else {
        // 정상 편집 성공 시에만 ActionLoopGuard에 기록
        if (!result.report.some(item => item.includes(`❌`))) {
            actionLoopGuard.remember({ kind: 'edit', path: action.path, body: action.body });
        }
    }
}
```

### 예상 효과

1. **`<find>` 매칭 실패 즉시 감지**: `missingTargets > 0`이면 파일 hash가 같으므로 `no-effect` 반환
2. **AI 재시도 루프 차단**: 3회 연속 무효 편집 시 `loop-detected`로 전환하여 ActionLoopGuard에 등록
3. **보고서에 명확한 이유 표시**: AI가 다음 턴에 원인을 파악하고 `<read_file>`로 재확인 후 올바른 `<find>` 생성 가능

### 주의사항 — 정당한 2번 편집 허용

같은 파일을 **정당하게 여러 번 편집**하는 경우 (1턴: import 추가, 2턴: 로직 추가)도 있으므로:

- hash 동일 → **즉시 전체 중단 ❌**
- hash 동일이 **3회 연속**일 때만 → 루프로 간주 ✅
- 한 번이라도 파일이 바뀌면 (`effective`) → `noEffectCount` 리셋
