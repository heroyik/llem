# Fix 01: MCP 설정 파일화 및 편집 실패 루프 안정화 계획

## 1. 배경

LLeM에서 MCP 설정과 `context-mode`를 소스코드가 아닌 설정 파일로 관리할 수 있게 해 달라는 요청이 있었다. 실행 과정에서 LLeM은 일부 파일 생성에는 성공했지만, `src/mcpConfig.ts`와 `README.md` 수정에는 실패했다.

실패 원인은 VS Code 자체 문제나 파일 잠금이 아니라, 모델이 실제 파일에 존재하지 않는 `<find>` 텍스트를 사용해 `<edit_file>` 액션을 반복한 것이다.

주요 로그 흐름:

- `15:33:09`: 사용자가 `실행` 요청
- `15:35:33`: `src/mcpConfig.ts`, `README.md`에 대해 첫 번째 no-effect edit 발생
- `15:39:59`: 같은 두 파일에 대해 두 번째 no-effect edit 발생
- `15:40:48`: 사용자가 Stop 버튼으로 생성 중단

생성된 파일:

- `src/mcp/antigravity_config.ts`
- `src/mcp/claude_code_config.ts`
- `src/mcp/codex_config.ts`

현재 문제:

- 위 파일들은 "설정 파일"이 아니라 TypeScript 소스 파일이다.
- 각 파일의 import 경로가 `./types`로 되어 있어 위치상 잘못되었다.
- 핵심 파일인 `src/mcpConfig.ts`와 `README.md`는 실제로 수정되지 않았다.

## 2. 목표

이번 수정의 목표는 두 갈래다.

1. MCP 서버 설정과 `context-mode`를 코드가 아닌 설정 파일로 관리할 수 있게 한다.
2. 같은 잘못된 편집 액션이 반복될 때 LLeM이 긴 루프에 빠지지 않도록 안정성을 높인다.

우선순위는 기능 구현이 먼저이고, 편집 루프 방지는 최소한의 안전장치부터 적용한다.

## 3. 범위

### 포함

- LLeM 전용 MCP 설정 파일 경로 추가
- `context-mode` 설정 파일화
- 기존 Claude Code, Codex, Antigravity, workspace MCP 설정과의 우선순위 정리
- README에 설정 방법 상세 문서화
- 관련 테스트 추가 또는 갱신
- 잘못 생성된 `src/mcp/*.ts` 처리
- 반복 no-effect edit 방지 로직 개선 검토

### 제외 또는 후순위

- MCP HTTP/SSE transport의 실제 실행 지원 확대
- 모든 MCP 서버 UI 관리 기능
- 대규모 설정 UI 재설계
- README 전체 구조 개편

## 4. 현재 코드 조사 항목

먼저 아래 항목을 확인한다.

- `src/mcpConfig.ts`
  - 현재 `loadMcpServers`가 어떤 경로를 읽는지 확인한다.
  - `extraPaths`, `sources`, `llemServers` 병합 우선순위를 확인한다.
- `src/types.ts`
  - `McpResolvedServer`, `McpServerConfig`, `McpServersConfig` 타입 확인
  - `context-mode` 관련 타입 존재 여부 확인
- `package.json`
  - VS Code configuration contribution 확인
  - MCP/context 관련 설정 키 확인
- context 주입/모드 사용 위치
  - `rg -n "contextMode|context-mode|context mode|mcp" src`
- 테스트 구조
  - `tests/` 아래 MCP config 관련 테스트 존재 여부 확인

## 5. 설정 파일 스펙

새 TypeScript 설정 파일을 만들지 않고, JSON 또는 TOML 설정 파일을 사용한다. 기존 MCP 생태계 관례와 맞추기 위해 우선 JSON을 기본으로 한다.

권장 경로:

- workspace 설정: `.llem/mcp.json`
- user/global 설정: `%USERPROFILE%\.llem\mcp.json`

예시:

