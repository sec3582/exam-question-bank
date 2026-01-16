// quiz.js — Quiz overlay + Memory Curve (SRS)
// Depends on globals from app.js: window.cards, window.persistAll, window.toImageSrc, window.appState

const quiz = {
  active: false,
  queue: [],
  idx: 0,
  showAns: false,
  settings: { limit: 20, subjectId: null, chapter: "" },
};

const QUIZ_DEFAULT_LIMIT = 20;

// Interval (days) per level 0~5
const LEVEL_DAYS = [0, 1, 3, 7, 14, 30];

function nowTs() {
  return Date.now();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function ensureMemory(card) {
  // Migration from legacy fields (ease/intervalDays/lapses/dueAt) if present.
  if (card.level == null) {
    const d = Number(card.intervalDays || 0);
    card.level = d >= 30 ? 5 : d >= 14 ? 4 : d >= 7 ? 3 : d >= 3 ? 2 : d >= 1 ? 1 : 0;
  }
  if (card.wrongCount == null) {
    card.wrongCount = Number(card.lapses || 0) || 0;
  }
  if (card.nextDue == null) {
    const t = card.dueAt;
    card.nextDue = t == null || t === "" ? null : Number(t);
    if (!Number.isFinite(card.nextDue)) card.nextDue = null;
  }
}

function msDays(days) {
  return days * 24 * 60 * 60 * 1000;
}

function applyReview(card, grade) {
  // grade: 0 wrong, 1 unsure, 2 correct
  ensureMemory(card);

  const now = nowTs();
  card.lastReviewedAt = now;

  const prevLevel = Math.min(5, Math.max(0, Number(card.level) || 0));
  let nextLevel = prevLevel;
  let nextDue = null;

  if (grade === 2) {
    nextLevel = Math.min(5, prevLevel + 1);
    const d = Math.max(1, LEVEL_DAYS[nextLevel] || 1);
    nextDue = now + msDays(d);
  } else if (grade === 1) {
    // "不確定"：稍微降一級，讓它更快回來
    nextLevel = Math.max(0, prevLevel - 1);
    const base = LEVEL_DAYS[Math.max(1, prevLevel)] || 1;
    const d = Math.max(1, Math.round(base * 0.5));
    nextDue = now + msDays(d);
  } else {
    // 錯：回來很快（10 分鐘）
    nextLevel = Math.max(0, prevLevel - 1);
    card.wrongCount = (Number(card.wrongCount) || 0) + 1;
    nextDue = now + 10 * 60 * 1000;
  }

  card.level = nextLevel;
  card.nextDue = nextDue;

  // Keep legacy fields loosely in sync (so old data isn't "dead")
  card.dueAt = nextDue;
  const dDays = Math.max(1, LEVEL_DAYS[nextLevel] || 1);
  card.intervalDays = dDays;
  if (grade === 0) card.lapses = (Number(card.lapses) || 0) + 1;
}

function buildQuizQueue({ limit = QUIZ_DEFAULT_LIMIT, subjectId = null, chapter = "" } = {}) {
  const now = nowTs();
  let eligible = (window.cards || []).slice();

  if (subjectId != null) {
    eligible = eligible.filter((c) => Number(c.subjectId) === Number(subjectId));
  }
  if (chapter) {
    eligible = eligible.filter((c) => (c.chapter || "") === chapter);
  }

  const due = [];
  const fresh = [];
  const later = [];

  for (const c of eligible) {
    ensureMemory(c);
    const nd = c.nextDue;
    if (nd == null) fresh.push(c);
    else if (Number(nd) <= now) due.push(c);
    else later.push(c);
  }

  // Prefer lower level within each group, but keep some randomness
  const byLevelAsc = (a, b) => (Number(a.level) || 0) - (Number(b.level) || 0);
  due.sort(byLevelAsc);
  fresh.sort(byLevelAsc);
  later.sort(byLevelAsc);

  shuffle(due);
  shuffle(fresh);
  shuffle(later);

  const out = [];
  for (const group of [due, fresh, later]) {
    for (const c of group) {
      out.push(c);
      if (out.length >= limit) return out;
    }
  }
  return out;
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
    if (title) title.textContent = "測驗完成";
    if (progress) progress.textContent = `${quiz.idx}/${quiz.queue.length}`;
    if (toggleBtn) {
      toggleBtn.textContent = "完成";
      toggleBtn.onclick = exitQuiz;
    }

    setText("quizQText", "");
    setText("quizAText", "");
    setImg("quizQImg", null);
    setImg("quizAImg", null);
    document.getElementById("quizAText")?.classList.add("hidden");
    document.getElementById("quizAImg")?.classList.add("hidden");
    return;
  }

  if (title) title.textContent = "測驗";
  if (progress) progress.textContent = `${quiz.idx + 1}/${quiz.queue.length}`;
  if (toggleBtn) toggleBtn.textContent = quiz.showAns ? "隱藏答案 (Space)" : "顯示答案 (Space)";

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

function deriveScopeFromLeftSelection() {
  const appState = window.appState || {};
  const subjectId = appState.subjectId ?? null;
  const chapter = (appState.chapter || "").trim();

  // If chapter is selected, use chapter scope; else if subject selected, use subject scope; else all.
  if (subjectId != null && chapter) return { subjectId, chapter };
  if (subjectId != null) return { subjectId, chapter: "" };
  return { subjectId: null, chapter: "" };
}

// Expose to app.js button handler
window.startQuiz = function startQuiz() {
  const overlay = document.getElementById("quizOverlay");
  if (!overlay) {
    alert("找不到測驗視窗（quizOverlay）。請確認 index.html 已加入測驗 Overlay。");
    return;
  }

  const { subjectId, chapter } = deriveScopeFromLeftSelection();
  const limit = QUIZ_DEFAULT_LIMIT;

  const queue = buildQuizQueue({ limit, subjectId, chapter });
  if (!queue.length) {
    const scopeText = chapter ? "目前章節" : (subjectId != null ? "目前科目" : "全部題目");
    alert(`此範圍（${scopeText}）沒有可出題的題目。\n請先新增題目或切換科目/章節。`);
    return;
  }

  quiz.active = true;
  quiz.settings = { limit, subjectId, chapter };
  quiz.queue = queue;
  quiz.idx = 0;
  quiz.showAns = false;

  overlay.classList.remove("hidden");
  bindOnce();
  renderQuiz();
};
