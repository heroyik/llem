# Gemma6:26B Local Performance Optimization Implementation Plan

## 1. 목적

이 문서는 LLeM이 `gemma6:26b` 또는 그에 준하는 `24B+`급 로컬 모델을 사용할 때,
기존보다 더 빠르고 안정적으로 응답하도록 만드는 구현 계획서다.

핵심 목표는 다음 3가지다.

1. 첫 토큰 지연(`first-token latency`)을 줄인다.
2. 프롬프트 크기를 줄여 긴 컨텍스트에서 생기는 느려짐과 실패 확률을 낮춘다.
3. 사용자가 문제를 진단할 수 있도록 성능 계측값을 더 자세히 노출한다.

이 문서는 “다음에 이 계획만 보고도 구현할 수 있도록” 작성되며,
설정 스키마, 내부 타입, 실제 로직 흐름, 테스트 범위, 수동 검증 절차까지 포함한다.

---

## 2. 대상 환경과 가정

### 기본 대상 환경

- 머신: Apple Silicon 계열
- 기준 장비: `Apple M5 / 34GB RAM`
- 엔진: `Ollama`
- 모델 클래스: `24B+`급 Gemma 계열 (`gemma6:26b`, `25.2B`, `26b` 표기 포함)

### 가정

- 실제 로컬 설치 모델은 정확히 `gemma6:26b`가 아닐 수 있으며, `25.2B` Gemma 계열도 동일한 최적화 대상으로 본다.
- `LM Studio`는 v1 범위에서 지원은 유지하되, 요청 예산 튜닝은 `Ollama` 경로를 우선 최적화한다.
- 외부 의존성 추가는 하지 않는다.
- 요약 모델, 임베딩 인덱스, speculative execution, 실시간 스트리밍 파일 반영은 이번 범위에서 제외한다.

---

## 3. 구현 목표와 비목표

### 구현 목표

- 공개 설정 `llem.performancePreset` 추가
- 선택 모델을 기준으로 `auto -> balanced | large-local-26b` 자동 분류
- 26B 프리셋에서 Ollama 요청 옵션 축소
- 26B 프리셋에서 프롬프트 문자 예산 강제
- 섹션별 성능 계측치 확장
- README와 설정 설명 업데이트
- 자동 테스트 추가

### 비목표

- 의미 기반 검색(semantic retrieval)
- 히스토리 요약 모델 도입
- 벡터 DB/임베딩 저장
- action executor 스케줄러 재설계
- LM Studio용 별도 프롬프트 예산 정책 추가

---

## 4. 현재 코드 기준 핵심 진입점

구현 시 반드시 확인해야 할 핵심 파일은 아래와 같다.

- `src/types.ts`
  - 설정 타입, 스트림 옵션 타입, 내부 모델 프로파일 타입을 확장한다.
- `src/config.ts`
  - 공개 설정 `llem.performancePreset`을 읽는다.
- `package.json`
  - VS Code 설정 스키마에 `llem.performancePreset`을 노출한다.
- `src/settingsCommands.ts`
  - 사용자가 Settings Quick Pick에서 성능 프리셋을 바꾸도록 UI를 추가한다.
- `src/modelDiscovery.ts`
  - Ollama 모델 메타데이터(`parameter_size`, `family`)를 읽어와서 모델 프로파일 분류에 활용한다.
- `src/aiClient.ts`
  - Ollama 요청 body에 `num_ctx`, `num_predict`를 프리셋 기반으로 주입한다.
- `src/chatPipeline.ts`
  - 실행 시 모델 프로파일을 계산하고, 첨부 파일 예산과 초기/후속 요청 튜닝을 적용한다.
- `src/contextBuilder.ts`
  - 시스템 프롬프트 섹션과 히스토리 섹션에 문자 예산을 적용한다.
- `src/perfLogger.ts`
  - 성능 진단 채널 지표를 확장한다.

---

## 5. 최종 설계 요약

### 공개 설정

새 설정:

- `llem.performancePreset`
- 허용값:
  - `auto`
  - `balanced`
  - `large-local-26b`
