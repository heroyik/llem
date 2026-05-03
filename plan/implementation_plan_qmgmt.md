# Queue Management Implementation Plan

현재 LLeM의 채팅 흐름은 한 번에 하나의 요청만 처리하도록 설계되어 있습니다. 웹뷰에서는 `sending` 상태가 `true`일 때 추가 전송을 막고, 확장 호스트와 `ChatPipeline`은 들어온 요청을 즉시 실행합니다. 이 구조는 단순하고 안정적이지만, live output이 진행 중일 때 다음 요청을 미리 쌓아두거나, 대기 중 요청을 취소하는 기능은 제공하지 못합니다.

이 문서는 다음 목표를 달성하기 위한 구현 계획을 정리합니다.

- live output 진행 중 새 요청을 보내면 즉시 실행하지 않고 큐에 적재
- 현재 요청이 끝나면 다음 요청을 자동 실행
- 큐에 있는 요청을 개별 취소 가능하게 지원
- `prompt`, `promptWithFile`, `editMessage`, `regenerate`를 공통 요청 모델로 통합
- 새 채팅, 히스토리 로드, 스트림 중지와 큐가 충돌하지 않도록 정책 정립

## 1. Current State Analysis

현재 요청 실행 흐름은 아래와 같습니다.

1. 웹뷰 [src/webview/main.ts](/Users/nick/proj/llem/src/webview/main.ts:1341) 의 `send()`가 `prompt` 또는 `promptWithFile` 메시지를 전송합니다.
2. 라우터 [src/webviewMessageRouter.ts](/Users/nick/proj/llem/src/webviewMessageRouter.ts:25) 가 이를 `SidebarChatProvider`로 전달합니다.
3. [src/sidebarChatProvider.ts](/Users/nick/proj/llem/src/sidebarChatProvider.ts:696) 의 `_handlePrompt()` / `_handlePromptWithFile()` 가 즉시 `ChatPipeline` 실행으로 이어집니다.
4. [src/chatPipeline.ts](/Users/nick/proj/llem/src/chatPipeline.ts:108) 에서 user message를 history/display 상태에 push하고, `streamStart`, `streamChunk`, `streamEnd`, `streamAbort` 메시지로 웹뷰를 갱신합니다.
5. 웹뷰는 [src/webview/main.ts](/Users/nick/proj/llem/src/webview/main.ts:773) 의 `sending` 플래그로 입력을 막고, 스트림 종료 시 `setSending(false)` 합니다.

문제는 이 구조에 “대기 중 요청”을 저장하는 계층이 없다는 점입니다. 따라서 큐 관리 기능은 단순 UI 수정이 아니라, 확장 호스트를 중심으로 한 상태 관리 구조 추가가 필요합니다.

## 2. Design Principles

이번 구현에서 지켜야 할 원칙은 아래와 같습니다.

- 큐의 source of truth는 웹뷰가 아니라 확장 호스트가 가진다.
- `ChatPipeline`은 단일 요청 실행기로 유지하고, 큐 스케줄링은 `SidebarChatProvider`가 담당한다.
- 대기 중 요청은 아직 대화 기록에 반영하지 않는다.
- 실제 실행이 시작되는 시점에만 user message와 attachment를 chat history/display history에 기록한다.
- 현재 실행 중 요청 취소와 대기 중 요청 취소는 명확히 분리한다.
- `editMessage`와 `regenerate`도 일반 prompt와 같은 큐 시스템에 포함한다.

## 3. Target Behavior

구현 완료 후 기대 동작은 다음과 같습니다.

### 3.1 Basic Queueing

- 요청 A가 live output 중일 때 요청 B를 보내면 B는 큐에 추가된다.
- 요청 A가 완료되거나 중단되면 요청 B가 자동으로 실행된다.
- 큐는 FIFO 순서로 동작한다.

### 3.2 Cancellation

- `Stop` 버튼은 현재 실행 중인 요청만 중단한다.
- 아직 실행되지 않은 큐 항목은 개별 `Cancel` 버튼으로 제거할 수 있다.
- 필요하면 전체 큐 비우기 기능을 확장 포인트로 남겨둔다.

