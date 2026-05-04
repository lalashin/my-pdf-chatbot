# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

PDF 문서를 읽고 질문에 답변하는 챗봇 서비스입니다.

- **프로젝트명**: PDF 기반 업무 어시스턴트 챗봇
- **배포 환경**: Vercel
- **AI 모델**: claude-haiku-4-5 (Anthropic Claude API)

## 기술 스택

- **서버**: Node.js + Express (`server.js`)
- **프론트엔드**: HTML / CSS / JavaScript (`public/`)
- **PDF 처리**: `docs/` 폴더의 PDF 텍스트를 추출하여 Claude API 컨텍스트로 전달

## 주요 명령어

```bash
# 의존성 설치
npm install

# 개발 서버 실행
node server.js

# Vercel 로컬 미리보기 (vercel CLI 필요)
vercel dev
```

## 아키텍처

```
my-pdf-chatbot/
├── server.js      # Express 서버 — API 라우트 및 Claude API 호출 담당
├── public/        # 프론트엔드 (정적 파일, Vercel이 서빙)
└── docs/          # PDF 파일 보관 위치
```

**데이터 흐름**: 사용자 질문 → `public/` JS → `server.js` API 엔드포인트 → PDF 텍스트 추출 → Claude API → 응답 반환

## 보안 규칙

- `.env` 파일은 절대 수정하거나 Git에 추가하지 말 것
- `ANTHROPIC_API_KEY`는 `server.js`에서 `process.env`로만 접근하며 프론트엔드에 노출 금지

## 코드 작성 규칙

- 모든 주석은 **한국어**로 작성
- 모든 대화 및 응답은 **한국어**로 진행
- 코드 설명은 초보자도 이해할 수 있도록 쉽게 작성