- 기본값:
  - `auto`

### 내부 모델 프로파일

새 내부 개념:

- `PerformancePreset`
- `ResolvedPerformancePreset`
- `ModelRequestTuning`
- `ModelContextBudget`
- `InstalledModelInfo`
- `ModelProfile`

### resolved preset 규칙

- 사용자가 `balanced`를 직접 고르면 무조건 `balanced`
- 사용자가 `large-local-26b`를 직접 고르면 무조건 `large-local-26b`
- 사용자가 `auto`일 경우:
  - 모델 메타데이터 `parameter_size >= 24B`면 `large-local-26b`
  - 또는 모델명에 `26b`, `25.2b`, `24b` 같은 표기가 있으면 `large-local-26b`
  - 그 외는 `balanced`

### 26B 프리셋 고정값

#### Ollama 요청 튜닝

- `num_ctx = 8192`
- 초기 응답(`initial`) `num_predict = 2048`
- 액션 후 재호출(`followup`) `num_predict = 1024`

#### 컨텍스트 예산

- 총 프롬프트 목표: `28000 chars`
- active editor: 최대 `6000 chars`
- workspace context: 최대 `4000 chars`
- vault context: 최대 `4000 chars`
- 첨부 텍스트 파일당: 최대 `8000 chars`
- 첨부 전체 합계: 최대 `16000 chars`

#### timeout 경고 기준

- `large-local-26b`일 때 `requestTimeout < 600초`면 자동 수정은 하지 않고 경고만 표시

---

## 6. 구현 상세

## 6.1 `src/types.ts`

추가 타입:

- `PerformancePreset = 'auto' | 'balanced' | 'large-local-26b'`
- `ResolvedPerformancePreset = 'balanced' | 'large-local-26b'`
- `ModelContextBudget`
- `ModelRequestTuning`
- `InstalledModelInfo`
- `ModelProfile`

기존 타입 확장:

- `LlemConfig.performancePreset`
- `StreamOptions.contextWindow?`
- `StreamOptions.predictTokens?`

구현 원칙:

- 공개 설정은 사용자가 고르는 “requested preset”
- 내부 로직은 항상 “resolved preset”으로 동작
- `StreamOptions` 확장은 Ollama에만 사용하고 LM Studio에서는 무시

---

## 6.2 `src/performanceProfiles.ts`

새 파일을 만들고 다음 역할을 분리한다.

### 책임

1. `parameter_size` 문자열 파싱
2. 모델명 기반 `xxB` 추정
3. `auto` 프리셋 해석
4. 최종 `ModelProfile` 생성
5. 설치된 모델 카탈로그에서 현재 모델 메타데이터 검색

### 필수 함수

- `parseParameterSizeBillions(value)`
- `isLargeLocal26BModel(modelName, parameterSize?)`
- `resolvePerformancePreset(requestedPreset, modelName, parameterSize?)`
- `buildModelProfile({ modelName, requestedPreset, parameterSize, family })`
- `findInstalledModelInfo(modelName, catalog)`

### 설계 원칙

- 모델명 기반 판정은 보수적으로 한다.
- `26b`, `25.2b`, `24b`처럼 `24 이상`만 대형 모델로 취급한다.
- `8b`, `7b` 모델이 오탐되지 않도록 숫자 파싱을 분리한다.

---

## 6.3 `package.json` / `src/config.ts`

### `package.json`

VS Code 설정 스키마에 다음 항목 추가:

- key: `llem.performancePreset`
- enum: `auto`, `balanced`, `large-local-26b`
- default: `auto`
- 설명:
  - 큰 로컬 모델에서 더 보수적인 프롬프트/생성 예산을 쓰는 설정임을 명시

### `src/config.ts`

`getConfig()`가 `performancePreset`을 읽어 `LlemConfig`에 포함하도록 수정한다.

---

## 6.4 `src/settingsCommands.ts`

Settings Quick Pick에 다음 항목 추가:

- `Performance profile`

선택지는 아래 3개:

- `auto`
- `balanced`
- `large-local-26b`

선택 후 동작:

- 설정값을 global configuration에 저장
- `large-local-26b`를 직접 선택했고 timeout이 600초 미만이면 경고 표시
- `auto` 상태에서도 현재 default model이 26B-class로 보이면 timeout 경고 표시

주의:

- 설정 변경만 수행하고 대화 재시작은 강제하지 않는다.
- 다음 요청부터 새 프리셋이 적용되면 충분하다.

---

## 6.5 `src/modelDiscovery.ts`

기존 `getInstalledModels()`는 문자열 목록만 반환한다.
이번 구현에서는 모델 메타데이터가 필요하므로 카탈로그 조회 함수를 추가한다.

### 새 함수

- `getInstalledModelCatalog(baseUrl?)`

### 반환 형태

- `InstalledModelInfo[]`
- Ollama일 경우:
  - `name`
  - `parameterSize`
  - `family`
- LM Studio일 경우:
  - 최소 `name`

### 캐시

- 짧은 TTL 캐시 사용 (`~15초`)
- 같은 base URL에 대해 매 요청마다 `/api/tags`를 다시 치지 않도록 한다

이유:

- `chatPipeline`이 요청 시 현재 선택 모델의 `parameter_size`를 알아야 하기 때문

---

## 6.6 `src/aiClient.ts`

기존 Ollama 요청 body는 사실상 고정값에 가깝다.
이를 프리셋 기반으로 조절 가능하게 바꾼다.

### 변경점

- `buildStreamBody()`에 `contextWindow?`, `predictTokens?` 인자 추가
- Ollama 분기에서:
  - `num_ctx = contextWindow ?? 16384`
  - `num_predict = predictTokens ?? 4096`
- LM Studio 분기는 기존 유지

### 주의

- temperature, top_p, top_k는 그대로 둔다
- 이번 작업은 “속도/예산 최적화”이지 샘플링 정책 변경이 아니다

---

## 6.7 `src/promptBudgeting.ts`

새 파일로 분리하여 컨텍스트 예산 로직을 모듈화한다.

### 책임

1. 메시지 길이 추정
2. 텍스트 truncation
3. 관련 파일명/첨부 파일명에서 relevance term 추출
4. 첨부 파일 예산 계산
5. 히스토리 pruning

### 필수 함수

- `estimateMessageChars(message)`
- `truncateText(value, maxChars)`
- `collectRelevantTerms(activeFileName, attachmentNames)`
- `getAttachmentBudgetLimits(contextBudget?)`
- `allocateAttachmentPreview(preview, remainingChars, perFileChars)`
- `pruneHistoryMessages(messages, maxChars, relevantTerms)`

### 히스토리 pruning 규칙

항상 유지:

- 마지막 사용자 프롬프트
- 최근 2개 user/assistant 페어
- `[SYSTEM: ...]` 액션 결과 메시지

우선 제거 대상:

- 오래되고 relevance가 낮은 일반 메시지

그래도 예산 초과 시:

1. 핀되지 않은 메시지 압축
2. 마지막 사용자 프롬프트를 제외한 retained 메시지 제거
3. 마지막 사용자 프롬프트도 필요하면 잘라서 남김

중요:

- 예산이 0에 가까워도 “현재 사용자 프롬프트 완전 소실”은 금지

---

## 6.8 `src/contextBuilder.ts`

여기가 실제 프롬프트 예산 적용의 핵심이다.

### active editor 처리

- 기존에는 `MAX_CONTEXT_SIZE`로만 제한
- 새 로직에서는:
  - 기본 상한 `MAX_CONTEXT_SIZE`로 먼저 자름
  - 26B 프리셋이면 추가로 `contextBudget.activeEditorChars`까지 자름

### workspace / vault 처리

- 기존 `getWorkspaceContext()`와 `getSecondBrainContext()`는 그대로 유지
- `buildRequestMessages()`에서 최종 삽입 전에 예산에 맞춰 자른다

### 시스템 영역 축소 순서

26B 프리셋에서 시스템 메시지 자체가 너무 크면 다음 순서로 줄인다.

1. vault context
2. workspace context
3. active editor context

