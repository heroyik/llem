# LLeM MCP 등록/실행, Codex Sync Diff, GitHub URL Import 구현 계획

## Summary
- LLeM에 MCP 서버 등록, MCP 실행/tool 호출, Codex 설정 자동 sync, GitHub URL 기반 MCP import 기능을 추가한다.
- Codex 설정 sync 시 기존 LLeM의 synced 상태와 새 Codex 설정을 비교해 추가/삭제/수정된 서버를 반드시 사용자에게 보여준다.
- v1은 실제 실행 transport를 `stdio`로 제한한다. HTTP/SSE/remote MCP는 읽고 표시하되 호출은 `unsupported`로 처리한다.

## Key Changes
- 설정 추가:
  - `llem.mcpEnabled`: 기본 `true`
  - `llem.mcpServers`: 사용자가 직접 등록한 서버
  - `llem.mcpSyncedServers`: Codex/GitHub import 등 외부 source에서 sync된 서버 snapshot
  - `llem.mcpConfigSources`: 기본 `["llem", "workspace", "codex-global", "codex-project"]`
  - `llem.mcpConfigPaths`: 추가 JSON/TOML config 경로
  - `llem.mcpToolTimeoutSeconds`: 기본 `60`
- Codex sync:
  - `$CODEX_HOME/config.toml`, `~/.codex/config.toml`, `<workspace>/.codex/config.toml`을 자동 탐색
  - Codex `[mcp_servers.<name>]`의 `type`, `command`, `args`, `env`, `enabled`, `cwd`, `timeout`을 내부 schema로 정규화
  - sync 전 `llem.mcpSyncedServers`의 기존 Codex-origin snapshot과 새 snapshot을 비교해 diff 표시
  - diff 확인 후 사용자가 승인하면 `llem.mcpSyncedServers`를 갱신
- MCP runtime:
  - `@modelcontextprotocol/sdk` 기반 `stdio` client 추가
  - lazy start, tool listing, tool calling, timeout, dispose 처리
- GitHub URL import:
  - GitHub repo README/package/config 예시를 읽고 MCP 설정 후보 생성
  - 사용자 preview/확인 후 `llem.mcpServers` 또는 `llem.mcpSyncedServers`에 저장

## Sync Diff Behavior
- Codex sync는 다음 세 그룹을 표시한다:
  - Added: 새 Codex config에는 있지만 기존 synced snapshot에는 없는 서버
  - Removed: 기존 synced snapshot에는 있지만 새 Codex config에는 없는 서버
  - Changed: 이름은 같지만 `command`, `args`, `env`, `enabled`, `cwd`, `timeout`, `transport` 중 하나 이상이 달라진 서버
- diff 표시 형식:
  - QuickPick 요약: `+2 added, -1 removed, ~3 changed`
  - 상세 보기: Markdown document 또는 webview/system message로 서버별 변경 내용 표시
  - env 값은 보안상 전체 값을 노출하지 않고 key 목록과 값 변경 여부만 표시
- sync 적용 규칙:
  - 사용자가 승인하기 전에는 저장하지 않는다.
  - 승인 시 Codex-origin 항목만 `llem.mcpSyncedServers`에서 교체한다.
  - 사용자가 직접 등록한 `llem.mcpServers`는 sync로 삭제/수정하지 않는다.
  - 동일 이름 충돌 시 direct `llem.mcpServers`가 실행 우선권을 갖고, diff에는 “shadowed by local config”로 표시한다.

## Implementation Steps
1. MCP 타입 정의
   - `types.ts`에 `McpServerConfig`, `ResolvedMcpServerConfig`, `McpConfigSnapshot`, `McpSyncDiff`, `McpConfigSource` 추가
   - source metadata: `sourceKind`, `sourcePath`, `sourceServerName`, `syncedAt`

2. package 설정/명령 추가
   - MCP 설정과 명령 추가:
     - `llem.reloadMcpServers`
     - `llem.listMcpServers`
     - `llem.syncCodexMcpServers`
     - `llem.importMcpFromGitHub`
   - dependency에 `@modelcontextprotocol/sdk` 추가

