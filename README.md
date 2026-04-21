<p align="center">
  <img src="assets/icon.png" width="120" alt="Connect AI Logo" />
</p>

<h1 align="center">Connect AI v2 (P-Reinforce)</h1>

<p align="center">
  <strong>100% Local · 100% Offline · Autonomous Knowledge Engine</strong><br/>
  VS Code / Cursor 확장 프로그램으로, 당신의 낡은 IDE를 최상위 에이전트 대학(A.U)의 심장으로 진화시킵니다.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.2.16-blue" alt="version" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license" />
  <img src="https://img.shields.io/badge/integration-Agent_University-purple" alt="integration" />
  <img src="https://img.shields.io/badge/engine-Ollama%20%7C%20LM%20Studio-orange" alt="engine" />
</p>

---

## 🌟 Overview: The P-Reinforce Architecture

Connect AI v2.2.16는 단순한 코딩 에이전트를 넘어섭니다. **P-Reinforce 아키텍처**를 기반으로 설계된 이 에이전트는 사용자의 모든 정보와 지시를 받아들여 **스스로 의미를 분석하고, 폴더를 생성하고, 마크다운 위키 파일로 정리하여 클라우드에 자동 백업**하는 자율 지식 정원사(Autonomous Gardener)입니다.

---

## ⚡ Core Features

### 1. 🧠 Agent University (A.U) 완벽 연동
Agent University 웹 플랫폼과 실시간으로 통신합니다. 
웹에서 버튼 한 번 누르는 즉시, 로컬 VS Code의 `4825` 포트를 통해 프리미엄 브레인 팩(Premium Brain Pack) 지식이 로컬 인공지능 뇌(`~/.connect-ai-brain`)에 자동 주입되어 신경망을 확장합니다.

### 2. 📂 자율 지식 구조화 (Zero-Interaction Styling)
유저가 던져주는 원시 데이터(Raw Data)를 에이전트가 스스로 판단해 `10_Wiki`, `00_Raw`, `🚀 Skills` 와 같은 완벽한 P-Reinforce 템플릿 규격의 Markdown 파일로 분할-조립하여 저장합니다.

### 3. ☁️ 클라우드 동기화 (Auto-Git Sync 100%)
로컬 PC에서 파일 생성이 일어나는 순간, 에이전트가 스스로 GitHub 저장소에 `git add`, `commit`, `push`를 수행합니다. 
마스터는 이제 지루한 푸시 커맨드를 입력할 필요가 없습니다.

### 4. 🔗 설치형 모델 자동 감지 (Dynamic Model Detection)
Ollama 또는 LM Studio에 설치된 모델을 내부 API(`v1/models`)를 호출하여 자동 감지하고, UI의 스위치 보드(드롭다운)에 연결합니다. 어떤 모델을 쓸지 번거롭게 입력하지 마십시오.

---

## ⚒️ Agent Capabilities (에이전트 권한)

로컬 머신의 파일 시스템과 터미널에 대한 통제권을 인공지능에게 부여합니다. (100% 안전한 권한 승인 기반)

| Action | Description |
|:--|:--|
| **📄 Create Files** | 새로운 파일과 폴더를 생성합니다 |
| **✏️ Edit Files** | 기존 파일 내의 코드를 수정합니다 |
| **🗑️ Delete Files** | 불필요한 파일을 즉각 파쇄합니다 |
| **📖 Read Files** | 마스터의 프로젝트 파일을 읽어 맥락을 파악합니다 |
| **📂 Browse Directories** | 디렉토리 구조를 분석합니다 |
| **🖥️ Run Commands** | `npm run build`, `git push` 등 터미널 명령을 수행합니다 |

---

## 📥 Installation (설치 방법)