```json
{
  "contextMode": "auto",
  "mcpServers": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

`contextMode` 후보 값:

- `off`: MCP/context 자동 반영 안 함
- `auto`: 필요한 상황에서만 자동 반영
- `always`: 가능한 경우 항상 반영

정확한 값 이름은 기존 코드에 이미 설정 키가 있다면 기존 명명에 맞춘다.

## 6. 설정 우선순위

서버 설정은 현재 코드의 priority 기반 병합 방식을 유지한다. 같은 서버 이름이 여러 설정에 있으면 뒤쪽 높은 priority가 덮어쓴다.

권장 우선순위:

1. Claude Code user settings
2. Claude Code local project
3. Codex user config
4. Antigravity/custom extra paths
5. LLeM user config: `%USERPROFILE%\.llem\mcp.json`
6. Workspace Codex config: `.codex/config.toml`
7. Workspace MCP config: `.mcp.json`
8. Workspace LLeM config: `.llem/mcp.json`
9. VS Code LLeM settings: `llemServers`

원칙:

- 프로젝트에 가까운 설정이 사용자 전역 설정보다 우선한다.
- VS Code 설정에서 명시한 LLeM 설정은 최종 override로 둔다.
- 기존 동작을 깨지 않기 위해 현재 priority 숫자는 가능한 한 유지하고, 새 경로만 자연스럽게 끼워 넣는다.

`contextMode`도 같은 원칙으로 병합한다.

## 7. 구현 계획

### 7.1 잘못 생성된 파일 처리

현재 생성된 파일들은 요구사항에 맞지 않으므로 정리한다.

대상:

- `src/mcp/antigravity_config.ts`
- `src/mcp/claude_code_config.ts`
- `src/mcp/codex_config.ts`

처리 옵션:

- 옵션 A: 삭제
- 옵션 B: 실제 예시 설정 파일로 이동 또는 대체

권장: 삭제한다. 설정 예시는 README와 필요 시 `.llem/mcp.example.json`에 둔다.

### 7.2 타입 정의

필요하면 `src/types.ts` 또는 `src/mcpConfig.ts` 근처에 타입을 추가한다.

예상 타입:

```ts
export type McpContextMode = 'off' | 'auto' | 'always';
```

`McpConfigLoadResult` 확장 후보:

```ts
export interface McpConfigLoadResult {
    servers: McpResolvedServer[];
    warnings: string[];
    contextMode?: McpContextMode;
}
```

기존 호출부 영향이 작으면 위 방식으로 진행한다. 영향이 크면 별도 `loadLlemMcpConfig` 결과 타입을 둔다.

### 7.3 JSON 로더 확장

현재 JSON 로더는 `mcpServers`만 읽는 구조다. `.llem/mcp.json`에서 `contextMode`도 읽을 수 있도록 확장한다.

필요한 변경:

- 새 helper 추가:
  - `readLlemMcpConfigFile`
  - `normalizeContextMode`
- 기존 `readJsonMcpServers`는 가능하면 유지한다.
- `loadMcpServers`에서 LLeM user/workspace 경로를 push한다.

중요:

- 잘못된 JSON은 crash하지 않고 `warnings`에 기록한다.
- 알 수 없는 `contextMode` 값도 warning 처리 후 무시한다.

### 7.4 context-mode 연결

설정 파일에서 읽은 `contextMode`를 실제 동작에 반영한다.

조사 후 선택:

- 이미 VS Code setting 기반 context mode가 있으면, 설정 파일 값이 그 default/fallback으로 들어가게 한다.
- 별도 context manager가 있으면 해당 모듈에 주입한다.
- 아직 실제 context-mode 사용 지점이 없다면, `loadMcpServers` 결과까지만 노출하고 README에는 "현재 지원되는 값" 기준으로 정확히 문서화한다.

### 7.5 README 업데이트

README의 기존 제목과 소개를 바꾸지 않는다. 적절한 위치에 새 섹션만 추가한다.

추가할 섹션:

- `## MCP Configuration`

포함 내용:

- LLeM이 읽는 설정 파일 위치
- workspace 설정 예시: `.llem/mcp.json`
- user 설정 예시: `%USERPROFILE%\.llem\mcp.json`
- Claude Code 설정 위치:
  - `%USERPROFILE%\.claude\settings.json`
  - `%USERPROFILE%\.claude.json`
- Codex 설정 위치:
  - `%USERPROFILE%\.codex\config.toml`
  - workspace `.codex/config.toml`
