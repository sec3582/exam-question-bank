// quiz.js — Quiz overlay + SRS (uses globals from app.js: cards, persistAll, toImageSrc)

const quiz = {
  active: false,
  queue: [],
  idx: 0,
  showAns: false,
};

function nowTs() { return Date.now(); }

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const QUIZ_DEFAULT_LIMIT = 20;

function buildQuizQueue(limit = QUIZ_DEFAULT_LIMIT) {
  const now = nowTs();
  const eligible = (window.cards || []).slice();

  const due = [];
  const fresh = [];
  const later = [];

  for (const c of eligible) {
    const dueAt = c.dueAt ?? null;
    if (!dueAt) fresh.push(c);
    else if (Number(dueAt) <= now) due.push(c);
    else later.push(c);
  }

  shuffle(due); shuffle(fresh); shuffle(later);

  const out = [];
  for (const group of [due, fresh, later]) {
    for (const c of group) {
      out.push(c);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function ensureSrs(card) {
  if (card.ease == null) card.ease = 2.3;
  if (card.intervalDays == null) card.intervalDays = 0;
  if (card.lapses == null) card.lapses = 0;
  if (card.lastReviewedAt == null) card.lastReviewedAt = null;
  if (card.dueAt == null) card.dueAt = null;
}

function applyReview(card, grade) {
  // grade: 0 wrong, 1 unsure, 2 correct
  ensureSrs(card);

  const now = nowTs();
  card.lastReviewedAt = now;

  if (grade === 2) {
    const base = card.intervalDays || 1;
    card.intervalDays = Math.max(1, Math.round(base * 2));
    card.ease = Math.min(3.0, (card.ease || 2.3) + 0.05);
  } else if (grade === 1) {
    const base = card.intervalDays || 1;
    card.intervalDays = Math.max(1, Math.round(base * 1.2));
    card.ease = Math.max(1.3, (card.ease || 2.3) - 0.05);
  } else {
    card.lapses = (card.lapses || 0) + 1;
    card.intervalDays = 1;
    card.ease = Math.max(1.3, (card.ease || 2.3) - 0.2);
  }

  card.dueAt = now + card.intervalDays * 24 * 60 * 60 * 1000;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
}

function setImg(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (val) {
    el.src = window.toImageSrc(val);
    el.classList.remove("hidden");
  } else {
    el.removeAttribute("src");
    el.classList.add("hidden");
  }
}

function currentCard() {
  return quiz.queue[quiz.idx] || null;
}

function renderQuiz() {
  const c = currentCard();

  const title = document.getElementById("quizTitleMain");
  const progress = document.getElementById("quizProgress");
  const toggleBtn = document.getElementById("quizToggleAns");

  if (!c) {
    title.textContent = "測驗完成";
    progress.textContent = `${quiz.idx}/${quiz.queue.length}`;
    toggleBtn.textContent = "完成";
    toggleBtn.onclick = exitQuiz;

    setText("quizQText", "");
    setText("quizAText", "");
    setImg("quizQImg", null);
    setImg("quizAImg", null);
    document.getElementById("quizAText")?.classList.add("hidden");
    document.getElementById("quizAImg")?.classList.add("hidden");
    return;
  }

  title.textContent = "測驗";
  progress.textContent = `${quiz.idx + 1}/${quiz.queue.length}`;
  toggleBtn.textContent = quiz.showAns ? "隱藏答案 (Space)" : "顯示答案 (Space)";

  setText("quizQText", (c.questionText || "").trim());
  setImg("quizQImg", c.questionImage || null);

  if (quiz.showAns) {
    document.getElementById("quizAText")?.classList.remove("hidden");
    setText("quizAText", (c.answerText || "").trim());
    setImg("quizAImg", c.answerImage || null);
  } else {
    document.getElementById("quizAText")?.classList.add("hidden");
    document.getElementById("quizAImg")?.classList.add("hidden");
  }
}

function toggleAnswer() {
  quiz.showAns = !quiz.showAns;
  renderQuiz();
}

function submit(grade) {
  const c = currentCard();
  if (!c) return;
  applyReview(c, grade);
  quiz.idx += 1;
  quiz.showAns = false;
  renderQuiz();
}

async function exitQuiz() {
  quiz.active = false;
  document.getElementById("quizOverlay")?.classList.add("hidden");

  try {
    await window.persistAll();
  } catch (e) {
    console.error(e);
    alert("測驗結束存檔失敗，請看 Console。");
  }
}

let bound = false;
function bindOnce() {
  if (bound) return;
  bound = true;

  document.getElementById("quizExit")?.addEventListener("click", exitQuiz);
  document.getElementById("quizToggleAns")?.addEventListener("click", toggleAnswer);
  document.getElementById("quizWrong")?.addEventListener("click", () => submit(0));
  document.getElementById("quizUnsure")?.addEventListener("click", () => submit(1));
  document.getElementById("quizCorrect")?.addEventListener("click", () => submit(2));

  window.addEventListener("keydown", (e) => {
    if (!quiz.active) return;
    if (e.key === "Escape") { e.preventDefault(); exitQuiz(); }
    if (e.key === " ") { e.preventDefault(); toggleAnswer(); }
    if (e.key === "1") { e.preventDefault(); submit(0); }
    if (e.key === "2") { e.preventDefault(); submit(1); }
    if (e.key === "3") { e.preventDefault(); submit(2); }
  });
}

// Expose to app.js button handler
window.startQuiz = function startQuiz() {
  const overlay = document.getElementById("quizOverlay");
  if (!overlay) {
    alert("找不到測驗視窗（quizOverlay）。請確認 index.html 已加入測驗 Overlay。");
    return;
  }

  quiz.active = true;
  quiz.queue = buildQuizQueue();
  quiz.idx = 0;
  quiz.showAns = false;

  overlay.classList.remove("hidden");
  bindOnce();
  renderQuiz();
};
