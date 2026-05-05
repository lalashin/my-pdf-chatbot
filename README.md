# PDF 기반 노무 FAQ 챗봇

PDF에서 추출한 텍스트를 근거로 질문에 답하는 웹 챗봇입니다. OpenAI Chat Completions API를 사용하며, Vercel에 배포할 수 있습니다.

## 배포 데모

- **베타**: [https://my-pdf-chatbot-beta.vercel.app/](https://my-pdf-chatbot-beta.vercel.app/)

## 기술 스택

| 구분 | 사용 |
|------|------|
| 런타임 | Node.js |
| 서버 | Express (`server.js`) |
| 프론트 | HTML / CSS / JavaScript (`public/`) |
| PDF | `pdf-parse` |
| AI | `openai` (예: `gpt-4o-mini`) |

## 사전 준비

- Node.js (LTS 권장)
- [OpenAI API 키](https://platform.openai.com/)

## 빠른 시작

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수

프로젝트 루트에 `.env` 파일을 만들고 다음을 넣습니다.

```env
OPENAI_API_KEY=sk-...
```

필요 시 모델·문맥 크기를 조절합니다 (아래 [환경 변수](#환경-변수) 참고).

### 3. PDF 넣기

- **프로젝트 루트**(`server.js`와 같은 폴더)에 `.pdf`를 두거나
- **`docs/` 폴더 바로 아래**에 `.pdf`를 둡니다.

여러 파일이 있으면 합쳐서 로드합니다. **하위 폴더 안의 PDF는 읽지 않습니다.**

### 4. 실행

```bash
npm start
```

브라우저에서 `http://localhost:3000` 으로 접속합니다.

PDF나 `.env`를 바꾼 뒤에는 **서버를 다시 시작**해야 반영됩니다.

## 주요 기능

- **문서 기반 답변**: 시스템 프롬프트로 제공 문서 밖 내용·임의 보강을 제한합니다.
- **간이 발췌(RAG 스타일)**: 문서가 길면 질문·이전 사용자 메시지의 키워드로 관련 구간을 골라 컨텍스트로 넣습니다.
- **대화 맥락**: 직전 몇 턴의 대화를 `POST /api/chat`에 함께 보냅니다 (새로고침 시 클라이언트 맥락은 초기화).
- **일일 질문 한도(프론트)**: `localStorage` 기준 하루 5회, 상단에 남은 횟수 표시 (우회 가능하므로 운영용 제한은 서버 설계가 별도).

## 환경 변수

| 이름 | 설명 | 기본값 |
|------|------|--------|
| `OPENAI_API_KEY` | OpenAI API 키 (필수) | — |
| `OPENAI_MODEL` | 채팅 모델 id | `gpt-4o-mini` |
| `PDF_TEXT_MAX_CHARS` | 로드 시 PDF 본문 합산 최대 글자 수 | `100000` |
| `CONTEXT_FULL_DOC_THRESHOLD` | 이 길이 이하이면 발췌 없이 전체 본문 사용 | `14000` |
| `RETRIEVAL_CONTEXT_MAX_CHARS` | 발췌 컨텍스트 최대 글자 수 | `32000` |
| `RAG_CHUNK_SIZE` | 청크 길이 | `1000` |
| `RAG_CHUNK_OVERLAP` | 청크 겹침 | `180` |
| `PORT` | 로컬 포트 | `3000` |

## API

### `POST /api/chat`

**본문(JSON)**

| 필드 | 타입 | 설명 |
|------|------|------|
| `question` | string | 질문 (필수, 공백 불가, 최대 500자) |
| `history` | array | 선택. `{ "role": "user" \| "assistant", "content": string }` 목록 |

**성공(200)**

```json
{ "answer": "..." }
```

**오류 예**

- `400` — 질문 검증 실패
- `503` — PDF 본문이 비어 있거나 추출 실패 (스캔 PDF 등)

## Vercel 배포

이 저장소는 `vercel.json`으로 `server.js`를 서버리스로 빌드합니다.

1. Vercel에 프로젝트 연결
2. **Settings → Environment Variables**에 `OPENAI_API_KEY` 등 필요한 변수 등록
3. 배포 후 PDF가 포함되도록 저장소에 `.pdf`를 두고, 용량·저작권 정책을 확인합니다.

## 프로젝트 구조

```text
my-pdf-chatbot/
├── server.js          # Express API, PDF 로드, OpenAI 호출
├── public/            # 정적 프론트 (index.html, style.css, app.js)
├── docs/              # 문서·기획 MD(및 선택적으로 docs 직하위 PDF)
├── vercel.json
├── package.json
└── .env               # 로컬 전용 (Git 제외)
```

## 알려진 제한

- **스캔만 된 PDF**는 텍스트 추출이 안 될 수 있습니다. OCR은 별도 파이프라인이 필요합니다.
- **키워드 발췌**는 법령·유사어 매칭에 한계가 있어, 임베딩 검색 등으로 개선 여지가 있습니다.
- 본 서비스는 **교육·참고용**이며 법률 자문을 대신하지 않습니다.

## 라이선스

저장소 정책에 따릅니다. 사용하는 PDF·법령 텍스트의 저작권·이용 조건은 각 출처를 확인하세요.
