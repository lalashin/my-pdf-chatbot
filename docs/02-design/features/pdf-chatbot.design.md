# [Design] pdf-chatbot

- **작성일**: 2026-05-04
- **참조 Plan**: `docs/01-plan/features/pdf-chatbot.plan.md`

---

## 1. 아키텍처 개요

```
[브라우저]
    │  사용자 질문 입력 (최대 500자)
    ▼
[public/index.html + app.js]
    │  POST /api/chat { question }
    ▼
[server.js — Express / Vercel 서버리스]
    │  1) 서버 시작 시 docs/ PDF 텍스트 메모리 로드 (최대 10만 자)
    │  2) question 유효성 검사
    │  3) 할루시네이션 방지 시스템 프롬프트 + pdfText 결합
    │  4) Claude API 호출 (claude-haiku-4-5)
    ▼
[Anthropic Claude API]
    │  문서 근거 답변 생성
    │  (문서 외 질문 → "제공된 문서에서 찾을 수 없습니다." 반환)
    ▼
[server.js]
    │  { answer } 응답 반환
    ▼
[브라우저 — 말풍선 형태로 답변 출력]
```

---

## 2. 파일 구조

```
my-pdf-chatbot/
├── server.js            # Express 서버 진입점 (API 키 서버 전용 처리)
├── public/
│   ├── index.html       # 말풍선 챗봇 UI 레이아웃
│   ├── style.css        # 말풍선 스타일 (user/bot 구분)
│   └── app.js           # fetch 요청 및 말풍선 렌더링
├── docs/                # PDF 파일 보관 — 교체 가능 (Git 포함)
├── .env                 # ANTHROPIC_API_KEY (Git 제외)
├── .gitignore
├── package.json
├── vercel.json          # Vercel 서버리스 라우팅 설정
└── CLAUDE.md
```

> **PDF 교체**: `docs/` 폴더의 PDF 파일만 교체 후 서버 재시작(또는 Vercel 재배포)하면 다른 문서에 즉시 적용된다.

---

## 3. 서버 설계 (server.js)

### 3.1 의존성

| 패키지 | 용도 |
|--------|------|
| `express` | HTTP 서버 및 라우팅 |
| `@anthropic-ai/sdk` | Claude API 클라이언트 |
| `pdf-parse` | PDF 텍스트 추출 |
| `dotenv` | .env 환경변수 로드 |
| `fs`, `path` | 파일 시스템 접근 (Node.js 기본) |

### 3.2 서버 초기화 흐름

```
서버 시작
  └─ dotenv.config() 로드
  └─ docs/ 폴더의 모든 .pdf 파일 목록 수집
  └─ 각 PDF → pdf-parse로 텍스트 추출 → 모두 합산
  └─ 합산 텍스트를 최대 100,000자로 자름 → pdfText 전역 변수에 저장
  └─ Express 앱 시작 (포트 3000)
```

### 3.3 할루시네이션 방지 시스템 프롬프트

`POST /api/chat` 처리 시 매 요청마다 아래 시스템 프롬프트를 고정 적용한다:

```
당신은 PDF 문서 기반 노무 FAQ 어시스턴트입니다.
반드시 아래 제공된 문서 내용만을 근거로 답변하세요.
문서에 없는 내용은 절대 추측하거나 지어내지 말고,
"제공된 문서에서 해당 내용을 찾을 수 없습니다."라고 답변하세요.

[문서 내용]
{pdfText}
```

### 3.4 API 엔드포인트

#### POST /api/chat

**역할**: 사용자 질문을 받아 Claude API로 전달하고 답변 반환

**요청 본문**
```json
{ "question": "연차 휴가는 며칠인가요?" }
```

**처리 순서**
1. `question` 유효성 검사 (빈 값 → 400, 500자 초과 → 400)
2. 시스템 프롬프트에 `pdfText` 삽입
3. Claude API 호출 (`claude-haiku-4-5`, `max_tokens: 1024`)
4. 답변 추출 후 JSON 응답 반환

**응답 — 문서 내 답변 가능**
```json
{ "answer": "근로기준법 제60조에 따르면 1년간 80% 이상 출근한 근로자에게는 15일의 유급휴가가 부여됩니다." }
```

**응답 — 문서 외 질문**
```json
{ "answer": "제공된 문서에서 해당 내용을 찾을 수 없습니다." }
```

**에러 응답**
```json
{ "error": "질문을 입력해주세요." }        // 400 — 빈 질문
{ "error": "질문은 500자 이하로 입력해주세요." } // 400 — 길이 초과
{ "error": "서버 오류가 발생했습니다." }   // 500 — API 호출 실패
```

#### GET /

