# MCP 서버 등록 및 외부 설정 Import 구현 완료 계획

## Summary
 LLeM에 MCP 서버 등록, 외부 설정 import, 도구 목록 조회, 도구 호출 기능을 추가했다. `context-mode`를 기본 MCP 서버로 포함하고, LLeM 자체 설정, workspace `.mcp.json`, Claude Code 설정, Codex `config.toml`, 추가 JSON/TOML 경로를 하나의 MCP 서버 목록으로 병합한다.

## Implemented Changes
- `package.json`에 `llem.mcpEnabled`, `llem.mcpServers`, `llem.mcpConfigSources`, `llem.mcpConfigPaths` 설정을 추가했고, `llem.mcpServers` 기본값에 `context-mode`를 `npx -y context-mode`로 등록했다.
- `src/mcpConfig.ts`를 추가해 Claude Code JSON, Codex TOML, 일반 `mcpServers` JSON을 공통 schema로 정규화한다.
- `src/mcpManager.ts`를 추가해 `stdio` MCP 서버 연결, tool listing, tool calling, timeout, allow/deny tool filtering을 처리한다.
- 액션 태그 `<list_mcp_tools/>`와 `<call_mcp_tool server="..." tool="...">{"arg":"value"}</call_mcp_tool>`를 추가했다.
- 액션 파서, 실행기, sanitizer, action tag guard, webview live-progress, 시스템 프롬프트, 설정 메뉴를 MCP 태그와 서버 상태에 맞게 갱신했다.
- README에 LLeM/Antigravity raw path/Codex TOML 예시를 추가했다.

## Compatibility Notes
- 실제 실행 transport는 1차 범위대로 `stdio`만 지원한다.
- `http`, `sse`, Streamable HTTP 항목은 import/listing은 가능하지만 호출 시 unsupported 상태를 반환한다.
- Codex 설정은 `$CODEX_HOME/config.toml`이 있으면 우선 사용하고, 없으면 `~/.codex/config.toml`을 읽는다.
- 외부 설정은 읽기 전용으로 import하며 LLeM이 Claude Code, Codex, Antigravity 설정 파일을 수정하지 않는다.

## Tests
- `tests/mcpConfig.test.mjs`: workspace `.mcp.json`, Claude Code project config, Codex TOML, env expansion, 우선순위 검증.
- `tests/mcpManager.test.mjs`: disabled/unsupported 서버 처리, allow/deny filtering, mocked tool call 검증.
- `tests/actionParser.test.mjs`: MCP 액션 태그 파싱 검증.
- `tests/packageConfig.test.mjs`: MCP 설정 기본값 검증.
- 검증 명령: `npm run typecheck`, `npm test`.