### 3.3 Request Types

다음 요청 종류 모두 큐에 들어갈 수 있어야 한다.

- 일반 텍스트 prompt
- 파일 첨부 prompt
- regenerate
- edit message

### 3.4 Conflict Policy

다음 액션은 active stream 또는 pending queue와 충돌 가능성이 높다.

- new chat
- history load
- clear chat

1차 구현에서는 아래 정책을 권장한다.

- 새 채팅 또는 히스토리 로드 시 active request가 있으면 먼저 중단한다.
- pending queue는 비운다.
- 그 다음 clear/load를 진행한다.

이 정책은 구현이 가장 단순하고, 숨은 상태 충돌을 줄여준다.

## 4. Queue Domain Model

공통 요청 모델을 새로 정의한다.

예상 필드:

- `id: string`
- `kind: 'prompt' | 'promptWithFile' | 'editMessage' | 'regenerate'`
- `prompt: string`
- `modelName: string`
- `files?: AttachedFile[]`
- `internetEnabled?: boolean`
- `messageIndex?: number`
- `createdAt: number`

선택적으로 UI 표시에 유용한 파생 필드도 둘 수 있다.

- `attachmentCount`
- `previewText`
- `sourceLabel`

이 타입은 `src/types.ts` 또는 전용 `queueTypes.ts`에 두어 웹뷰와 호스트가 함께 사용하도록 한다.

## 5. Host-Side Queue Ownership

큐는 `SidebarChatProvider`가 소유한다. 현재도 다음 책임이 이미 이 파일에 모여 있기 때문이다.

- 웹뷰 메시지 라우팅
- abort controller 보관
- 스트림 시작/종료 전후 수명주기
- history/session 조작

### 5.1 New State

[src/sidebarChatProvider.ts](/Users/nick/proj/llem/src/sidebarChatProvider.ts) 에 아래 상태를 추가한다.

- `private _activeRequest?: QueuedRequest`
- `private _pendingRequests: QueuedRequest[] = []`
- `private _isProcessingQueue = false`

`_isProcessingQueue`는 중복 실행 방지용이다. `runNextRequestIfIdle()`가 여러 이벤트에서 호출될 수 있기 때문에 필요하다.

### 5.2 New Methods

추가 메서드:

- `_enqueueRequest(request: QueuedRequest): Promise<void>`
- `_runNextRequestIfIdle(): Promise<void>`
- `_executeQueuedRequest(request: QueuedRequest): Promise<void>`
- `_cancelQueuedRequest(id: string): Promise<void>`
- `_clearQueuedRequests(): Promise<void>`
- `_syncQueueStateToWebview(): void`
- `_buildQueuedRequest(...)`

핵심 책임은 다음과 같이 나뉜다.

- `_enqueueRequest`는 요청 생성과 배열 push 담당
- `_runNextRequestIfIdle`는 active가 없을 때 다음 request dequeue 담당
- `_executeQueuedRequest`는 실제 `ChatPipeline` 호출 담당
- `_syncQueueStateToWebview`는 웹뷰 상태 동기화 담당

## 6. Execution Flow Refactor

현재는 `_handlePrompt`, `_handlePromptWithFile`, `_editMessage`, `_regenerate`가 직접 실행 경로에 들어간다. 이를 큐 기반으로 바꾼다.

### 6.1 New Unified Flow

새 흐름:

1. 웹뷰가 요청 메시지 전송
2. `SidebarChatProvider`가 공통 `QueuedRequest` 생성
3. `_enqueueRequest()`
4. `_syncQueueStateToWebview()`
5. `_runNextRequestIfIdle()`
6. idle이면 즉시 실행, 아니면 pending 상태 유지

### 6.2 Why Not Put Queue Logic in ChatPipeline

`ChatPipeline`은 다음 이유로 큐 책임을 가지지 않는 것이 좋다.

