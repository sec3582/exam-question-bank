/* =========================================================
   Jill Quiz Tool — Two-Column App.js (keep your original layout)
   Layout target (your previous version):
   - Left: Subjects + Chapters
   - Right(top): Cards list
   - Right(bottom): Editor (3 columns grid)
   Storage:
   - NOW: localForage (IndexedDB) = primary (works on VS Code Live Server)
   - FUTURE: drive/cloud adapter reserved (Cloud Run / Drive API)
   ========================================================= */

// ✅ 開發期先用 local（Live Server 最穩）
// 之後要接 Cloud Run / Drive，只要把 mode 改掉並補上 adapter 即可
const STORAGE_MODE = "local"; // "local" | "drive"
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxpZ7n4XRrFunG5ae_bSU7VO0gJ9ZvERVv9BQHZCkpiMHKS0X_JPav8WRV97gSRXIzccg/exec";

const STORAGE_KEYS = {
  subjects: "qp_subjects",
  cards: "qp_cards",
};

/* ---------- Google Drive appDataFolder (OAuth, manual sync) ---------- */
const GOOGLE_CLIENT_ID = "552475249177-ah6q85dhue6sho8kor92gob3dlcu9ook.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE_FILENAME = "exam-question-bank.json";

let tokenClient = null;
let accessToken = "";

function setCloudChip(text, title = "") {
  const el = document.getElementById("cloudChip");
  if (!el) return;
  el.textContent = text;
  el.title = title || "";
}

function initGoogleTokenClient() {
  if (!window.google?.accounts?.oauth2) return false;

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: () => {}, // 會在 requestToken 時覆寫
  });

  return true;
}

function requestToken(interactive = true) {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      const ok = initGoogleTokenClient();
      if (!ok) return reject(new Error("Google Identity Services 尚未載入（請確認 index.html 已加入 gsi/client）"));
    }

    if (accessToken) return resolve(accessToken);

    tokenClient.callback = (resp) => {
      if (resp?.access_token) {
        accessToken = resp.access_token;
        setCloudChip("已登入", "可雲端載入/同步（appDataFolder）");
        resolve(accessToken);
      } else {
        reject(new Error("未取得 access token"));
      }
    };

    tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}

async function driveFetch(url, { method = "GET", headers = {}, body } = {}) {
  const token = await requestToken(true);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...headers },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${txt || res.statusText}`);
  }
  return res;
}

async function findAppDataFileId() {
  const q = encodeURIComponent(`name='${DRIVE_FILENAME}' and trashed=false`);
  const url =
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}` +
    `&fields=files(id,name,modifiedTime)&pageSize=10`;
  const res = await driveFetch(url);
  const data = await res.json();
  return data.files?.[0]?.id || "";
}

