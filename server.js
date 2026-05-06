// 환경변수 로드 (.env 에서 GROQ_API_KEY 등 읽기)
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Groq API — baseURL 고정, 모델명만 변경하면 다른 모델로 전환 가능
const HF_MODEL = process.env.HF_MODEL || 'llama-3.1-8b-instant';
// 매 요청마다 시스템 프롬프트로 보내는 PDF 글자 수 상한(클수록 느려지고 비용 증가)
const PDF_TEXT_MAX_CHARS = parseInt(process.env.PDF_TEXT_MAX_CHARS || '100000', 10);
// 짧은 문서는 전체를 쓰고, 긴 문서는 키워드로 관련 구간만 발췌(전체보다 답변 정확도에 유리)
const CONTEXT_FULL_DOC_THRESHOLD = parseInt(process.env.CONTEXT_FULL_DOC_THRESHOLD || '2000', 10);
const RETRIEVAL_CONTEXT_MAX_CHARS = parseInt(process.env.RETRIEVAL_CONTEXT_MAX_CHARS || '2500', 10);
const CHUNK_SIZE = parseInt(process.env.RAG_CHUNK_SIZE || '1000', 10);
const CHUNK_OVERLAP = parseInt(process.env.RAG_CHUNK_OVERLAP || '180', 10);

// Groq 클라이언트 — openai 패키지 그대로 사용, baseURL만 Groq로 변경
const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

// JSON 요청 본문 파싱
app.use(express.json());

// public/ 폴더를 정적 파일로 서빙 (index.html, style.css, app.js)
app.use(express.static(path.join(__dirname, 'public')));

// 서버 시작 시 로드한 PDF 전체 텍스트(프로젝트 루트 또는 docs/의 .pdf)
let pdfText = '';
// 긴 문서 RAG용: 미리 잘라 둔 청크 (요청마다 재분할하지 않음)
let pdfChunks = [];

/** 추출 텍스트를 겹침 슬라이딩 윈도우로 나눔 */
function buildChunks(text) {
  const chunks = [];
  if (!text || text.length === 0) return chunks;
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
  }
  return chunks;
}

// 질문·이전 user 메시지에 맞춰 노무 FAQ 키워드 확장 (한글)
const KEYWORD_GROUPS = [
  ['연차', '연차휴가', '유급휴가', '연차유급', '휴가', '개근', '출근율'],
  ['근속', '계속근로', '근로기간', '근무연수', '년차', '2년', '3년'],
  ['퇴직', '퇴직금', '해고', '부당해고', '자진퇴사'],
  ['육아', '육아휴직', '보육'],
  ['임금', '통상임금', '연장', '야근', '휴일근무', '가산수당'],
  ['4대보험', '국민연금', '건강보험', '고용보험', '산재'],
];

function collectSearchTerms(question, pastUserContents) {
  const haystack = [question, ...pastUserContents].join('\n');
  const terms = new Set();
  const kr = haystack.match(/[가-힣]{2,}/g) || [];
  kr.forEach((w) => terms.add(w));
  const en = haystack.match(/[A-Za-z]{3,}/g) || [];
  en.forEach((w) => terms.add(w.toLowerCase()));
  for (const group of KEYWORD_GROUPS) {
    if (group.some((k) => haystack.includes(k))) {
      group.forEach((k) => terms.add(k));
    }
  }
  return [...terms];
}

function scoreChunkByTerms(chunk, terms) {
  let score = 0;
  for (const t of terms) {
    if (t.length < 2) continue;
    if (chunk.includes(t)) score += t.length >= 4 ? 4 : 2;
  }
  return score;
}

/** 문서 앞·중·뒤를 잘라 긴 PDF에서도 최소한의 본문은 보이게 함 */
function buildStridedFallback(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  const part = Math.floor(maxLen / 3);
  const midStart = Math.max(0, Math.floor(text.length / 2) - Math.floor(part / 2));
  return (
    text.slice(0, part) +
    '\n\n[··· 문서 중간 생략 표시 ···]\n\n' +
    text.slice(midStart, midStart + part) +
    '\n\n[··· 문서 끝부분 생략 표시 ···]\n\n' +
    text.slice(-part)
  ).slice(0, maxLen);
}

/**
 * 질문에 맞는 발췌본 구성. 문서가 짧으면 전체, 길면 키워드 상위 청크 후 원문 순서로 정렬.
 */
function buildDocumentContextForRequest(question, pastMessages) {
  const trimmed = (pdfText || '').trim();
  if (trimmed.length < 50) {
    return { context: '', isEmpty: true, mode: 'empty' };
  }

  const pastUserContents = pastMessages
    .filter((m) => m.role === 'user')
    .map((m) => m.content);

  if (trimmed.length <= CONTEXT_FULL_DOC_THRESHOLD) {
    return { context: trimmed, isEmpty: false, mode: 'full' };
  }

  const terms = collectSearchTerms(question, pastUserContents);
  const scored = pdfChunks.map((chunk, index) => ({
    index,
    score: scoreChunkByTerms(chunk, terms),
  }));
  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  let budget = 0;
  for (const { index, score } of scored) {
    if (picked.length >= 4 && score === 0) break;
    if (picked.includes(index)) continue;
    const chunk = pdfChunks[index];
    if (budget + chunk.length > RETRIEVAL_CONTEXT_MAX_CHARS && picked.length >= 5) break;
    picked.push(index);
    budget += chunk.length;
    if (picked.length >= 14) break;
  }

  if (picked.length === 0 || scored[0].score === 0) {
    return {
      context: buildStridedFallback(trimmed, RETRIEVAL_CONTEXT_MAX_CHARS),
      isEmpty: false,
      mode: 'strided',
    };
  }

  picked.sort((a, b) => a - b);
  const merged = picked.map((i) => pdfChunks[i]).join('\n\n[···]\n\n');
  return {
    context: merged.slice(0, RETRIEVAL_CONTEXT_MAX_CHARS),
    isEmpty: false,
    mode: 'retrieval',
  };
}

