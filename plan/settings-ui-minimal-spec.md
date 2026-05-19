# LLeM 환경설정 UI Minimal 개선 — 설계 명세서

> 작성일: 2026-05-19
> 상태: 설계 단계 (미구현)
> 관련 파일: `src/webview/main.ts`, `src/webview/styles.css`, `src/webviewHtml.ts`, `src/settingsCommands.ts`, `src/sidebarChatProvider.ts`, `src/webviewMessageRouter.ts`

---

## 1. 목표

LLeM VS Code Extension의 환경설정 UI를 **CODEX 스타일의 미니멀한 디자인**으로 개선한다. 현재 VS Code Native QuickPick / InputBox 기반의 설정 메뉴를 **웹뷰 내장 모달**로 대체하고, 모든 설정을 인라인 웹뷰 컨트롤로 조작 가능하게 한다.

---

## 2. 현재 아키텍처 분석

### 2-1. 현재 설정 UI 흐름

```
헤더 ⚙ 버튼 클릭 → showMcpModal() → MCP 서버 모달 표시 (webview 내)
  └─ [More] 버튼 → openSettings 메시지 → handleSettingsMenu()
      → VS Code QuickPick (모델 엔진 선택)
      → VS Code QuickPick (파라미터 조정)
      → VS Code QuickPick (Performance profile)
      → VS Code QuickPick (MCP 서버 관리)
      → VS Code InputBox (System Prompt 편집)
```

### 2-2. 현재 문제점

| 문제 | 설명 |
|------|------|
| **이중 UX** | ⚙ 버튼이 MCP 모달을 열지만 실제 설정은 Native QuickPick. 일관성 없음 |
| **Native QuickPick 의존** | 모든 설정이 VS Code의 `showQuickPick`, `showInputBox`에 의존. 웹뷰와 시각적 이질감 |
| **확장성 부족** | 설정 항목이 늘어날수록 QuickPick 계층이 깊어짐 |
| **CODEX 대비 복잡함** | CODEX의 간결한 설정 UX와 비교해 과도한 계층 구조 |

### 2-3. 현재 설정 가능 항목

| 그룹 | 항목 | 현재 UI 방식 |
|------|------|-------------|
| Engine | Model Engine 선택 (Rapid-MLX/Ollama/LM Studio) | QuickPick 1-depth |
| Sampling | Temperature, Top P, Top K | QuickPick 2-depth + InputBox |
| Sampling (Rapid-MLX) | Temp, Top P, Top K, Repeat Penalty, Max Tokens | QuickPick 2-depth + InputBox |
| Sampling (Legacy) | Temp, Top P, Top K | QuickPick 2-depth + InputBox |
| Performance | auto / balanced / large-local-26b | QuickPick 1-depth |
| MCP | List / Sync Codex / Import GitHub / Reload | QuickPick 2-depth + 별도 모달 |
| System Prompt | 시스템 프롬프트 텍스트 편집 | InputBox (multi-line 아님) |

---

## 3. 요구사항 (인터뷰 결과)

| 질문 | 선택 |
|------|------|
| CODEX 참조 대상 | CODEX CLI의 미니멀 디자인 + TOML config 철학 모두 |
| 설정 패널 구조 | **통합 패널** (MCP + 일반 설정을 하나로) |
| 패널 위치 | **웹뷰 내장 모달** (기존 MCP 모달과 같은 스타일) |
| 기본 표시 | **Collapsed/Minimal** — 가장 중요한 설정만 기본 표시 |
| "Advanced" 섹션 | 나머지 설정은 "Advanced" 접이식 섹션으로 구분 |
| 모델 선택기 | **헤더에 유지** — 헤더의 `<select>`는 그대로 둠 |
| ⚙ 버튼 동작 | ⚙ 클릭 → **새 통합 설정 패널** (MCP 포함) |
| Native vs Webview | **모두 웹뷰 내장** — QuickPick/InputBox 완전 대체 |
| Minimal Default | **Engine + Performance Profile** (항상 표시) |
| Sampling UI | **슬라이더 컨트롤** (온도/범위 조절 가능) |
| 반응형 | **Responsive** — 좁은 사이드바에서도 동작 |
| 시각 스타일 | **Ultra-minimal flat** — 현재 glassmorphism 대신 깔끔한 플랫 디자인 |