- 현재 단일 요청 처리 로직이 이미 응집되어 있음
- queue scheduling은 UI 상태, abort, history branching과 더 가깝다
- pipeline 내부에 큐를 넣으면 `editMessage`, `newChat`, `loadHistory` 같은 상위 문맥 처리와 결합도가 커진다

따라서 `ChatPipeline`은 “한 요청을 받아 실행하는 executor”로 유지한다.

## 7. Request Lifecycle Rules

### 7.1 Enqueue Timing

사용자가 요청을 보냈을 때:

- active request가 없으면 곧바로 실행 대상으로 승격
- active request가 있으면 pending queue에 추가

### 7.2 History Write Timing

중요한 규칙:

- enqueue 시점에는 `chatHistory`, `displayMessages`에 넣지 않는다.
- 실제 실행 시작 직전에만 기존 `ChatPipeline.runPrompt()`가 history push를 수행한다.

이렇게 해야 “실행되지 않은 queued request”가 대화 기록에 섞이지 않는다.

### 7.3 Completion Handling

`_executeQueuedRequest()`는 `try/finally` 구조로 감싸야 한다.

- `try`: 실제 request 실행
- `finally`: `_activeRequest` 해제, 웹뷰 queue state 동기화, 다음 request 실행 시도

정상 완료, abort, error 모두 같은 finally 경로로 모아야 다음 request 자동 실행이 안정적으로 동작한다.

## 8. Special Handling by Request Type

### 8.1 Prompt / PromptWithFile

일반 prompt와 파일 첨부 prompt는 가장 단순하다.

- enqueue 시 요청 객체만 저장
- dequeue 시 `_chatPipeline.handlePrompt...` 실행

### 8.2 Regenerate

현재는 웹뷰에서 즉시 `regenerate` 메시지를 보내고 바로 로더와 `sending` 상태를 켠다. 큐 도입 후에는 다음처럼 바꾼다.

- idle이면 즉시 실행
- busy이면 regenerate request를 큐에 적재

regenerate도 일반 request처럼 `QueuedRequest.kind = 'regenerate'`로 통일한다.

### 8.3 Edit Message

이 항목이 가장 중요하다. 현재 [src/sidebarChatProvider.ts](/Users/nick/proj/llem/src/sidebarChatProvider.ts:762) 의 `_editMessage()`는 branch를 즉시 만들고 `clearChat` 후 실행한다.

큐 도입 후에는 branch 생성 시점을 늦춰야 한다.

- enqueue 시에는 `messageIndex`, `prompt`, `files`만 저장
- 실제 dequeue 시점에 branch 생성
- 그 다음 `clearChat`, `restoreDisplayMessages`, 새 prompt 실행

이렇게 해야 큐 대기 중 히스토리 상태가 바뀌어도 일관성이 유지된다.

## 9. Webview Behavior Changes

현재 [src/webview/main.ts](/Users/nick/proj/llem/src/webview/main.ts:1341) 의 `send()`는 `sending`이면 그냥 return 한다. 이를 큐 친화적으로 바꿔야 한다.

### 9.1 New Send Semantics

- idle 상태면 기존처럼 즉시 요청 전송
- busy 상태면 enqueue 메시지 전송
- 웹뷰는 host가 내려준 `queueState`를 보고 현재 상태를 렌더링

### 9.2 Do Not Add Queued User Messages Directly to Chat Timeline

대기 중 요청을 바로 chat timeline에 user message로 넣으면 다음 문제가 생긴다.

- 실제 실행 순서와 타임라인 표시 순서가 어긋남
- queued edit/regenerate가 일반 user message처럼 보이며 혼란을 줌
- 여러 queued item이 쌓일 경우 active response와 시각적으로 섞임

따라서 queued item은 별도의 큐 UI에 표시하고, 실제 실행 시작 시점에만 정식 메시지로 대화 타임라인에 추가하는 방식을 사용한다.

## 10. Queue UI Plan

큐 UI는 입력창 근처에 작은 패널로 두는 것을 권장한다.

이유:

- 현재 스트림 셸과 대화 타임라인을 오염시키지 않음
- 사용자에게 “지금 실행 중인 것”과 “대기 중인 것”을 분리해 보여주기 쉬움
- 개별 취소 버튼 배치가 자연스러움