/** dir 바로 아래에 있는 .pdf만 수집 (디렉터리는 제외) */
function listPdfFilesInDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.pdf')) continue;
    const filePath = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (st.isFile()) out.push(filePath);
  }
  return out;
}

// 프로젝트 루트와 docs/의 PDF 텍스트를 추출해 메모리에 적재
async function loadPdfTexts() {
  const rootPdfs = listPdfFilesInDir(__dirname);
  const docsPdfs = listPdfFilesInDir(path.join(__dirname, 'docs'));
  const allPaths = [...rootPdfs, ...docsPdfs].sort();

  if (allPaths.length === 0) {
    console.warn(
      '프로젝트 루트 또는 docs/에 .pdf가 없습니다. PDF를 넣은 뒤 서버를 재시작하세요.',
    );
    return;
  }

  const texts = [];

  for (const filePath of allPaths) {
    const rel = path.relative(__dirname, filePath);
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    texts.push(data.text);
    console.log(`PDF 로드 완료: ${rel} (${data.text.length}자)`);
  }

  const combined = texts.join('\n\n');
  pdfText = combined.slice(0, PDF_TEXT_MAX_CHARS);
  pdfChunks = buildChunks(pdfText);
  console.log(
    `전체 PDF 텍스트 로드 완료: ${pdfText.length}자 (상한 ${PDF_TEXT_MAX_CHARS}, 청크 ${pdfChunks.length}개)`,
  );
}

/** 직전 대화 맥락 — 항목 수·글자 수 제한으로 토큰 폭주 방지 */
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CONTENT_LENGTH = 3500;

function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw.slice(-MAX_HISTORY_MESSAGES)) {
    if (!item || typeof item.content !== 'string') continue;
    if (item.role !== 'user' && item.role !== 'assistant') continue;
    const content = item.content.trim().slice(0, MAX_HISTORY_CONTENT_LENGTH);
    if (content === '') continue;
    out.push({ role: item.role, content });
  }
  return out;
}

// POST /api/chat — 사용자 질문을 받아 OpenAI API로 답변 반환
app.post('/api/chat', async (req, res) => {
  const { question, history } = req.body;

  // 빈 질문 검증
  if (!question || question.trim() === '') {
    return res.status(400).json({ error: '질문을 입력해주세요.' });
  }

  // 500자 초과 검증
  if (question.length > 500) {
    return res.status(400).json({ error: '질문은 500자 이하로 입력해주세요.' });
  }

  const pastMessages = sanitizeHistory(history);

  const { context: docContext, isEmpty: noDoc } = buildDocumentContextForRequest(
    question.trim(),
    pastMessages,
  );

  if (noDoc) {
    return res.status(503).json({
      error:
        '참고 PDF 본문이 비어 있습니다. 프로젝트 루트 또는 docs/에 .pdf를 넣은 뒤 서버를 재시작해 주세요. (스캔만 된 PDF는 글자 추출이 안 될 수 있습니다.)',
    });
  }

  try {
    // 문서 근거 + 단순 추론 허용. [참고 본문]은 발췌일 수 있음 — 그 안의 규정만 사용
    const systemPrompt = `당신은 아래 [참고 본문]에만 근거해 답하는 노무 FAQ 어시스턴트입니다.
[참고 본문]은 PDF에서 가져온 발췌일 수 있으나, 여기 나온 문장·숫자·조건만 근거로 사용하세요.

답변 규칙:
1. 연차·휴가·근속 등 질문이면 본문에서 **연차/유급휴가/개근/근속년수/일수** 관련 문장을 먼저 찾아 인용하세요.
2. 본문에 규정된 일수·조건이 있으면, "2년차"처럼 표현이 달라도 **같은 규정을 적용해** 답하세요. 키워드 글자가 완전 일치하지 않아도 됩니다.
3. 본문에 **아무 규정도 없고** 질문과 무관한 내용뿐일 때만 "제공된 문서에서 해당 내용을 찾을 수 없습니다."라고 답하세요.
4. 본문에 없는 다른 법령·판례·임의 수치는 만들지 마세요.
5. 사용자 질문과 같은 언어로 답하세요.

[참고 본문]
${docContext}`;

    const completion = await openai.chat.completions.create({
      model: HF_MODEL,
      temperature: 0.2,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        ...pastMessages,
        { role: 'user', content: question.trim() },
      ],
    });

    const answer = completion.choices[0].message.content;
    res.json({ answer });

  } catch (error) {
    console.error('Groq API 오류:', error.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 서버 시작 — PDF 로드 후 Express 실행
loadPdfTexts()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`서버 실행 중: http://localhost:${PORT}`);
      console.log(`Groq 모델: ${HF_MODEL}`);
    });
  })
  .catch((err) => {
    console.error('PDF 로드 실패:', err.message);
    process.exit(1);
  });