function buildMultipart(metadata, jsonText) {
  const boundary = "----qptool" + Math.random().toString(16).slice(2);
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${jsonText}\r\n` +
    `--${boundary}--\r\n`;
  return { boundary, body };
}

async function loadAppData() {
  const fileId = await findAppDataFileId();
  if (!fileId) {
    // 雲端還沒有檔案：視為空
    subjects = [];
    cards = [];
    return;
  }

  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  const text = await res.text();
  const obj = JSON.parse(text || "{}");

  subjects = Array.isArray(obj.subjects) ? obj.subjects : [];
  cards = Array.isArray(obj.cards) ? obj.cards : [];
}

async function saveAppData() {
  const fileId = await findAppDataFileId();
  const payloadObj = { version: 1, updatedAt: new Date().toISOString(), subjects, cards };
  const payloadText = JSON.stringify(payloadObj);

  const metadata = fileId
    ? { name: DRIVE_FILENAME }
    : { name: DRIVE_FILENAME, parents: ["appDataFolder"] };

  const { boundary, body } = buildMultipart(metadata, payloadText);

  if (!fileId) {
    await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
  } else {
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
      method: "PATCH",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
  }
}

async function cloudPull() {
  await loadAppData();

  // 載入雲端後也存回本機（離線可用）
  await localforage.setItem(STORAGE_KEYS.subjects, subjects);
  await localforage.setItem(STORAGE_KEYS.cards, cards);

  // 同步給 quiz.js 與 UI
  window.subjects = subjects;
  window.cards = cards;

  state.subjectId = subjects[0]?.id ?? null;
  state.chapter = "";
  state.selectedCardId = null;
  state.query = "";
  state.dirty = false;
  setSaveChipState("saved");

  renderAll();
}

async function cloudPush() {
  await saveAppData();
}


function initCloudActions() {
  const chip = document.getElementById("cloudChip");
  const btnPull = document.getElementById("btnCloudPull");
  const btnPush = document.getElementById("btnCloudPush");

  // chip：未登入時點擊＝登入
  if (chip) {
    const onChipClick = async () => {
      try {
        if (accessToken) return; // 已登入就不做事
        setCloudChip("登入中…");
        await requestToken(true); // 你現有的拿 token function
      } catch (e) {
        console.error(e);
        setCloudChip("未登入（點我登入）", String(e.message || e));
        alert(String(e.message || e));
      }
    };

    chip.addEventListener("click", onChipClick);
    chip.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") onChipClick();
    });
  }

  // 雲端載入：若未登入，會先登入
  if (btnPull) {
    btnPull.addEventListener("click", async () => {
      try {
        if (!accessToken) await requestToken(true);
        setCloudChip("載入中…");
        await cloudPull();  // 你現有的雲端載入
        setCloudChip("載入完成", "已從雲端載入");
      } catch (e) {
        console.error(e);
        setCloudChip("失敗", String(e.message || e));
        alert(String(e.message || e));
      }
    });
  }

  // 雲端同步：若未登入，會先登入
  if (btnPush) {
    btnPush.addEventListener("click", async () => {
      try {
        if (!accessToken) await requestToken(true);
        setCloudChip("同步中…");
        await cloudPush();  // 你現有的雲端同步
        setCloudChip("同步完成", "已同步到雲端");
      } catch (e) {
        console.error(e);
        setCloudChip("失敗", String(e.message || e));
        alert(String(e.message || e));
      }
    });
  }

  // 初始提示（方案 B）
  setCloudChip(accessToken ? "已登入" : "未登入（點我登入）", "");
}



let subjects = [];
let cards = [];

const state = {
  subjectId: null,
  chapter: "",
  selectedCardId: null,
  query: "",
  dirty: false,

  saving: false,
  lastSaveError: "",
};

// Expose minimal state for quiz.js (scope selection)
window.appState = state;

/* ---------- Utils ---------- */
function toImageSrc(val) {
  const v = String(val || "").trim();
  if (!v) return "";
  if (v.startsWith("data:image/")) return v;
  if (v.startsWith("http")) return v;
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(v)}&sz=w1600`;
}
window.toImageSrc = toImageSrc;

function fetchJsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = "__jsonp_cb_" + Date.now() + "_" + Math.floor(Math.random() * 10000);

    const cleanup = () => {
      try { delete window[cbName]; } catch {}
      script.remove();
    };

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    const script = document.createElement("script");
    const sep = url.includes("?") ? "&" : "?";
    script.src = `${url}${sep}callback=${cbName}&_=${Date.now()}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP load failed"));
    };

    document.head.appendChild(script);
  });
}

function generateId(list) {
  return list.reduce((m, i) => Math.max(m, Number(i.id) || 0), 0) + 1;
}

function debounce(fn, delay = 600) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

/* ---------- Save chip (feedback) ---------- */
function setSaveChipState(kind, msg = "") {
  const chip = document.getElementById("saveChip");
  if (!chip) return;

  if (kind === "saving") {
    chip.textContent = "儲存中…";
    chip.style.opacity = "1";
    chip.title = "";
  } else if (kind === "dirty") {
    chip.textContent = "未儲存";
    chip.style.opacity = "1";
    chip.title = "";
  } else if (kind === "error") {
    chip.textContent = "儲存失敗";
    chip.style.opacity = "1";
    chip.title = msg || "";
  } else {
    chip.textContent = "已儲存";
    chip.style.opacity = ".6";
    chip.title = "";
  }
}

/* ---------- Storage Adapter (local-first) ---------- */
function createStorageAdapter(mode) {
  // coalesce saves: 如果存檔中又觸發存檔，結束後再補一次
  let saving = false;
  let queued = false;

  async function loadLocal() {
    const s = await localforage.getItem(STORAGE_KEYS.subjects);
    const c = await localforage.getItem(STORAGE_KEYS.cards);
    subjects = Array.isArray(s) ? s : [];
    cards = Array.isArray(c) ? c : [];
  }

  async function saveLocal() {
    await localforage.setItem(STORAGE_KEYS.subjects, subjects);
    await localforage.setItem(STORAGE_KEYS.cards, cards);
  }

  async function loadDrive() {
    const data = await fetchJsonp(APPS_SCRIPT_URL);
    subjects = Array.isArray(data.subjects) ? data.subjects : [];
    cards = Array.isArray(data.cards) ? data.cards : [];
  }

  async function saveDrive() {
    const payload = JSON.stringify({ version: 1, subjects, cards });
    const form = new URLSearchParams();
    form.set("data", payload);

    // legacy no-cors: 看不到成功/失敗（未來 Cloud Run 可改成可讀回應）
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      body: form,
    });
  }

  async function loadAppdata() {
    await loadAppData();
  }

  async function saveAppdata() {
    await saveAppData();
  }

  async function load() {
    if (mode === "drive") return loadDrive();
    return loadLocal();
  }

  async function save() {
  if (saving) {
    queued = true;
    return { ok: true, queued: true };
  }

  saving = true;
  try {
    // 目前只保留你原本的兩種：drive / local
    if (mode === "drive") await saveDrive();
    else await saveLocal();

    saving = false;

    if (queued) {
      queued = false;
      return await save();
    }

    return { ok: true };
  } catch (e) {
    saving = false;
    return { ok: false, error: e };
  }
}

  return { mode, load, save };
}

const storage = createStorageAdapter(STORAGE_MODE);

/* ---------- Storage API (quiz.js expects persistAll) ---------- */
async function loadFromStorage() {
  await storage.load();

  // normalize SRS fields for quiz.js
  for (const c of cards) {
    if (c.ease == null) c.ease = 2.3;
    if (c.intervalDays == null) c.intervalDays = 0;
    if (c.lapses == null) c.lapses = 0;
    if (c.lastReviewedAt == null) c.lastReviewedAt = null;
    if (c.dueAt == null) c.dueAt = null;

    // ensure legacy single image fields exist
    if (!Array.isArray(c.questionImages)) c.questionImages = c.questionImage ? [String(c.questionImage)] : [];
    if (!Array.isArray(c.answerImages)) c.answerImages = c.answerImage ? [String(c.answerImage)] : [];
    c.questionImage = c.questionImages[0] || "";
    c.answerImage = c.answerImages[0] || "";
  }

  // expose globals to quiz.js
  window.subjects = subjects;
  window.cards = cards;
}

async function persistAll() {
  state.saving = true;
  state.lastSaveError = "";
  setSaveChipState("saving");

  const r = await storage.save();
  state.saving = false;

  if (!r.ok) {
    state.lastSaveError = String(r.error?.message || r.error || "unknown");
    setSaveChipState("error", state.lastSaveError);
    throw r.error;
  }

  state.dirty = false;
  setSaveChipState("saved");

  // keep globals in sync
  window.subjects = subjects;
  window.cards = cards;

  return true;
}
window.persistAll = persistAll;

/* ---------- Autosave ---------- */
const debouncedPersist = debounce(async () => {
  try {
    await persistAll();
  } catch (e) {
    console.error(e);
  }
}, 700);

function markDirty() {
  state.dirty = true;
  setSaveChipState("dirty");
  debouncedPersist();
}

/* ---------- Image helpers (paste/upload + compress) ---------- */
function pickPastedImagesFromClipboard(e) {
  const items = e.clipboardData?.items || [];
  const out = [];
  for (const it of items) {
    if (it.type && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

// ✅ 你原本用 <img> + canvas 壓縮（OK），我保留並加大一點壓縮力度避免 dataURL 太肥
async function compressImageToDataURL(fileOrBlob, maxW = 1400, quality = 0.82) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(fileOrBlob);
  });

  const scale = Math.min(1, maxW / img.width);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  URL.revokeObjectURL(img.src);
  return canvas.toDataURL("image/jpeg", quality);
}

/* ---------- Data helpers ---------- */
function getSubjectById(id) {
  return subjects.find((s) => Number(s.id) === Number(id)) || null;
}

function getSubjectName(id) {
  const s = getSubjectById(id);
  return s ? s.name : "（已刪除科目）";
}

function buildSummary(c) {
  const a = (c.answerText || "").trim();
  const e = (c.explanationText || "").trim();
  const q = (c.questionText || "").trim();
  if (a) return a.length > 60 ? a.slice(0, 60) + "…" : a;
  if (e) return e.length > 60 ? e.slice(0, 60) + "…" : e;

  const qi = Array.isArray(c.questionImages) ? c.questionImages : (c.questionImage ? [c.questionImage] : []);
  const ai = Array.isArray(c.answerImages) ? c.answerImages : (c.answerImage ? [c.answerImage] : []);
  if (qi.length || ai.length) return "（含圖片）";
  return q ? (q.length > 60 ? q.slice(0, 60) + "…" : q) : "點選以編輯";
}

function filteredCards() {
  const q = norm(state.query);
  return cards
    .filter((c) => {
      if (state.subjectId && Number(c.subjectId) !== Number(state.subjectId)) return false;
      if (state.chapter && (c.chapter || "") !== state.chapter) return false;
      if (!q) return true;

      const hay = norm(
        [
          getSubjectName(c.subjectId),
          c.chapter,
          c.questionText,
          c.answerText,
          c.explanationText,
        ].join(" ")
      );
      return hay.includes(q);
    })
    .sort((a, b) => Number(b.id) - Number(a.id));
}

function subjectChapters(subjectId) {
  const set = new Set();
  for (const c of cards) {
    if (Number(c.subjectId) !== Number(subjectId)) continue;
    const ch = (c.chapter || "").trim();
    if (ch) set.add(ch);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

/* ---------- Render: Subjects (left) ---------- */
function renderSubjects() {
  const el = document.getElementById("subjectsList");
  if (!el) return;

  if (!subjects.length) {
    el.innerHTML = `<div class="cards-empty">尚未建立科目</div>`;
    return;
  }

  el.innerHTML = subjects
    .slice()
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((s) => {
      const count = cards.filter((c) => Number(c.subjectId) === Number(s.id)).length;
      return `
      <div class="card-row ${Number(state.subjectId) === Number(s.id) ? "is-selected" : ""}" data-id="${s.id}">
        <div class="card-main">
          <div class="card-title">${escapeHtml(s.name)}</div>
          <div class="card-summary">${count} 題</div>
        </div>
      </div>`;
    })
    .join("");

  el.onclick = (e) => {
    const row = e.target.closest(".card-row");
    if (!row) return;
    state.subjectId = Number(row.dataset.id);
    state.chapter = "";
    state.selectedCardId = null;
    renderSubjects();
    renderChapters();
    renderCardsList();
    renderEditor();
  };
}

/* ---------- Render: Chapters (left) ---------- */
function renderChapters() {
  const el = document.getElementById("chaptersTree");
  if (!el) return;

  if (!state.subjectId) {
    el.innerHTML = `<div class="cards-empty">請先選擇科目</div>`;
    return;
  }

  const chapters = subjectChapters(state.subjectId);

  el.innerHTML = `
    <div class="card-row ${state.chapter === "" ? "is-selected" : ""}" data-ch="">
      <div class="card-main">
        <div class="card-title">全部章節</div>
        <div class="card-summary">顯示此科目全部題目</div>
      </div>
    </div>
    ${chapters
      .map((ch) => {
        const count = cards.filter(
          (c) => Number(c.subjectId) === Number(state.subjectId) && (c.chapter || "") === ch
        ).length;
        return `
        <div class="card-row ${state.chapter === ch ? "is-selected" : ""}" data-ch="${escapeHtml(ch)}">
          <div class="card-main">
            <div class="card-title">${escapeHtml(ch)}</div>
            <div class="card-summary">${count} 題</div>
          </div>
        </div>`;
      })
      .join("")}
  `;

  el.onclick = (e) => {
    const row = e.target.closest(".card-row");
    if (!row) return;
    state.chapter = row.dataset.ch || "";
    state.selectedCardId = null;
    renderChapters();
    renderCardsList();
    renderEditor();
  };
}

/* ---------- Render: Cards list (right/top) ---------- */
function renderCardsList() {
  const el = document.getElementById("cardsList");
  if (!el) return;

  const list = filteredCards();
  if (!list.length) {
    el.innerHTML = `<div class="cards-empty">尚無題目。按「＋ 新增題目」建立第一題。</div>`;
    return;
  }

  el.innerHTML = list
    .map((c) => {
      const title = (c.questionText || "").trim() || "（未命名題目）";
      const summary = buildSummary(c);
      const subjName = getSubjectName(c.subjectId);
      const chapter = (c.chapter || "").trim() || "—";
      return `
      <div class="card-row ${Number(state.selectedCardId) === Number(c.id) ? "is-selected" : ""}" data-id="${c.id}">
        <div class="card-main">
          <div class="card-title">${escapeHtml(title)}</div>
          <div class="card-summary">${escapeHtml(summary)}</div>
        </div>
        <div class="card-meta">
          <div class="pill">${escapeHtml(subjName)}</div>
          <div class="pill">${escapeHtml(chapter)}</div>
        </div>
      </div>`;
    })
    .join("");

  el.onclick = (e) => {
    const row = e.target.closest(".card-row");
    if (!row) return;
    state.selectedCardId = Number(row.dataset.id);
    renderCardsList();
    renderEditor();
  };
}

/* ---------- Render: Editor (right/bottom) ---------- */
function renderEditor() {
  const el = document.getElementById("editorArea");
  if (!el) return;

  if (!state.selectedCardId) {
    el.innerHTML = `<div class="empty">請選擇或新增一題</div>`;
    return;
  }

  const card = cards.find((c) => Number(c.id) === Number(state.selectedCardId));
  if (!card) {
    el.innerHTML = `<div class="empty">找不到此題目</div>`;
    return;
  }

  // Ensure fields exist
  card.chapter = card.chapter || "";
  card.questionText = card.questionText || "";
  card.answerText = card.answerText || "";
  card.explanationText = card.explanationText || "";

  if (!Array.isArray(card.questionImages)) {
    card.questionImages = card.questionImage ? [String(card.questionImage)] : [];
  }
  if (!Array.isArray(card.answerImages)) {
    card.answerImages = card.answerImage ? [String(card.answerImage)] : [];
  }
  // keep legacy single-image fields synced
  card.questionImage = card.questionImages[0] || "";
  card.answerImage = card.answerImages[0] || "";

  const qImgs = card.questionImages;
  const aImgs = card.answerImages;

  const renderGallery = (imgs, prefix) => {
    if (!imgs || !imgs.length) return `<div class="img-hint" id="${prefix}-img-preview">尚未設定圖片</div>`;
    return `
      <div class="img-gallery" id="${prefix}-img-preview">
        ${imgs
          .map((src, idx) => {
            const safeIdx = Number(idx) || 0;
            return `
              <div class="img-item" data-idx="${safeIdx}">
                <img class="img-preview" src="${toImageSrc(src)}" />
                <button type="button" class="btn ghost small img-del" data-idx="${safeIdx}">移除這張</button>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  };

  el.innerHTML = `
    <div class="editor-grid">
      <div class="field">
        <label>章節</label>
        <input class="input" id="ed-chapter" placeholder="例如：第一章、Ch1、回歸分析" value="${escapeHtml(card.chapter)}" />

        <div style="margin-top:8px;">
          <button type="button" id="btnDeleteCard" class="btn small ghost">刪除本題</button>
        </div>
      </div>

      <div class="field">
        <label>題目</label>
        <textarea class="input" id="ed-question" placeholder="輸入題目…">${escapeHtml(card.questionText)}</textarea>

        <div class="img-box">
          <div class="img-actions">
            <input type="file" id="q-img-file" accept="image/*" multiple />
            <button type="button" class="btn ghost small" id="q-img-remove">清空圖片</button>
          </div>
          <div class="img-hint">可在題目欄位 Ctrl+V 貼上圖片（可多張）</div>
          ${renderGallery(qImgs, "q")}
        </div>
      </div>

      <div class="field">
        <label>答案</label>
        <textarea class="input" id="ed-answer" placeholder="輸入答案…">${escapeHtml(card.answerText)}</textarea>

        <div class="img-box">
          <div class="img-actions">
            <input type="file" id="a-img-file" accept="image/*" multiple />
            <button type="button" class="btn ghost small" id="a-img-remove">清空圖片</button>
          </div>
          <div class="img-hint">可在答案欄位 Ctrl+V 貼上圖片（可多張）</div>
          ${renderGallery(aImgs, "a")}
        </div>
      </div>
    </div>
  `;

  const ch = document.getElementById("ed-chapter");
  const q = document.getElementById("ed-question");
  const a = document.getElementById("ed-answer");

  const syncLegacyImageFields = () => {
    card.questionImage = card.questionImages[0] || "";
    card.answerImage = card.answerImages[0] || "";
  };

  const syncText = () => {
    card.chapter = ch.value;          // 不 trim：避免 IME 游標跳
    card.questionText = q.value;
    card.answerText = a.value;
    window.cards = cards;
    markDirty();
  };

  // IME composing guard
  let composing = false;
  [ch, q, a].forEach((inp) => {
    inp.addEventListener("compositionstart", () => (composing = true));
    inp.addEventListener("compositionend", () => {
      composing = false;
      syncText();
    });
    inp.addEventListener("input", () => {
      if (composing) return;
      syncText();
    });
  });

  // blur 才重畫清單/章節（避免打字一直重畫）
  [ch, q, a].forEach((inp) => {
    inp.addEventListener("blur", () => {
      renderCardsList();
      renderChapters();
      renderSubjects();
    });
  });

  document.getElementById("btnDeleteCard")?.addEventListener("click", async () => {
    const ok = confirm("確定要刪除這一題嗎？此動作無法復原。");
    if (!ok) return;

    cards = cards.filter(c => Number(c.id) !== Number(card.id));
    window.cards = cards;
    state.selectedCardId = null;

    try {
      await persistAll();
    } catch (e) {
      console.error(e);
      alert("刪除後儲存失敗：請看右上角狀態（或 Console）");
    }

    renderCardsList();
    renderChapters();
    renderSubjects();
    renderEditor();
  });

  // Upload images
  const qFile = document.getElementById("q-img-file");
  const aFile = document.getElementById("a-img-file");

  const addImages = async (fileList, targetArr) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    for (const f of files) {
      try {
        const dataUrl = await compressImageToDataURL(f);
        targetArr.push(dataUrl);
      } catch (e) {
        console.warn("Image compress failed", e);
      }
    }
    syncLegacyImageFields();
    window.cards = cards;
    markDirty();
    renderEditor();
  };

  qFile.addEventListener("change", async () => {
    await addImages(qFile.files, card.questionImages);
    qFile.value = "";
  });

  aFile.addEventListener("change", async () => {
    await addImages(aFile.files, card.answerImages);
    aFile.value = "";
  });

  // Paste images
  q.addEventListener("paste", async (e) => {
    const files = pickPastedImagesFromClipboard(e);
    if (!files.length) return;
    e.preventDefault();
    await addImages(files, card.questionImages);
  });

  a.addEventListener("paste", async (e) => {
    const files = pickPastedImagesFromClipboard(e);
    if (!files.length) return;
    e.preventDefault();
    await addImages(files, card.answerImages);
  });

  // Clear images
  document.getElementById("q-img-remove")?.addEventListener("click", () => {
    card.questionImages = [];
    syncLegacyImageFields();
    window.cards = cards;
    markDirty();
    renderEditor();
  });

  document.getElementById("a-img-remove")?.addEventListener("click", () => {
    card.answerImages = [];
    syncLegacyImageFields();
    window.cards = cards;
    markDirty();
    renderEditor();
  });

  // Remove single image
  document.getElementById("q-img-preview")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".img-del");
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (!Number.isFinite(idx)) return;
    card.questionImages.splice(idx, 1);
    syncLegacyImageFields();
    window.cards = cards;
    markDirty();
    renderEditor();
  });

  document.getElementById("a-img-preview")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".img-del");
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (!Number.isFinite(idx)) return;
    card.answerImages.splice(idx, 1);
    syncLegacyImageFields();
    window.cards = cards;
    markDirty();
    renderEditor();
  });
}

/* ---------- Actions ---------- */
function addSubject() {
  const name = prompt("請輸入科目名稱（例如：統計、經濟）");
  if (!name) return;
  const clean = name.trim();
  if (!clean) return;

  const exists = subjects.some((s) => norm(s.name) === norm(clean));
  if (exists) {
    alert("此科目已存在");
    return;
  }

  const subject = { id: generateId(subjects), name: clean };
  subjects.push(subject);
  window.subjects = subjects;

  state.subjectId = subject.id;
  state.chapter = "";
  state.selectedCardId = null;

  markDirty();
  renderSubjects();
  renderChapters();
  renderCardsList();
  renderEditor();
}

function addCard() {
  if (!state.subjectId) {
    alert("請先選擇科目");
    return;
  }

  const card = {
    id: generateId(cards),
    subjectId: state.subjectId,
    chapter: state.chapter || "",
    questionText: "",
    answerText: "",
    explanationText: "",
    questionImages: [],
    answerImages: [],
    questionImage: "",
    answerImage: "",

    // SRS (quiz.js)
    ease: 2.3,
    intervalDays: 0,
    lapses: 0,
    lastReviewedAt: null,
    dueAt: null,
  };

  cards.unshift(card);
  window.cards = cards;

  state.selectedCardId = card.id;

  markDirty();
  renderCardsList();
  renderEditor();
  renderChapters();
  renderSubjects();
}

function initActions() {
  document.getElementById("btnAdd")?.addEventListener("click", addCard);
  document.getElementById("btnAddSubject")?.addEventListener("click", addSubject);

  const search = document.getElementById("search");
  if (search) {
    search.addEventListener("input", () => {
      state.query = search.value || "";
      renderCardsList();
    });
  }

  document.getElementById("btnExport")?.addEventListener("click", exportJSON);
  document.getElementById("btnImport")?.addEventListener("click", importJSON);

  document.getElementById("btnQuiz")?.addEventListener("click", () => {
    if (typeof window.startQuiz === "function") window.startQuiz();
    else alert("找不到測驗模組（quiz.js）。請確認 quiz.js 已載入。");
  });

  document.getElementById("btnSaveNow")?.addEventListener("click", async () => {
    if (state.saving) return;
    try {
      await persistAll();
    } catch (e) {
      console.error(e);
      alert("儲存失敗：請看右上角狀態（或 Console）");
    }
  });
}

// 離開頁面提示
window.addEventListener("beforeunload", (e) => {
  if (!state.dirty) return;
  e.preventDefault();
  e.returnValue = "";
});

/* ---------- Import / Export ---------- */
function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportJSON() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    subjects,
    cards,
  };
  downloadText("jill_quiz_export.json", JSON.stringify(payload, null, 2));
}

async function importJSON() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      alert("JSON 格式錯誤");
      return;
    }

    const newSubjects = Array.isArray(data.subjects) ? data.subjects : [];
    const newCards = Array.isArray(data.cards) ? data.cards : [];

    subjects = newSubjects
      .filter((s) => s && s.name)
      .map((s, i) => ({ id: Number(s.id) || i + 1, name: String(s.name) }));

    const idMap = new Map();
    let nextSid = 1;
    for (const s of subjects) {
      const old = s.id;
      s.id = nextSid++;
      idMap.set(old, s.id);
    }

    cards = newCards
      .filter((c) => c && (c.subjectId != null))
      .map((c, i) => {
        const qi = Array.isArray(c.questionImages)
          ? c.questionImages.map(String)
          : (c.questionImage ? [String(c.questionImage)] : []);
        const ai = Array.isArray(c.answerImages)
          ? c.answerImages.map(String)
          : (c.answerImage ? [String(c.answerImage)] : []);

        return {
          id: Number(c.id) || i + 1,
          subjectId: idMap.get(Number(c.subjectId)) ?? subjects[0]?.id ?? 1,
          chapter: String(c.chapter || ""),
          questionText: String(c.questionText || ""),
          answerText: String(c.answerText || ""),
          explanationText: String(c.explanationText || ""),
          questionImages: qi,
          answerImages: ai,
          questionImage: qi[0] || "",
          answerImage: ai[0] || "",

          ease: Number(c.ease) || 2.3,
          intervalDays: Number(c.intervalDays) || 0,
          lapses: Number(c.lapses) || 0,
          lastReviewedAt: c.lastReviewedAt ?? null,
          dueAt: c.dueAt ?? null,
        };
      });

    state.subjectId = subjects[0]?.id ?? null;
    state.chapter = "";
    state.selectedCardId = null;
    state.query = "";

    window.subjects = subjects;
    window.cards = cards;

    markDirty();      // 會自動存
    renderAll();
  };
  input.click();
}

/* ---------- Render all ---------- */
function renderAll() {
  renderSubjects();
  renderChapters();
  renderCardsList();
  renderEditor();
}

/* ---------- Boot ---------- */
window.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadFromStorage();
  } catch (err) {
    console.error(err);
    alert(String(err.message || err));
    return;
  }

  if (!subjects.length) {
    subjects = [{ id: 1, name: "統計" }];
    window.subjects = subjects;
    try { await persistAll(); } catch (e) { console.error(e); }
  }

  state.subjectId = subjects[0]?.id ?? null;
  state.chapter = "";
  state.selectedCardId = null;

  initActions();
  initCloudActions();
  renderAll();
  setSaveChipState("saved");
});


/* ---------- Lightbox (keep your previous IDs) ---------- */
(function setupImageLightbox(){
  let scale = 1;
  let tx = 0, ty = 0;
  let dragging = false;
  let lastX = 0, lastY = 0;

  const lb = document.getElementById("imgLightbox");
  const closeBtn = document.getElementById("imgLightboxClose");
  const backdrop = lb?.querySelector(".img-lightbox__backdrop");
  const stage = document.getElementById("imgLightboxStage");
  const img = document.getElementById("imgLightboxImg");

  if (!lb || !closeBtn || !backdrop || !stage || !img) return;

  function apply() {
    img.style.setProperty("--tx", `${tx}px`);
    img.style.setProperty("--ty", `${ty}px`);
    img.style.setProperty("--scale", String(scale));
  }

  function open(src) {
    img.src = src;
    scale = 1; tx = 0; ty = 0;
    apply();
    lb.classList.remove("hidden");
  }

  function close() {
    lb.classList.add("hidden");
    img.removeAttribute("src");
  }

  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", close);

  window.addEventListener("keydown", (e) => {
    if (lb.classList.contains("hidden")) return;
    if (e.key === "Escape") close();
  });

  stage.addEventListener("wheel", (e) => {
    if (lb.classList.contains("hidden")) return;
    e.preventDefault();

    const delta = e.deltaY > 0 ? -0.12 : 0.12;
    scale = Math.min(6, Math.max(0.5, scale + delta));
    apply();
  }, { passive: false });

  stage.addEventListener("mousedown", (e) => {
    if (lb.classList.contains("hidden")) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    tx += (e.clientX - lastX);
    ty += (e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  });

  window.addEventListener("mouseup", () => { dragging = false; });

  document.addEventListener("click", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLImageElement)) return;
    if (!el.classList.contains("img-preview")) return;
    if (!el.src) return;
    open(el.src);
  });
})();