### A.U 멤버십 유저 (Recommended)
1. 상단 탭의 [Releases](https://github.com/wonseokjung/connect-ai/releases) 메뉴로 진입.
2. 최신 `connect-ai-lab-2.2.16.vsix` 파일을 다운로드.
3. VS Code 에서 `Cmd+Shift+P` → **Extensions: Install from VSIX** → 다운받은 파일 선택

### 개발자 빌드 (Build from Source)
```bash
git clone https://github.com/wonseokjung/connect-ai.git
cd connect-ai
npm install
npm run compile
npm run package:vsix
```

---

## 📦 VSIX Release Rule (필수)

앞으로 VSIX 파일을 빌드할 때마다 반드시 아래 규칙을 지킵니다.

1. **버전 자동 증가:** VSIX 빌드 전 `package.json`과 `package-lock.json`의 버전을 항상 `0.0.1`씩 올립니다. 예: `2.2.14` → `2.2.15`.
2. **README 기록:** 버전을 올린 이유와 포함된 변경사항을 이 README의 `Release Notes` 섹션에 자세히 기록합니다.
3. **빌드 순서:** 버전 수정 후 `npm run compile`을 실행하고, 이어서 `npm run package:vsix`로 VSIX를 생성합니다.
4. **파일명 확인:** 생성된 파일명은 버전과 일치해야 합니다. 예: `connect-ai-lab-2.2.15.vsix`.
5. **기존 변경 보호:** 작업 중인 다른 파일 변경사항이 있으면 되돌리지 않고, 릴리스에 필요한 버전/문서/빌드 산출물만 갱신합니다.

권장 명령:

```bash
npm version patch --no-git-tag-version
npm run compile
npm run package:vsix
```

`npm version patch --no-git-tag-version`은 `package.json`과 `package-lock.json`의 패치 버전을 함께 올립니다. 단, README의 배지, 설치 안내, 릴리스 노트는 직접 최신 버전에 맞춰 갱신해야 합니다.

패키징 경고를 줄이기 위해 `npx vsce package` 대신 로컬 devDependency인 `@vscode/vsce` 기반의 `npm run package:vsix`를 사용합니다. 또한 `activationEvents`는 `*`를 쓰지 않고 실제 뷰와 명령 진입점만 명시합니다.

---

## 📝 Release Notes

### v2.2.16

- VSIX 빌드 버전을 `2.2.15`에서 `2.2.16`으로 올렸습니다.
- 채팅 웹뷰의 마크다운 렌더링을 `markdown-it` 기반으로 교체해 제목, 구분선, 리스트, 표, 인용문, 취소선, 링크, 코드블록 렌더링을 개선했습니다.
- VSIX 패키지에 `markdown-it` 런타임 파일이 포함되도록 `.vscodeignore` 허용 목록을 갱신했습니다.
- `connect-ai-lab-2.2.16.vsix` 패키지를 생성했습니다.

### v2.2.15

- VSIX 빌드 버전을 `2.2.14`에서 `2.2.15`로 올렸습니다.
- 패키징 시 `'*' activation` 성능 경고가 나오지 않도록 `activationEvents`를 실제 진입점 기준으로 구체화했습니다.
- 구버전 `vsce` 패키지 deprecation 경고를 피하기 위해 `@vscode/vsce`를 devDependency로 추가하고 `npm run package:vsix` 스크립트를 도입했습니다.
- README의 개발자 빌드 절차와 VSIX 릴리스 규칙을 새 패키징 명령 기준으로 갱신했습니다.

### v2.2.14

- VSIX 빌드 버전을 `2.2.13`에서 `2.2.14`로 올렸습니다.
- `connect-ai-lab-2.2.14.vsix` 패키지를 생성했습니다.
- 첨부 이미지 전송 시 채팅 말풍선 안에 실제 이미지 썸네일 카드가 표시되도록 개선했습니다.
- 텍스트/일반 파일 첨부는 별도 파일 카드로 표시되도록 정리했습니다.
- 대화 복원 시에도 첨부 이미지와 파일 카드가 다시 표시되도록 저장 구조에 첨부 메타데이터를 추가했습니다.
- Vision 모델로 이미지를 보낼 때 `image/png`로 고정하지 않고 실제 MIME 타입을 사용하도록 개선했습니다.

---

## ⚙️ Engine Setup (엔진 설정 방법)

### ✅ LM Studio (Apple Silicon, Windows) - 권장
1. [lmstudio.ai](https://lmstudio.ai/) 에서 설치
2. Gemma 3, Llama 3 또는 Qwen Coder 등 원하는 모델 로드
3. **Developer 탭(좌측 `<>` 메뉴)** 진입 후 **Start Server** 클릭
4. Connect AI의 ⚙️ 채팅방 설정에서 엔진을 "LM Studio"로 선택 (자동 모델 인덱싱 완료)

### ✅ Ollama (Mac, Linux)
```bash
brew install ollama
ollama pull gemma3   # 원하는 모델 풀링
```
Connect AI에서 설정만 "Ollama"로 바꿔주시면 끝납니다.

---

## 🔒 Privacy (완벽한 보안)

- **Zero Cloud API:** 당신의 코드는 외부 클라우드 통신망을 타지 않습니다.
- **Zero Telemetry:** 모든 연산력은 100% Local Inference 환경에서 이루어집니다.
- 기업 보안 등급에 준하는 극강의 밀폐형 로컬 지식망 생성을 보장합니다.

---

<p align="center">
  <strong>Built for Antigravity & Agent University</strong><br/>
  Designed by <a href="https://github.com/wonseokjung">Jay</a> × Connect AI Architect
</p>