**역할**: `public/index.html` 정적 파일 서빙 (`express.static('public')`)

---

## 4. 프론트엔드 설계

### 4.1 index.html 구조

```html
<body>
  <div id="app">
    <h1>PDF 노무 FAQ 어시스턴트</h1>
    <div id="chat-box">
      <!-- 말풍선 메시지가 동적으로 추가됨 -->
    </div>
    <div id="input-area">
      <input id="question" type="text" placeholder="질문을 입력하세요..." maxlength="500">
      <button id="send-btn">전송</button>
    </div>
  </div>
</body>
```

### 4.2 app.js 동작 흐름

```
전송 버튼 클릭 또는 Enter 키 입력
  └─ question 값 읽기
  └─ 빈 값이면 무시
  └─ 질문 말풍선을 chat-box에 추가 (우측 정렬, .user-msg)
  └─ 입력창 초기화, 전송 버튼 비활성화
  └─ POST /api/chat { question } 요청 (fetch)
  └─ 로딩 말풍선 표시 ("답변을 생성 중입니다...")
  └─ 응답 수신 후 로딩 말풍선 제거
  └─ answer 말풍선을 chat-box에 추가 (좌측 정렬, .bot-msg)
  └─ chat-box 최하단으로 자동 스크롤
  └─ 전송 버튼 활성화
```

### 4.3 style.css 주요 레이아웃

| 요소 | 스타일 |
|------|--------|
| `#app` | 중앙 정렬, 최대 너비 600px, 화면 전체 높이 |
| `#chat-box` | 스크롤 가능 영역, flex-direction: column, 높이 calc(100vh - 140px) |
| `.user-msg` | 우측 정렬, 파란색 배경 (`#007aff`), 흰색 글씨, border-radius |
| `.bot-msg` | 좌측 정렬, 회색 배경 (`#f0f0f0`), 어두운 글씨, border-radius |
| `.loading-msg` | 좌측 정렬, 점멸 애니메이션 |
| `#input-area` | flex 레이아웃, 하단 고정, input + button |

---

## 5. Vercel 배포 설계 (vercel.json)

```json
{
  "version": 2,
  "builds": [
    { "src": "server.js", "use": "@vercel/node" }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "server.js" }
  ]
}
```

- 모든 요청을 `server.js`로 라우팅
- 정적 파일(`public/`)은 `express.static()`으로 서빙
- `ANTHROPIC_API_KEY`는 Vercel 대시보드 → Settings → Environment Variables에서 설정

---

## 6. 환경변수

| 변수명 | 설명 | 로컬 | 배포 |
|--------|------|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 인증 키 | `.env` 파일 | Vercel 환경변수 |

---

## 7. 보안 설계

| 항목 | 처리 방식 |
|------|---------|
| API 키 위치 | `server.js`의 `process.env.ANTHROPIC_API_KEY`만 사용 |
| 프론트엔드 노출 | `public/` 코드 어디에도 API 키 미포함 |
| Git 제외 | `.gitignore`에 `.env` 포함 |
| 입력 검증 | 빈 값·500자 초과 서버에서 거부 |

---

## 8. 구현 순서 (Do Phase 참조용)

| 순서 | 작업 | 파일 |
|------|------|------|
| 1 | `package.json` 생성 및 패키지 설치 | `package.json` |
| 2 | 서버 기본 구조 + PDF 로드 로직 | `server.js` |
| 3 | 할루시네이션 방지 시스템 프롬프트 + Claude API 연동 | `server.js` |
| 4 | `POST /api/chat` 엔드포인트 완성 | `server.js` |
| 5 | 말풍선 챗봇 UI 작성 | `public/index.html`, `style.css` |
| 6 | fetch 요청 및 말풍선 렌더링 | `public/app.js` |
| 7 | `vercel.json` 작성 및 Vercel 배포 | `vercel.json` |

---

## 9. 완료 기준 (Design 관점)

- [ ] 서버 시작 시 `docs/` 폴더 PDF 텍스트가 메모리에 로드됨
- [ ] `POST /api/chat`이 할루시네이션 방지 프롬프트를 포함하여 Claude API를 호출함
- [ ] 문서 외 질문에 "제공된 문서에서 해당 내용을 찾을 수 없습니다." 반환됨
- [ ] `docs/` PDF 교체 후 재시작 시 새 문서 기반으로 동작함
- [ ] 프론트엔드 소스에 API 키가 전혀 포함되지 않음
- [ ] 챗봇 UI에서 사용자/봇 메시지가 말풍선으로 구분되어 출력됨
- [ ] `vercel.json` 설정으로 Vercel 배포 후 로컬과 동일하게 동작함