---

## 4. Proposed Design: 통합 미니멀 설정 패널

### 4-1. 진입 경로

```
헤더 ⚙ 버튼 클릭
  → settingsModal.classList.toggle('visible')  // 새 통합 설정 모달

MCP 모달 (#mcpModal) → MCP 섹션으로 통합, 별도 모달 제거
```

### 4-2. 패널 레이아웃 (위→아래)

```
┌─────────────────────────────────────┐
│  [*] Settings            [✕ Close]  │ ← 제목 행
├─────────────────────────────────────┤
│                                     │
│  ┌─ ENGINE ────────────────────┐    │ ← 항상 표시 (minimal)
│  │  Engine: [Rapid-MLX ▼]     │    │
│  │  Model:  [gemma4:e4b ▼]    │    │  ← 헤더의 modelSel과 동기화
│  └────────────────────────────┘    │
│                                     │
│  ┌─ PERFORMANCE ───────────────┐   │ ← 항상 표시 (minimal)
│  │  Profile: [auto ▼]         │    │
│  │  └── auto: Recommended     │    │  ← 선택 시 설명 표시
│  └────────────────────────────┘    │
│                                     │
│  ┌── [▼] Advanced ────────────┐   │ ← Collapsed 기본값
│  │                             │   │
│  │  ┌─ SAMPLING PARAMS ──┐    │   │
│  │  │ Temperature  ●━━━━○│    │   │  ← 슬라이더
│  │  │ Top P        ●━━━○ │    │   │
│  │  │ Top K        ○━━━● │    │   │
│  │  │ Repeat Pen.  ●━━○  │    │   │
│  │  │ Max Tokens   ●━━○  │    │   │
│  │  │            [Reset] │    │   │
│  │  └────────────────────┘    │   │
│  │                             │   │
│  │  ┌─ SYSTEM PROMPT ────┐    │   │
│  │  │ [textarea 3줄]     │    │   │
│  │  │ [Reset to default] │    │   │
│  │  └────────────────────┘    │   │
│  │                             │   │
│  │  ┌─ MCP SERVERS ────────┐  │   │
│  │  │ [MCP runtime] ●━━━○  │  │   │  ← 토글 스위치
│  │  │ 3 servers found      │  │   │
│  │  │                      │  │   │
│  │  │ ┌ server1 ──── [●]─┐ │  │   │  ← 각 서버 토글
│  │  │ │ stdio · command  │ │  │   │
│  │  │ └──────────────────┘ │  │   │
│  │  │ ┌ server2 ──── [○]─┐ │  │   │
│  │  │ │ source: codex    │ │  │   │
│  │  │ └──────────────────┘ │  │   │
│  │  │                      │  │   │
│  │  │ [Refresh] [Sync] [Import]│  │   │  ← MCP 액션 버튼
│  │  └────────────────────────┘  │   │
│  └──────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

### 4-3. 항목별 상세 설계

#### 4-3-1. Engine (항상 표시)

- **Engine 선택 드롭다운**: `Rapid-MLX (http://127.0.0.1:8000)` / `Ollama (http://127.0.0.1:11434)` / `LM Studio (http://127.0.0.1:1234)`
- 선택 시 바로 `llem.engineUrl` 업데이트 + 모델 목록 새로고침
- **Model 선택 드롭다운**: 헤더의 `#modelSel`과 동일한 데이터. 변경 시 `setDefaultModel` 메시지 전송

#### 4-3-2. Performance Profile (항상 표시)

- 드롭다운: `auto` / `balanced` / `large-local-26b`
- 옵션마다 간단한 description tooltip 또는 아래 설명 표시
- `large-local-26b` 선택 시 timeout 경고 표시 (현재와 동일)

#### 4-3-3. Sampling Parameters (Advanced)

- **Temperature**: 슬라이더 0.0~2.0, 기본 0.7
- **Top P**: 슬라이더 0.0~1.0, 기본 0.9
- **Top K**: 슬라이더 1~100, 기본 40
- **Repeat Penalty**: 슬라이더 0.8~2.0, 기본 1.1
- **Max Tokens**: 슬라이더 128~8192, 기본 2048
- Rapid-MLX 전용 / Legacy 파라미터 구분:
  - Rapid-MLX가 활성 엔진이면 Rapid-MLX 파라미터 표시
  - Ollama/LM Studio면 Legacy 파라미터 표시
  - 또는 둘 다 표시하고 현재 활성 엔진에 맞는 것 강조
- **[Reset to defaults]** 버튼 우측 하단

#### 4-3-4. System Prompt (Advanced)

- `<textarea>` 3줄 높이, 자동 확장 (최대 12줄)
- 기본 프롬프트와 다를 때만 저장 버튼 활성화
- **[Reset to default]** 버튼
- 변경 시 채팅 히스토리 초기화 확인

#### 4-3-5. MCP Servers (Advanced)

- **MCP Runtime**: Global toggle switch (기존 `#mcpGlobalToggle`과 동일)
- **서버 목록**: 각 서버별 토글 스위치
  - 서버명, transport, command 요약
  - Read-only 서버는 비활성화된 토글
  - Disabled 서버는 흐리게 표시
- **Action buttons**:
  - [Refresh] 서버 목록 새로고침
  - [Sync Codex] Codex MCP 동기화
  - [Import from GitHub] GitHub URL로 가져오기
  - [More] 기존 `moreSettingsBtn` 동작 → 기존 native QuickPick 열기 (fallback)

> ⚠️ MCP 서버 목록은 새로운 `#mcpSection`에 표시. 기존 `#mcpModal`은 제거함.

### 4-4. 시각 디자인: Ultra-Minimal Flat

기존 glassmorphism (blur, gradient 배경, glow 그림자) 대신 **flat minimal** 스타일:

```css
/* 기존: glassmorphism */
.modal { background: var(--bg-2); border-radius: 12px; box-shadow: var(--shadow); }

/* 새로운: ultra-minimal flat */
.settings-panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
}

.settings-section {
  border: none;
  border-bottom: 1px solid var(--border);
  padding: 12px 0;
}

.settings-section:last-child { border-bottom: none; }

/* 슬라이더 */
input[type="range"] {
  appearance: none;
  height: 4px;
  border-radius: 999px;
  background: var(--border-strong);
  outline: none;
}
input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--text);
  border: 1px solid var(--border-strong);
  cursor: pointer;
}

/* 섹션 헤더 */
.settings-section-title {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  margin-bottom: 8px;
}

/* 슬라이더 행 — 레이블 | 슬라이더 | 값 */
.slider-row {
  display: grid;
  grid-template-columns: minmax(80px, auto) 1fr 44px;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
  font-size: 12px;
}
```

**컬러 팔레트**: 기존 `:root` 변수 유지하되, 배경/테두리/텍스트 중심으로 단순화:

| 요소 | 값 |
|------|-----|
| 패널 배경 | `var(--panel)` or `var(--bg-2)` |
| 섹션 구분 | `border-bottom: 1px solid var(--border)` |
| 레이블 | `var(--text-dim)` |
| 값 | `var(--text)` |
| 슬라이더 트랙 | `var(--border-strong)` |
| 슬라이더 썸 | `var(--text)` |
| 토글 ON | `var(--ok)` |
| 경고 | `var(--accent)` or `var(--danger)` |

### 4-5. 반응형 동작

- 300px 이하: 슬라이더 행 `grid-template-columns`를 `1fr`로 변경, 값 우측 하단
- 200px 이하 (매우 좁음): 섹션 padding 축소, 폰트 크기 11px로 감소
- 스크롤: `overflow-y: auto` + `max-height: 70vh`
- 모달 최대 너비: `min(90vw, 480px)`

---

## 5. 변경될 파일 목록

| 파일 | 변경 사항 | 영향도 |
|------|----------|--------|
| `src/webview/main.ts` | ⚙ 버튼 → `showSettingsModal()` 호출 (기존 `showMcpModal()` 대체). 모든 설정 UI 핸들러 추가. 슬라이더/토글/드롭다운 이벤트 바인딩. `onmessage` 핸들러에 설정 응답 처리 추가. MCP 모달 참조 제거. | **High** |
| `src/webviewHtml.ts` | `#mcpModal` 제거. `#settingsPanel` 모달 신규 추가 (Engine + Performance minimal + Advanced collapse + Sampling sliders + System Prompt textarea + MCP section). | **High** |
| `src/webview/styles.css` | `.mcp-*` 클래스 정리 또는 축소. `.settings-*`, `.slider-row`, `.settings-section`, `.settings-collapse` 등 신규 스타일. 기존 `.modal-overlay`, `.modal` 유지. | **Medium** |
| `src/settingsCommands.ts` | 변경 불필요 (native QuickPick 유지하되 새로운 웹뷰 메시지 타입으로 리다이렉트). 또는 모든 native 메뉴 로직 제거. | **Low** (제거 선택 시 Medium) |
| `src/sidebarChatProvider.ts` | `_handleSettingsMenu()`에서 QuickPick 대신 웹뷰에 설정 데이터를 보내도록 변경. 새로운 메시지 핸들러 추가 (설정 업데이트, MCP 목록 등). `_settingsCommandHost()`는 유지하되 웹뷰 메시지 라우팅 추가. | **Medium** |
| `src/webviewMessageRouter.ts` | 새 메시지 타입 추가: `getSettingsData`, `updateSettings`, `getMcpServers` 등. | **Low** |

---

## 6. 새 메시지 타입 (extension ↔ webview)

### Extension → Webview

| type | payload | 설명 |
|------|---------|------|
| `settingsData` | `SettingsData` | 설정 패널 열릴 때 현재 설정값 전체 전송 |
| `mcpServerList` | `McpServerListUiState` | MCP 서버 목록 전송 (기존과 동일) |

### Webview → Extension

| type | payload | 설명 |
|------|---------|------|
| `getSettingsData` | 없음 | 설정 패널 열릴 때 현재 설정 요청 |
| `updateSetting` | `{ key: string, value: any }` | 특정 설정 변경 |
| `resetRapidMlxParams` | 없음 | Rapid-MLX 파라미터 초기화 |
| `resetSystemPrompt` | 없음 | 시스템 프롬프트 기본값으로 리셋 |

---

## 7. SettingsData 인터페이스 (신규)

```typescript
interface SettingsData {
  engineUrl: string;
  defaultModel: string;
  models: string[];
  performancePreset: string;
  
  // Rapid-MLX (활성 엔진에 따라)
  rapidMlxTextSampling?: {
    temperature: number;
    topP: number;
    topK: number;
    repeatPenalty: number;
    maxTokens: number;
  };
  
  // Legacy
  temperature: number;
  topP: number;
  topK: number;
  
  systemPrompt: string;
  defaultSystemPrompt: string;
  
  mcpEnabled: boolean;
  mcpServers: McpServerUiState[];
  
  // Large model timeout warning
  showTimeoutWarning?: boolean;
}
```

---

## 8. 구현 단계

### Phase 1: HTML/CSS 구조

1. `src/webviewHtml.ts`: `#settingsPanel` 모달 마크업 추가 (Engine + Performance minimal view, Advanced collapse 포함)
2. `src/webview/styles.css`: `.settings-*` 스타일 추가, 기존 `.mcp-*` 스타일 통합
3. `src/webviewHtml.ts`: 기존 `#mcpModal` 제거

### Phase 2: Webview JavaScript

4. `src/webview/main.ts`: `showSettingsModal()` 함수 구현
5. 슬라이더, 드롭다운, 토글, textarea 이벤트 핸들러 바인딩
6. `Advanced` collapse 토글 로직
7. `onmessage` 핸들러에 `settingsData` 처리 추가

### Phase 3: Extension 백엔드

8. `src/sidebarChatProvider.ts`: `getSettingsData` 메시지 핸들러에서 `SettingsData` 조합 후 전송
9. `updateSetting` 메시지 핸들러에서 각 설정 업데이트 (기존 `_settingsCommandHost()` 재사용)
10. ⚙ 버튼 → 새로운 설정 패널 열도록 `webviewMessageRouter.ts` 업데이트

### Phase 4: MCP 섹션 통합

11. MCP 서버 목록 렌더링을 `#mcpServerList` 대신 `#settingsMcpSection`으로 이동
12. MCP 토글/액션 버튼 이벤트 재연결
13. `#mcpModal` 관련 코드 정리 및 제거

### Phase 5: 정리 및 테스트

14. `settingsCommands.ts`의 native QuickPick 메뉴를 웹뷰 메시지로 리다이렉트 (또는 유지보수)
15. 반응형 레이아웃 최종 조정
16. 모든 설정 업데이트가 실제 VS Code 설정까지 전파되는지 확인

---

## 9. 테스트 계획

| 테스트 항목 | 방법 |
|------------|------|
| Engine 변경 → 모델 목록 갱신 | 설정 패널에서 engine 변경 후 모델 드롭다운 확인 |
| 슬라이더 조작 → 실제 설정 반영 | 각 슬라이더 변경 후 `getLlemSettings()`로 확인 |
| MCP 토글 → 서버 enable/disable | MCP 서버 토글 후 서버 상태 확인 |
| System Prompt 저장 | 변경 후 저장, 새 채팅에서 반영 확인 |
| Advanced collapse | Collapse 상태 localStorage 또는 메모리 유지 확인 |
| 반응형 레이아웃 | 사이드바 폭 200px/300px/600px에서 렌더링 확인 |
| Performance profile 변경 | 드롭다운 변경 후 config 확인 |
| 전체 스크롤 | 많은 MCP 서버 있을 때 스크롤 가능 확인 |

---

## 10. Open Questions / 논의 필요 사항

- [ ] **Native QuickPick 완전 제거?** 기존 `settingsCommands.ts`의 `handleSettingsMenu()`는 유지하되 웹뷰에서만 호출되지 않도록 변경? 아니면 완전 제거?
- [ ] **Legacy 파라미터 vs Rapid-MLX 파라미터 표시 전환?** 엔진에 따라 자동 전환 or 둘 다 표시?
- [ ] **모델 목록 새로고침** — 엔진 변경 시 자동 refresh or 수동 [Refresh] 버튼?
- [ ] **설정 변경 시 히스토리 리셋** — System Prompt 변경만 리셋? Sampling 변경 시에도?

---

## 11. 참고: CODEX 디자인 철학

CODEX CLI의 UI 디자인 원칙을 LLeM에 적용:

1. **Flat & Clean**: 그라데이션/블러 없이 단색 배경, 얇은 border
2. **Typography-first**: 시각적 장식보다 읽기 쉬운 텍스트 중심
3. **정보 밀도**: 공간 낭비 없이 필요한 정보만 간결하게
4. **Direct manipulation**: 클릭/슬라이더로 즉시 반응, 계층적 메뉴 지양
5. **Reduce cognitive load**: 기본값은 감추고, 필요한 설정만 표시
