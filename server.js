// 환경변수 로드 (.env 파일에서 ANTHROPIC_API_KEY 읽기)
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// JSON 요청 본문 파싱
app.use(express.json());

// public/ 폴더를 정적 파일로 서빙 (index.html, style.css, app.js)
app.use(express.static(path.join(__dirname, 'public')));

// 서버 시작 시 docs/ 폴더의 PDF 텍스트를 메모리에 저장하는 전역 변수
let pdfText = '';

// docs/ 폴더의 모든 PDF 파일을 읽어 텍스트를 추출하는 함수
async function loadPdfTexts() {
  const docsDir = path.join(__dirname, 'docs');

  // docs/ 폴더가 없으면 종료
  if (!fs.existsSync(docsDir)) {
    console.log('docs/ 폴더가 없습니다. PDF 없이 서버를 시작합니다.');
    return;
  }

  // .pdf 확장자 파일만 필터링
  const pdfFiles = fs.readdirSync(docsDir).filter(f => f.endsWith('.pdf'));

  if (pdfFiles.length === 0) {
    console.log('docs/ 폴더에 PDF 파일이 없습니다.');
    return;
  }

  const texts = [];

  for (const file of pdfFiles) {
    const filePath = path.join(docsDir, file);
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    texts.push(data.text);
    console.log(`PDF 로드 완료: ${file} (${data.text.length}자)`);
  }

  // 모든 PDF 텍스트를 합산 후 최대 10만 자로 제한
  const combined = texts.join('\n\n');
  pdfText = combined.slice(0, 100000);
  console.log(`전체 PDF 텍스트 로드 완료: ${pdfText.length}자`);
}

// POST /api/chat — 사용자 질문을 받아 Claude API로 답변 반환
app.post('/api/chat', async (req, res) => {
  const { question } = req.body;

  // 빈 질문 검증
  if (!question || question.trim() === '') {
    return res.status(400).json({ error: '질문을 입력해주세요.' });
  }

  // 500자 초과 검증
  if (question.length > 500) {
    return res.status(400).json({ error: '질문은 500자 이하로 입력해주세요.' });
  }

  try {
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // 할루시네이션 방지 시스템 프롬프트 — 문서 내용에만 근거하여 답변하도록 강제
    const systemPrompt = `당신은 PDF 문서 기반 노무 FAQ 어시스턴트입니다.
반드시 아래 제공된 문서 내용만을 근거로 답변하세요.
문서에 없는 내용은 절대 추측하거나 지어내지 말고,
"제공된 문서에서 해당 내용을 찾을 수 없습니다."라고 답변하세요.

[문서 내용]
${pdfText}`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        { role: 'user', content: question }
      ],
    });

    const answer = message.content[0].text;
    res.json({ answer });

  } catch (error) {
    console.error('Claude API 오류:', error.message);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 서버 시작 — PDF 로드 후 Express 실행
loadPdfTexts().then(() => {
  app.listen(PORT, () => {
    console.log(`서버 실행 중: http://localhost:${PORT}`);
  });
});