### 10.1 UI Contents

표시 항목:

- 현재 실행 중 요청 요약
- 대기 중 요청 수
- 대기열 항목 리스트
- 각 항목의 `Cancel` 버튼
- 선택적으로 `Clear Queue` 버튼

각 큐 항목은 최소한 다음 정보를 보여준다.

- request kind
- prompt preview
- attachment count
- selected model
- queued time

### 10.2 Suggested Rendering Location

후보:

- 입력창 위
- thinking bar 아래
- chat 영역 상단 고정 패널

1차 구현에서는 입력창 위 또는 thinking bar 아래가 가장 적절하다.

## 11. New Webview Message Contract

웹뷰와 호스트 간 새 메시지 타입이 필요하다.

### 11.1 Webview → Host

- `enqueuePrompt`
- `enqueuePromptWithFile`
- `enqueueRegenerate`
- `enqueueEditMessage`
- `cancelQueuedRequest`
- `clearQueuedRequests`

또는 더 단순하게:

- `enqueueRequest`
- `cancelQueuedRequest`
- `clearQueuedRequests`

로 통합해도 된다. 1차 구현은 통합 메시지 하나가 유지보수에 더 좋다.

### 11.2 Host → Webview

- `queueState`

예상 payload:

- `activeRequest`
- `pendingRequests`
- `running`

필요하면 보조 메시지를 둘 수 있다.

- `queueRequestAccepted`
- `queueRequestCanceled`

하지만 1차 구현에서는 `queueState` 하나만 보내도 충분하다.

## 12. Stop vs Cancel Semantics

이 둘은 반드시 분리해야 한다.

### 12.1 Stop

- 대상: 현재 실행 중 요청
- 구현: 기존 `_abortController.abort()`
- 결과: 현재 요청만 중단

### 12.2 Cancel

- 대상: 아직 시작되지 않은 pending queue 항목
- 구현: 배열에서 제거
- 결과: chat history에는 애초에 들어가지 않았으므로 별도 롤백 불필요

이 구분이 명확해야 사용자가 “왜 대기열 항목이 stop으로 안 없어지지?” 같은 혼란을 겪지 않는다.

## 13. Conflict Handling Policy

### 13.1 New Chat / Load History

권장 정책:

1. active request가 있으면 abort
2. pending queue 비움
3. queue state 웹뷰 동기화
4. `clearChat` 또는 `loadHistory` 진행

이 흐름은 1차 구현에서 가장 안전하다.

### 13.2 Clear Chat

`clearChat`는 웹뷰 UI 초기화만이 아니라 queue reset과도 연결돼야 한다.

- active request 중이면 abort
- pending queue 비움
- 웹뷰 `clearChat`
- 웹뷰 `queueState`도 빈 상태로 동기화

### 13.3 Restore Messages

세션 복원 시 queue는 복원 대상에 포함하지 않는 것이 바람직하다.

이유:

- queued request는 아직 실행되지 않은 임시 상태
- 세션 persistence에 포함하면 예기치 않은 재실행 위험이 생김

따라서 queue는 메모리 상태로만 유지한다.

## 14. Error and Abort Policy

한 요청이 실패하거나 중단된 뒤 다음 queued request를 어떻게 처리할지도 명시해야 한다.

1차 권장 정책:

- error 발생 후에도 다음 queue는 계속 진행
- user stop으로 abort되어도 다음 queue는 계속 진행

이 정책은 FIFO job queue로서 예측 가능성이 가장 높다.

확장 가능 옵션:

- “stop 시 전체 queue도 멈춤”
- “error 발생 시 queue pause”

하지만 1차 구현에서는 복잡도를 줄이기 위해 자동 진행을 기본값으로 한다.

## 15. Implementation Steps

### Step 1. Introduce Shared Queue Types

- `QueuedRequest` 타입 추가
- 필요 시 `QueueStatePayload` 타입 추가

### Step 2. Add Queue State to SidebarChatProvider

