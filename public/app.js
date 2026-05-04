const chatBox = document.getElementById('chat-box');
const questionInput = document.getElementById('question');
const sendBtn = document.getElementById('send-btn');

// 말풍선을 chat-box에 추가하는 함수
function addMessage(text, type) {
  const msg = document.createElement('div');
  msg.classList.add(type);     // 'user-msg' | 'bot-msg' | 'loading-msg'
  msg.textContent = text;
  chatBox.appendChild(msg);
  // 새 메시지가 추가될 때마다 최하단으로 자동 스크롤
  chatBox.scrollTop = chatBox.scrollHeight;
  return msg;
}

// 질문 전송 처리 함수
async function sendQuestion() {
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
    // 서버의 /api/chat 엔드포인트로 질문 전송
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    const data = await res.json();

    // 로딩 말풍선 제거
    loadingMsg.remove();

    if (res.ok) {
      // 봇 답변 말풍선 추가 (좌측)
      addMessage(data.answer, 'bot-msg');
    } else {
      // 에러 메시지 말풍선 추가
      addMessage(data.error || '오류가 발생했습니다.', 'bot-msg');
    }
  } catch (err) {
    // 네트워크 오류 처리
    loadingMsg.remove();
    addMessage('서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.', 'bot-msg');
  }

  // 전송 버튼 재활성화 및 입력창 포커스
  sendBtn.disabled = false;
  questionInput.focus();
}

// 전송 버튼 클릭 이벤트
sendBtn.addEventListener('click', sendQuestion);

// Enter 키 입력 이벤트
questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendQuestion();
});
