const chatBox = document.getElementById('chat-box');
const questionInput = document.getElementById('question');
const sendBtn = document.getElementById('send-btn');
const dailyQuotaEl = document.getElementById('daily-quota');

// 하루 질문 가능 횟수 및 localStorage 키
const DAILY_QUESTION_LIMIT = 5;
const STORAGE_KEY = 'pdf-chatbot-daily-quota';

// 한도 소진 시 안내 문구 (요구사항 문구 그대로)
const LIMIT_MESSAGE =
  '오늘 질문 횟수(5회)를 모두 사용했습니다. 내일 다시 이용해주세요.';

// 서버에 넘길 직전 대화 (user / assistant 교차). 새로고침 시 초기화됨.
let conversationHistory = [];
const MAX_HISTORY_TURNS = 6; // 최근 6번 왕복까지 유지

/** 브라우저 로컬 날짜 기준 YYYY-MM-DD (자정이 지나면 문자열이 바뀌므로 카운트 자동 초기화) */
function getTodayLocalDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 오늘 기준 사용 횟수 객체 읽기 (날짜 불일치 시 0으로 리셋) */
function loadDailyState() {
  const today = getTodayLocalDateString();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { date: today, count: 0 };
    const parsed = JSON.parse(raw);
    if (parsed.date !== today) return { date: today, count: 0 };
    const count = Number.isFinite(parsed.count) ? Math.max(0, parsed.count) : 0;
    return { date: today, count };
  } catch {
    return { date: today, count: 0 };
  }
}

function saveDailyState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/** 성공적인 질문 1회 반영 */
function recordQuestionUsed() {
  const state = loadDailyState();
  state.count += 1;
  saveDailyState(state);
}

function getRemainingCount() {
  const { count } = loadDailyState();
  return Math.max(0, DAILY_QUESTION_LIMIT - count);
}

/** 상단 "오늘 남은 질문: N회" 및 입력·버튼 활성화 */
function refreshQuotaUi() {
  const remaining = getRemainingCount();
  dailyQuotaEl.textContent = `오늘 남은 질문: ${remaining}회`;

  if (remaining <= 0) {
    dailyQuotaEl.classList.add('daily-quota--exhausted');
    questionInput.disabled = true;
    sendBtn.disabled = true;
  } else {
    dailyQuotaEl.classList.remove('daily-quota--exhausted');
    // send 중일 때는 sendQuestion에서 버튼을 막으므로 여기서는 입력만 복구
    questionInput.disabled = false;
    sendBtn.disabled = false;
  }
}

// 말풍선을 chat-box에 추가하는 함수
function addMessage(text, type) {
  const msg = document.createElement('div');
  msg.classList.add(type); // 'user-msg' | 'bot-msg' | 'loading-msg'
  msg.textContent = text;
  chatBox.appendChild(msg);
  // 새 메시지가 추가될 때마다 최하단으로 자동 스크롤
  chatBox.scrollTop = chatBox.scrollHeight;
  return msg;
}

// 질문 전송 처리 함수
async function sendQuestion() {
  refreshQuotaUi();

  // 한도 초과 시 서버 호출 없이 안내 (사용자 말풍선도 추가하지 않음)
  if (getRemainingCount() <= 0) {
    addMessage(LIMIT_MESSAGE, 'bot-msg');
    return;
  }

  const question = questionInput.value.trim();

  // 빈 입력 무시
  if (!question) return;

  // 사용자 말풍선 추가 (우측)
  addMessage(question, 'user-msg');

  // 입력창 초기화 및 버튼 비활성화
  questionInput.value = '';
  sendBtn.disabled = true;

  // 로딩 말풍선 표시 (좌측, 점멸)
  const loadingMsg = addMessage('답변을 생성 중입니다...', 'loading-msg');

  try {
    // 서버의 /api/chat 엔드포인트로 질문 전송 (이전 말풍선 맥락 포함)
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        history: conversationHistory,
      }),
    });

    const data = await res.json();

    // 로딩 말풍선 제거
    loadingMsg.remove();

    if (res.ok && data.answer) {
      // 정상 답변일 때만 일일 횟수 증가 (실패·에러 응답은 카운트하지 않음)
      recordQuestionUsed();
      refreshQuotaUi();
      conversationHistory.push({ role: 'user', content: question });
      conversationHistory.push({ role: 'assistant', content: data.answer });
      while (conversationHistory.length > MAX_HISTORY_TURNS * 2) {
        conversationHistory.splice(0, 2);
      }
      addMessage(data.answer, 'bot-msg');
      if (getRemainingCount() === 0) {
        addMessage(LIMIT_MESSAGE, 'bot-msg');
      }
    } else {
      addMessage(data.error || '오류가 발생했습니다.', 'bot-msg');
    }
  } catch (err) {
    // 네트워크 오류 처리
    loadingMsg.remove();
    addMessage('서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.', 'bot-msg');
  }

  // 전송 버튼 재활성화 및 입력창 포커스
  refreshQuotaUi();
  questionInput.focus();
}

// 전송 버튼 클릭 이벤트
sendBtn.addEventListener('click', sendQuestion);

// Enter 키 입력 이벤트
questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendQuestion();
});

// 탭을 켜 둔 채 자정이 지난 뒤에도 상단 숫자가 맞도록 주기적으로 동기화
setInterval(refreshQuotaUi, 60_000);

// 첫 화면
refreshQuotaUi();