- `_activeRequest`
- `_pendingRequests`
- `_isProcessingQueue`
- queue helper methods

### Step 3. Refactor Request Entry Points

- `_handlePrompt`
- `_handlePromptWithFile`
- `_regenerate`
- `_editMessage`

이 네 경로를 모두 “request 생성 → enqueue” 흐름으로 바꾼다.

### Step 4. Add Queue Execution Scheduler

- idle일 때 자동 dequeue
- request 완료/중단/에러 후 다음 요청 실행

### Step 5. Extend Webview Message Router

- `enqueueRequest`
- `cancelQueuedRequest`
- `clearQueuedRequests`

### Step 6. Add Queue UI to Webview

- queue state 렌더링
- cancel button wiring
- active/pending summary

### Step 7. Update Webview Send Logic

- `sending`이면 return 하지 말고 queue 전송
- queued request는 chat timeline 대신 queue panel에 표시

### Step 8. Add Conflict Cleanup Hooks

- new chat
- load history
- clear chat

이 세 경로에서 queue cleanup 동작 추가

### Step 9. Validate End-to-End

- normal prompt queue
- attached file queue
- edit queue
- regenerate queue
- cancel pending item
- stop active item
- new chat during active stream

## 16. Testing Checklist

필수 시나리오:

1. 요청 A 실행 중 요청 B 추가 시 B가 pending queue에 보이는가
2. A 완료 후 B가 자동 시작되는가
3. A 실행 중 B, C 추가 시 FIFO 순서가 유지되는가
4. pending B 취소 시 C만 남는가
5. A 실행 중 stop 시 A만 중단되고 B가 이어서 실행되는가
6. A 실행 중 regenerate 시 queue에 들어가는가
7. A 실행 중 edit message 시 queue에 들어가고 실행 시 branch가 생성되는가
8. 첨부 파일이 포함된 queued request가 실행 시 정상 복원되는가
9. model/internet 옵션이 queued request에 보존되는가
10. new chat/load history 시 active/pending 상태가 깨끗하게 정리되는가

## 17. Risks and Watch Points

### 17.1 Timeline Consistency

queued request를 너무 일찍 display history에 넣으면 메시지 순서가 어긋날 수 있다. 이 부분은 반드시 “실행 시작 시 기록” 원칙을 지켜야 한다.

### 17.2 Edit Branch Timing

`editMessage`는 enqueue 시점 branch 생성 금지. dequeue 시점 생성으로 미뤄야 한다.

### 17.3 Webview as Non-Authoritative State

웹뷰는 렌더링 계층일 뿐이다. queue 상태를 웹뷰 내부 배열만으로 관리하면 `clearChat`, restore, webview refresh에서 상태가 깨질 수 있다.

### 17.4 Abort Controller Lifecycle

queue 전환 타이밍에서 이전 request의 abort controller를 정확히 비우지 않으면 다음 요청에 잘못 연결될 수 있다.

## 18. Recommended Scope for First Pass

1차 구현에서는 아래 범위만 완료해도 충분히 가치가 크다.

- prompt / promptWithFile queueing
- pending queue cancel
- regenerate queueing
- host-owned queue state
- simple queue panel UI

그리고 다음 라운드로 넘겨도 되는 항목:

- clear queue 버튼
- queue persistence
- queue reorder
- queue pause/resume
- 고급 에러 정책

## 19. Final Recommendation

가장 중요한 결정은 큐를 `SidebarChatProvider` 중심의 host-owned scheduler로 두고, `ChatPipeline`은 단일 실행기로 유지하는 것입니다. 이 방향이 현재 코드 구조와 가장 잘 맞고, `editMessage`, `regenerate`, `newChat`, `loadHistory` 같은 상위 동작과의 충돌도 가장 자연스럽게 처리할 수 있습니다.

다음 구현 단계에서는 먼저 `QueuedRequest` 타입과 `SidebarChatProvider`의 queue state/method를 추가한 뒤, 웹뷰 `send()` 로직과 `queueState` UI를 연결하는 순서로 진행하는 것이 가장 안전합니다.