이유:

- 현재 작업 파일 정보가 가장 중요하고
- vault index는 상대적으로 우선순위가 낮기 때문

### history 예산 계산

- `historyBudget = totalPromptChars - systemContent.length`
- 이 값으로 `pruneHistoryMessages()` 실행

### PerfLogger 갱신값

- `historyChars`
- `activeEditorChars`
- `workspaceChars`
- `vaultChars`
- `attachmentChars`
- `prunedMessages`
- `prunedAttachmentChars`

---

## 6.9 `src/chatPipeline.ts`

이 파일은 실제 런타임 조합점이다.

### 구현 단계

1. `selectedModel` 계산
2. `getInstalledModelCatalog()` 호출
3. 현재 모델 메타데이터 찾기
4. `buildModelProfile()` 호출
5. 첨부 파일 예산 처리
6. `buildRequestMessages()`에 `modelProfile`, `attachmentNames`, attachment stats 전달
7. 첫 요청은 `phase = initial`
8. 액션 후 재호출은 `phase = followup`

### 첨부 파일 처리 규칙

텍스트 파일은 다음 순서로 예산 적용:

1. 원래 decode
2. 기존 상한(`MAX_TEXT_ATTACHMENT_CHARS`) 적용
3. 프리셋당 파일별 상한 적용
4. 프리셋당 전체 상한 적용

예산 초과 시:

- 일부 파일은 partial preview로 유지
- 전체 예산을 초과하면 나머지 파일은 스킵
- UI notice를 추가해 사용자가 왜 일부가 빠졌는지 알 수 있게 함

### warning 처리

- `large-local-26b`인데 timeout이 600초 미만이면 경고
- 같은 모델/프리셋/timeout 조합에서 경고가 반복 팝업되지 않도록 dedupe

### PerfLogger 갱신값

- `modelName`
- `performancePreset`
- `finalRequestChars`
- `attachmentChars`
- `prunedAttachmentChars`
- `streamTotalMs`

---

## 6.10 `src/sidebarChatProvider.ts`

### 변경 사항

- `buildRequestMessages()` 시그니처를 options 객체형으로 확장
- `warnLargeModelTimeout(profile, timeoutMs)` 콜백을 `ChatPipelineHost`에 추가
- 같은 경고가 여러 번 뜨지 않도록 `_largeModelWarningsShown` 집합 유지

### 설계 이유

- 프로파일/예산 관련 인자가 계속 늘어날 수 있기 때문에 positional argument보다 options object가 안전하다

---

## 6.11 `src/perfLogger.ts`

### 추가 지표

- `modelName`
- `performancePreset`
- `finalRequestChars`
- `historyChars`
- `activeEditorChars`
- `workspaceChars`
- `vaultChars`
- `attachmentChars`
- `prunedMessages`
- `prunedAttachmentChars`
- `streamTotalMs`

### Diagnostics 출력 형식

반드시 다음 값들이 보이게 한다.

- model / profile
- prompt estimate
- final request chars
- history / attachments
- active / workspace
- vault / pruned
- first token
- total stream duration
- tokens/sec

이 출력은 `balanced`와 `large-local-26b`를 비교하는 기준점이 된다.

---

## 7. 테스트 계획

## 7.1 자동 테스트

새 테스트 파일:

- `tests/performanceProfiles.test.mjs`
- `tests/promptBudgeting.test.mjs`
- `tests/packageConfig.test.mjs`

### `performanceProfiles`

검증 항목:

- `25.2B`, `8.0B` 파싱
- `gemma6:26b`, `26b`, `25.2B` 모델의 auto 분류
- `balanced` 강제 시 auto 판정 무시
- 26B 프리셋에서 요청 튜닝값이 `8192 / 2048 / 1024`인지 확인

### `promptBudgeting`

검증 항목:

- truncation note가 붙는지
- 첨부 파일 per-file / total 예산이 지켜지는지
- 예산이 매우 작아도 마지막 user prompt가 남는지
- relevance가 있는 `src/app.ts` 관련 메시지가 unrelated history보다 우선 유지되는지