3. MCP config resolver 구현
   - `src/mcpConfig.ts` 추가
   - LLeM 설정, workspace `.mcp.json`, Codex TOML, 추가 경로를 내부 schema로 정규화
   - resolve 우선순위: `llem.mcpServers` > workspace `.mcp.json` > `llem.mcpSyncedServers`

4. Codex sync + diff 구현
   - `src/mcpCodexSync.ts` 추가
   - Codex config discovery:
     - `$CODEX_HOME/config.toml`
     - `~/.codex/config.toml`
     - `<workspace>/.codex/config.toml`
   - 새 Codex snapshot 생성 후 기존 `llem.mcpSyncedServers`의 `sourceKind === "codex"` 항목과 비교
   - diff approval UI를 표시하고 승인 시 Codex synced snapshot만 갱신

5. Diff renderer 구현
   - `src/mcpSyncDiff.ts` 추가
   - stable sort로 서버명 기준 diff 생성
   - changed field 단위 비교
   - env diff는 `addedKeys`, `removedKeys`, `changedKeys`만 표시
   - 상세 diff markdown 생성:
     - 서버명
     - source path
     - added/removed/changed fields
     - local config shadow 여부

6. MCP manager 구현
   - `src/mcpManager.ts` 추가
   - lazy connection, tool listing, tool calling, timeout, reload, dispose 처리
   - disabled/unsupported 서버는 실행하지 않고 명확한 report 반환

7. GitHub import 구현
   - `src/mcpGithubImport.ts` 추가
   - GitHub URL 정규화 후 README/package/config 후보 조회
   - README의 Codex/Claude/Cursor MCP config block 우선 추출
   - 후보 preview 후 승인 시 저장
   - GitHub import 결과는 기본적으로 direct `llem.mcpServers`에 저장

8. Action tags 추가
   - `<list_mcp_tools/>`
   - `<call_mcp_tool server="serverName" tool="toolName">{"arg":"value"}</call_mcp_tool>`
   - parser, executor, sanitizer, action tag guard, repetition watchdog, webview progress 감지 목록 업데이트

9. Settings/commands 연결
   - Settings 메뉴에 MCP 항목 추가:
     - List MCP servers
     - Sync Codex MCP settings
     - Import MCP from GitHub URL
     - Reload MCP runtime
   - extension activation 시 자동 sync는 diff가 있으면 notification으로 표시하고, 사용자가 열어 승인할 때만 적용한다.

10. 문서 업데이트
   - README에 Codex sync diff, GitHub import, stdio-only v1 제한 설명 추가

## Test Plan
- `mcpCodexSync.test.mjs`
  - `$CODEX_HOME`, home, workspace Codex config discovery
  - Codex TOML parsing
  - 승인 전에는 설정이 저장되지 않는지 확인
  - 승인 후 Codex-origin snapshot만 교체되는지 확인
- `mcpSyncDiff.test.mjs`
  - added/removed/changed detection
  - env key-level diff masking
  - local shadow 표시
  - stable sort 출력
- `mcpConfig.test.mjs`
  - direct/synced/workspace config merge priority
  - disabled/unsupported normalization
- `mcpGithubImport.test.mjs`
  - GitHub URL 정규화
  - README config block 추출
  - package.json 기반 후보 생성
- `mcpManager.test.mjs`
  - mocked stdio server list/call
  - timeout, invalid JSON, disabled/unsupported 처리
- `actionParser.test.mjs`, `packageConfig.test.mjs`
  - MCP action/config/command 노출 확인
- 전체 검증:
  - `npm run typecheck`
  - `npm test`

## Assumptions
- Codex sync diff는 저장된 이전 snapshot과 새 Codex config 사이의 차이를 보여준다.
- 첫 sync처럼 이전 snapshot이 없으면 모든 Codex 서버를 Added로 표시한다.
- sync는 사용자가 승인하기 전까지 LLeM 설정을 변경하지 않는다.
- sync는 `llem.mcpSyncedServers`의 Codex-origin 항목만 수정하며, 사용자가 직접 등록한 `llem.mcpServers`는 건드리지 않는다.
- env 값은 diff UI에 원문으로 노출하지 않는다.