- workspace `.mcp.json`
- Playwright MCP 예시
- `contextMode` 값 설명
- 우선순위 설명
- Windows 경로 주의사항

### 7.6 테스트

MCP config loader 테스트를 추가 또는 갱신한다.

테스트 케이스:

- `.llem/mcp.json`의 `mcpServers`를 읽는다.
- user/global `.llem/mcp.json`을 읽는다.
- workspace 설정이 user 설정을 override한다.
- `contextMode`를 읽고 반환한다.
- 알 수 없는 `contextMode`는 warning을 남기고 무시한다.
- 잘못된 JSON은 warning을 남기고 crash하지 않는다.
- 기존 Codex TOML 로딩이 유지된다.
- 기존 Claude JSON 로딩이 유지된다.

### 7.7 반복 편집 실패 안정화

이번 장애 재발 방지를 위해 최소 안전장치를 추가한다.

후보 변경:

- 같은 파일에서 no-effect edit가 2회 발생하면 해당 요청의 후속 edit를 중단한다.
- 실패 후 시스템 피드백에 전체 README 같은 대형 파일을 넣지 않고, 앞부분 또는 관련 snippet만 제공한다.
- 반복된 실패 액션을 history에 과하게 누적하지 않는다.
- 사용자에게는 "반복 편집 실패로 중단"을 간단히 표시하고, 모델에는 read-first 복구 지시를 넣는다.

우선 적용 권장:

- `FileStateGuard`의 threshold를 실질적으로 더 빠르게 끊도록 조정하거나, `chatPipeline`에서 no-effect edit 이슈가 반복되면 후속 턴을 중단한다.

## 8. 검증 계획

최소 검증:

```powershell
npm run compile
npm test
```

프로젝트 스크립트에 맞춰 실제 명령은 `package.json` 확인 후 조정한다.

수동 검증:

1. `.llem/mcp.json` 생성
2. Playwright MCP 서버 예시 추가
3. LLeM MCP 서버 목록 또는 관련 UI에서 서버가 표시되는지 확인
4. `contextMode` 값을 바꿨을 때 로딩 결과가 달라지는지 확인
5. 잘못된 JSON을 넣었을 때 확장이 죽지 않고 warning만 남기는지 확인

## 9. 위험 요소

- `context-mode`가 현재 코드에서 실제로 쓰이는 지점이 없을 수 있다.
- 기존 `McpConfigLoadResult`를 확장하면 호출부 타입 수정이 필요할 수 있다.
- README가 크기 때문에 단순 문자열 치환으로 수정하면 다시 실패할 수 있다.
- MCP 서버 설정 우선순위가 사용자 기대와 다를 수 있다.

완화:

- 작은 helper와 테스트 중심으로 변경한다.
- README는 안정적인 anchor 주변에 삽입한다.
- 기존 source priority를 최대한 유지한다.
- 기능 구현과 편집 루프 안정화는 커밋 또는 작업 단위로 분리한다.

## 10. 작업 순서 체크리스트

- [x] `src/mcp/`의 잘못 생성된 TypeScript 설정 파일 처리
- [x] MCP/context 관련 현재 코드 위치 조사
- [x] LLeM 설정 파일 경로와 schema 확정
- [x] 타입 추가 또는 확장
- [x] `.llem/mcp.json` user/workspace 로딩 구현
- [x] `contextMode` 파싱 및 우선순위 병합 구현
- [x] 실제 context-mode 사용 지점 연결
- [x] README MCP 설정 섹션 추가
- [x] MCP config loader 테스트 추가 또는 갱신
- [x] 반복 no-effect edit 방지 개선
- [x] compile/test 실행
- [x] git diff 검토

## 11. 완료 기준

아래 조건을 만족하면 완료로 본다.

- MCP 서버를 `.llem/mcp.json` 같은 설정 파일에 저장할 수 있다.
- `contextMode`도 설정 파일에서 읽을 수 있다.
- 기존 Claude Code, Codex, Antigravity, workspace MCP 설정 로딩이 깨지지 않는다.
- README에 설정 위치와 예시가 충분히 문서화되어 있다.
- 관련 테스트가 통과한다.
- 같은 잘못된 edit가 반복될 때 LLeM이 긴 루프에 빠지지 않는다.
