현재 구조를 바탕으로 성능 개선을 위한 핵심 전략을 3가지 측면(데이터 처리, 컨텍스트 관리, 실행 엔진)에서 분석하여 제안합니다.

1. 컨텍스트 관리 및 토큰 효율성 (Context & Token Optimization)
현재 contextBuilder.ts와 chatPipeline.ts가 핵심적인 역할을 할 것으로 보입니다. LLM에 전달되는 컨텍텍스트가 커질수록 비용과 지연 시간이 선형적으로 증가합니다.

Incremental Context Building (증분형 컨텍스트 구축): 현재는 파일이나 폴더 구조를 읽을 때 전체를 다시 스캔할 가능성이 있습니다. 변경된 파일(Git diff 기반)이나 최근에 수정된 파일만 선별적으로 컨텍스트에 포함하는 ‘Incremental Update’ 전략이 필요합니다.
Context Pruning (컨텍스트 가지치기): historyManager.ts에서 대화 기록이 길어질 때, 단순히 오래된 순으로 지우는 것이 아니라, 현재 작업 중인 파일(Active File)과 관련성이 낮은 히스토리는 요약(Summarization)하거나 압축하는 로직이 필요합니다.
Semantic Indexing (시맨틱 인덱싱): 로컬 파일을 단순히 텍스트로 읽는 대신, 작은 단위(Chunk)로 나누어 벡터화(Embedding)하여 저장해두면, contextBuilder가 필요한 부분만 정확하게 골라낼 수 있습니다.
난 2. 파일 시스템 및 입출력 최적화 (File IO & Async Optimization)
fileActions.ts와 atomicWrite.ts 등 파일 작업이 빈번하게 일어나는 구조입니다.

Parallel File Operations (병렬 파일 작업): actionExecutor.ts에서 여러 파일을 동시에 생성/수정할 때, 순차적인 작업이 아닌 Promise.all 등을 활용한 정교한 병렬 처리가 필요합니다. 단, 파일 잠금(Locking) 문제가 발생하지 않도록 atomicWrite의 정밀도가 중요합니다.
Watch-based Incremental Scanning: list_files나 파일 트리 구조를 만들 때, 파일 시스템의 watch 이벤트를 활용하여 변화가 있는 부분만 메모리에 유지하는 캐싱 전략을 강화해야 합니다.
Lazy Loading (지연 로딩): read_file이나 list_files 작업 시, 사용자가 요청하기 전까지는 파일의 전체 내용을 메모리에 올리지 않고, 메타데이터(파일 이름, 크기, 마지막 수정일) 위주로 관리하다가 필요할 때만 읽는 방식이 효율적입니다.
3. 실행 엔진 및 워크플로우 (Execution & Workflow)
actionExecutor.ts와 terminalManager.ts는 사용자 경험(UX)에 직접적인 영향을 주는 부분입니다.

Speculative Execution (추측 실행): 사용자가 명령을 내리기 전, 혹은 명령을 내리는 도중에 다음에 올 법한 파일 작업이나 터미널 명령을 미리 준비(Prefetching)하는 전략을 고려할 수 있습니다로.
Streaming-first Architecture: streamParsing.ts가 이미 존재하는 것으로 보아 스트리밍을 고려 중인 것 같습니다. LLM의 응답이 생성되는 즉시 파일에 쓰거나 터미널에 반영하는 '완전한 스트리밍 파이프라인’을 통해 사용자가 느끼는 체감 지연 시간을 최소화해야 합니다.
Task-level Concurrency Control: 터미널 명령(npm install 등)과 파일 쓰기 작업이 충돌하지 않도록 하는 정교한 스케줄러가 actionExecutor에 필요합니다.
요약된 성능 개선 로드맵
구분 핵심 전략 기대 효과
LLM 효율 증분형 컨텍스트 + 시맨틱 인덱싱 토큰 비용 절감 & 응답 속도 향상
IO 성능 병렬 파일 작업 + Watch 기반 캐싱 파일 시스템 부하 감소 & 실시간성 확보
UX 경험 완전한 스트리밍 + 추측 실행 체감 지연 시간(Latency) 극소화
다음 단계로 무엇을 할까요?
특정 파일(예: src/contextBuilder.ts)의 코드를 분석하여 구체적인 알고리즘 개선안을 제안해 드릴까요? 아니면 현재 package.json의 의존성 관점에서 최적화할 부분을 찾아볼까요?