### `packageConfig`

검증 항목:

- `llem.performancePreset`가 package.json 설정 스키마에 존재하는지
- default가 `auto`인지
- enum이 정확한지

### 테스트 빌드 설정

- `tsconfig.test.json`에
  - `src/performanceProfiles.ts`
  - `src/promptBudgeting.ts`
를 포함한다

---

## 7.2 수동 검증

다음 절차로 수동 검증한다.

### 시나리오 A: 소형 모델 기준선

1. `llem.defaultModel = gemma4:e4b`
2. `llem.performancePreset = balanced`
3. 동일한 워크스페이스에서 같은 프롬프트 실행
4. Diagnostics에서 아래 값 기록
   - prompt estimate
   - final request chars
   - first token
   - stream total duration

### 시나리오 B: 26B 자동 분류

1. `llem.defaultModel`을 26B-class 모델로 변경
2. `llem.performancePreset = auto`
3. Diagnostics에서 profile이 `large-local-26b`로 보이는지 확인
4. timeout이 600 미만이면 경고가 뜨는지 확인

### 시나리오 C: 긴 첨부 + 워크스페이스 컨텍스트

1. 큰 텍스트 파일 여러 개 첨부
2. active file을 긴 파일로 설정
3. vault index가 존재하는 상태에서 요청 실행
4. 다음을 확인
   - 일부 첨부가 partial 또는 skipped notice로 처리되는지
   - prompt chars가 26B 예산 근처로 제어되는지
   - empty reply / timeout 회귀가 없는지

### 시나리오 D: 액션형 멀티턴

1. 파일 읽기 또는 웹 읽기 액션이 발생하는 질문 실행
2. 후속 재호출 턴에서 응답이 계속 이어지는지 확인
3. `followup` 요청이 더 작은 `num_predict`로 동작하도록 코드/로그 점검

---

## 8. 수용 기준 (Acceptance Criteria)

다음 조건을 만족하면 완료로 본다.

- `npm run typecheck` 통과
- `npm test` 통과
- `llem.performancePreset`가 실제 설정 UI와 package.json에 노출됨
- `auto`가 24B+ Gemma 계열을 `large-local-26b`로 분류함
- 26B 프리셋에서 Ollama 요청값이 `num_ctx=8192`, `num_predict=2048/1024`를 사용함
- 긴 히스토리/첨부에서도 현재 사용자 프롬프트가 빠지지 않음
- Diagnostics에 확장된 계측값이 표시됨
- 26B급 모델에서 prompt size estimate가 기존 대비 의미 있게 감소함
- 액션형 멀티턴에서 empty reply/timeout 회귀가 없어야 함

---

## 9. 구현 순서 권장안

아래 순서대로 구현하는 것이 안전하다.

1. `types.ts` 확장
2. `performanceProfiles.ts` 추가
3. `package.json` / `config.ts` / `settingsCommands.ts` 수정
4. `modelDiscovery.ts`에 카탈로그 조회 추가
5. `aiClient.ts`에 Ollama 요청 옵션 확장
6. `promptBudgeting.ts` 추가
7. `contextBuilder.ts`에 시스템/히스토리 예산 적용
8. `chatPipeline.ts`에 모델 프로파일 및 첨부 예산 연결
9. `sidebarChatProvider.ts`에 timeout 경고 연결
10. `perfLogger.ts` 확장
11. README 업데이트
12. 테스트 추가 및 검증

이 순서를 지키면 타입 깨짐과 런타임 동작 이상을 가장 적게 만들 수 있다.

---

## 10. 후속 확장 후보

이번 구현 이후 다음 단계로 고려할 수 있는 항목:

- model family별 세분화된 프리셋
- LM Studio 경로에도 동일한 컨텍스트 예산 최적화 적용
- 히스토리 relevance 스코어 고도화
- 워크스페이스/볼트 캐시를 watch 기반으로 더 정교하게 관리
- 26B 전용 응답 품질 유지 전략(예: 선택적 히스토리 압축)

단, 이번 문서의 구현 범위에는 포함하지 않는다.
