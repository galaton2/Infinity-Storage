"use strict";

/* ========== Telegram ========== */
const tg = window.Telegram?.WebApp || null;
try {
  tg?.ready?.();
  tg?.expand?.();
  tg?.setHeaderColor?.("#020204");
  tg?.setBackgroundColor?.("#020204");
} catch (_) {}

const user = tg?.initDataUnsafe?.user || null;
const API_URL = "https://galaxylab.i234.me:8443/api/files";

const AI = {
  together: {
    title: "Together AI",
    models: [
      ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Llama 3.3 70B"],
      ["meta-llama/Llama-3.1-8B-Instruct-Turbo", "Llama 3.1 8B"],
      ["Qwen/Qwen2.5-72B-Instruct-Turbo", "Qwen 2.5 72B"]
    ]
  },
  openai: {
    title: "OpenAI",
    models: [["gpt-4o-mini", "GPT-4o mini"], ["gpt-4.1-mini", "GPT-4.1 mini"]]
  },
  anthropic: {
    title: "Anthropic",
    models: [["claude-3-5-haiku-latest", "Claude 3.5 Haiku"]]
  },
  google: {
    title: "Google Gemini",
    models: [["gemini-2.0-flash", "Gemini 2.0 Flash"]]
  }
};

const initialDB = {
  notes: [],
  journal: [],
  chat: [],
  telegramTexts: {},
  stats: { streak: 0, lastLogin: null, wordsWritten: 0 },
  settings: {
    aiProvider: "together",
    aiModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    apiKeys: {},
    togetherApiKey: ""
  }
};

const folders = [
  { id: "smart_notes", name: "Заметки", icon: "brain", types: ["smart_note"] },
  { id: "telegram_texts", name: "Тексты Telegram", icon: "file", types: ["text"] },
  { id: "documents", name: "Документы", icon: "doc", types: ["document", "audio", "voice"] },
  { id: "media", name: "Медиа", icon: "image", types: ["photo", "video", "animation", "video_note"] }
];

const FOLDER_HINTS = {
  smart_notes: "Создайте первую заметку на главной",
  telegram_texts: "Отправьте боту текстовый файл",
  documents: "Отправьте боту документ или аудио",
  media: "Отправьте боту фото или видео"
};

const ICONS = {
  close: '<svg class="svg-icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  back: '<svg class="svg-icon" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>',
  refresh: '<svg class="svg-icon" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>',
  trash: '<svg class="svg-icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  play: '<svg class="svg-icon media-svg" viewBox="0 0 24 24"><polygon points="7 4 20 12 7 20 7 4"/></svg>',
  audio: '<svg class="svg-icon media-svg" viewBox="0 0 24 24"><path d="M9 18V6l12-3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="15" r="3"/></svg>',
  doc: '<svg class="svg-icon media-svg" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  empty: '<svg class="svg-icon" viewBox="0 0 24 24"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>',
  chevronLeft: '<svg class="svg-icon" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>',
  chevronRight: '<svg class="svg-icon" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>'
};

const MOODS = {
  sad: '<svg class="mood-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.5 16c1-1.5 2.1-2.2 3.5-2.2s2.5.7 3.5 2.2"/><path d="M8 9h.01M16 9h.01"/></svg>',
  calm: '<svg class="mood-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 14h8"/><path d="M8 9h.01M16 9h.01"/></svg>',
  good: '<svg class="mood-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 13c1.2 1.7 2.5 2.5 4 2.5s2.8-.8 4-2.5"/><path d="M8 9h.01M16 9h.01"/></svg>',
  great: '<svg class="mood-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M7.5 12.5c1.4 2.3 2.9 3.3 4.5 3.3s3.1-1 4.5-3.3"/><path d="M8 9h.01M16 9h.01"/></svg>'
};

const MEDIA_TILES = { video: "play", animation: "play", video_note: "play", audio: "audio", voice: "audio" };

let db = loadDB();
let files = [];
let filesError = false;
let activeFolder = null;
let searchQuery = "";
let mood = "calm";
let insightPeriod = "day";
let brainGraph = null;
let currentTab = "home";
let calendarOffset = 0;
let noteSaving = false;
let chatBusy = false;
let insightBusy = false;

/* ========== Утилиты ========== */

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clean(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function words(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((item) => item.length > 1);
}

function safeUrl(value) {
  try {
    const url = new URL(value, window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_) {
    return "";
  }
}

function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function debounce(fn, ms = 220) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

function fmtAgo(value) {
  const diff = Date.now() - new Date(value).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} дн назад`;
  return new Date(value).toLocaleDateString("ru-RU");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text, query) {
  const safe = esc(text);
  if (!query) return safe;
  try {
    return safe.replace(new RegExp(escapeRegExp(esc(query)), "gi"), (m) => `<mark>${m}</mark>`);
  } catch (_) {
    return safe;
  }
}

function confirmAction(message) {
  return new Promise((resolve) => {
    if (tg?.showConfirm) tg.showConfirm(message, (ok) => resolve(!!ok));
    else resolve(window.confirm(message));
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Скопировано", "success");
  } catch (_) {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
      toast("Скопировано", "success");
    } catch (e) {
      toast("Не удалось скопировать", "error");
    }
    area.remove();
  }
}

function haptic() {
  try {
    tg?.HapticFeedback?.selectionChanged?.();
  } catch (_) {}
}

function lockScroll() {
  const locked = !!document.querySelector(".note-details-overlay,.calendar-overlay");
  document.body.style.overflow = locked ? "hidden" : "";
}

/* ========== База ========== */

function loadDB() {
  try {
    const saved = JSON.parse(localStorage.getItem("infinityLocalDB"));
    const result = {
      ...clone(initialDB),
      ...(saved || {}),
      stats: { ...initialDB.stats, ...(saved?.stats || {}) },
      settings: { ...initialDB.settings, ...(saved?.settings || {}) }
    };

    result.notes = Array.isArray(result.notes) ? result.notes : [];
    result.journal = Array.isArray(result.journal) ? result.journal : [];
    result.chat = Array.isArray(result.chat) ? result.chat : [];
    result.telegramTexts ||= {};
    result.settings.apiKeys ||= {};

    if (result.settings.togetherApiKey && !result.settings.apiKeys.together) {
      result.settings.apiKeys.together = result.settings.togetherApiKey;
    }

    return result;
  } catch (_) {
    return clone(initialDB);
  }
}

function saveDB() {
  try {
    localStorage.setItem("infinityLocalDB", JSON.stringify(db));
  } catch (_) {
    /* localStorage переполнен — чистим кэш текстов и пробуем снова */
    db.telegramTexts = {};
    try {
      localStorage.setItem("infinityLocalDB", JSON.stringify(db));
    } catch (e) {}
  }
  updateStats();
  updateStorage();
}

function allItems() {
  return [
    ...files,
    ...db.notes.map((note) => ({
      internalId: `note_${note.id}`,
      id: note.id,
      type: "smart_note",
      title: note.title || "Заметка",
      text: note.text || "",
      tags: note.tags || [],
      date: note.date,
      size: new Blob([note.text || ""]).size
    }))
  ];
}

function fileSize(file) {
  const values = [
    file.size,
    file.file_size,
    file.fileSize,
    file.bytes,
    file.content_length,
    file.contentLength,
    file.document?.file_size,
    file.photo?.file_size,
    file.video?.file_size,
    file.audio?.file_size
  ];
  return Number(values.find((value) => Number(value) > 0) || 0);
}

function fmtSize(size) {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} КБ`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} МБ`;
  return `${(size / 1024 ** 3).toFixed(2)} ГБ`;
}

function updateStorage() {
  const total = allItems().reduce((sum, file) => sum + fileSize(file), 0);
  const visual = total ? Math.min(8 + Math.log10(total + 1) * 11, 96) : 0;

  document.getElementById("dataUsedText").textContent = fmtSize(total);
  document.getElementById("dataUsedFill").style.width = `${visual}%`;
  document.getElementById("storageRangeDot").style.left = `${visual}%`;
}

function updateStats() {
  document.getElementById("streakCounter").textContent = db.stats.streak || 0;
  document.getElementById("wordsCount").textContent = db.stats.wordsWritten || 0;
  document.getElementById("totalFilesCount").textContent = allItems().length;
}

function updateStreak() {
  const today = new Date().toDateString();
  if (db.stats.lastLogin === today) return;

  db.stats.streak =
    db.stats.lastLogin === new Date(Date.now() - 86400000).toDateString()
      ? Number(db.stats.streak || 0) + 1
      : 1;

  db.stats.lastLogin = today;
  saveDB();
}

/* ========== Настройки ИИ ========== */

function provider() {
  return AI[db.settings.aiProvider] ? db.settings.aiProvider : "together";
}

function model() {
  const models = AI[provider()].models;
  return models.some(([name]) => name === db.settings.aiModel)
    ? db.settings.aiModel
    : models[0][0];
}

function key() {
  const item = provider();
  return (db.settings.apiKeys?.[item] || (item === "together" ? db.settings.togetherApiKey : "") || "").trim();
}

function renderModels(name, selected = "") {
  const select = document.getElementById("aiModel");
  const models = AI[name].models;

  select.innerHTML = models
    .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`)
    .join("");

  const result = models.some(([value]) => value === selected) ? selected : models[0][0];
  select.value = result;
  return result;
}

function loadSettings() {
  const current = provider();
  document.getElementById("aiProvider").value = current;
  db.settings.aiModel = renderModels(current, db.settings.aiModel);
  document.getElementById("togetherApiKey").value = db.settings.apiKeys?.[current] || "";
}

function changeProvider() {
  const old = provider();
  const next = document.getElementById("aiProvider").value;

  db.settings.apiKeys[old] = document.getElementById("togetherApiKey").value.trim();
  db.settings.aiProvider = next;
  db.settings.aiModel = renderModels(next);
  document.getElementById("togetherApiKey").value = db.settings.apiKeys[next] || "";
}

function saveSettings() {
  const current = document.getElementById("aiProvider").value;
  db.settings.aiProvider = current;
  db.settings.aiModel = document.getElementById("aiModel").value;
  db.settings.apiKeys[current] = document.getElementById("togetherApiKey").value.trim();
  db.settings.togetherApiKey = db.settings.apiKeys.together || "";
  saveDB();
  toast("Сохранено", "success");
}

async function ai(system, prompt, limit = 550) {
  if (!key()) {
    toast("Добавьте API-ключ в настройках ИИ", "error");
    return null;
  }

  try {
    let response;
    let text = "";

    if (provider() === "together" || provider() === "openai") {
      response = await fetch(
        provider() === "together"
          ? "https://api.together.xyz/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model(),
            temperature: 0.35,
            max_tokens: limit,
            messages: [{ role: "system", content: system }, { role: "user", content: prompt }]
          })
        }
      );

      if (!response.ok) throw new Error();
      text = (await response.json()).choices?.[0]?.message?.content || "";
    }

    if (provider() === "anthropic") {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key(), "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model(),
          max_tokens: limit,
          system,
          messages: [{ role: "user", content: prompt }]
        })
      });

      if (!response.ok) throw new Error();
      text = (await response.json()).content?.[0]?.text || "";
    }

    if (provider() === "google") {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model())}:generateContent?key=${encodeURIComponent(key())}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }]
          })
        }
      );

      if (!response.ok) throw new Error();
      text = (await response.json()).candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    return text.trim() || null;
  } catch (_) {
    toast("Не удалось получить ответ ИИ", "error");
    return null;
  }
}

/* ========== Загрузка файлов с сервера ========== */

function isTextFile(file) {
  const name = `${file.name || ""} ${file.file_name || ""} ${file.title || ""}`.toLowerCase();
  const mime = String(file.mime_type || file.mime || file.content_type || "").toLowerCase();

  return (
    file.type === "text" ||
    mime.startsWith("text/") ||
    /\.(txt|md|csv|json|log|html|css|js|xml)$/i.test(name)
  );
}

async function readTelegramText(file) {
  const id = file.id || file.internalId;
  if (file.text) return file.text;
  if (db.telegramTexts[id]) return db.telegramTexts[id];

  const url = safeUrl(file.url);
  if (!url || !isTextFile(file)) return "";

  try {
    const response = await fetch(url);
    if (!response.ok) return "";

    const text = (await response.text()).slice(0, 100000);
    db.telegramTexts[id] = text;
    saveDB();
    return text;
  } catch (_) {
    return "";
  }
}

function renderSkeletons() {
  const grid = document.getElementById("folderGridView");
  const content = document.getElementById("folderContentsView");
  const topbar = document.getElementById("filesTopbar");

  if (activeFolder) {
    grid.hidden = true;
    content.hidden = false;
    topbar.innerHTML = '<span class="files-topbar-title">…</span>';
    document.getElementById("folderGallery").innerHTML =
      Array.from({ length: 8 }, () => '<div class="skeleton-card"></div>').join("");
  } else {
    grid.hidden = false;
    content.hidden = true;
    topbar.innerHTML = '<span class="files-topbar-title">Файлы</span>';
    document.getElementById("folderGrid").innerHTML =
      Array.from({ length: 4 }, () => '<div class="skeleton-card"></div>').join("");
  }
}

async function loadFiles() {
  renderSkeletons();

  try {
    const response = await fetch(
      `${API_URL}?user_id=${encodeURIComponent(user?.id || "browser-user")}&limit=100`
    );

    if (!response.ok) throw new Error();
    const data = await response.json();
    filesError = false;

    files = await Promise.all((data.files || []).map(async (file, index) => {
      const item = {
        ...file,
        internalId: `server_${file.id || index}`,
        id: file.id || `server_${index}`,
        type: file.type || file.file_type || "document",
        title: file.title || file.name || file.file_name || "Файл",
        text: file.text || file.caption || "",
        url: file.url || file.file_url || "",
        size: fileSize(file)
      };

      if (isTextFile(item)) {
        item.type = "text";
        item.text = await readTelegramText(item);
      }

      return item;
    }));
  } catch (_) {
    files = [];
    filesError = true;
    toast("Не удалось загрузить файлы", "error");
  }

  updateStorage();
  updateStats();
  renderFiles();
}

/* ========== Заметки ========== */

function noteCounter() {
  const input = document.getElementById("smartNoteInput");
  document.getElementById("noteCharCounter").textContent = `${input.value.length} / ${input.maxLength}`;
}

function autosize(el) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
}

function bindAutosize(el) {
  el.addEventListener("input", () => autosize(el));
}

async function saveSmartNote() {
  if (noteSaving) return;

  const input = document.getElementById("smartNoteInput");
  const text = input.value.trim();
  if (!text) return toast("Напишите мысль", "error");

  noteSaving = true;
  input.value = "";
  input.style.height = "";
  noteCounter();

  let title = text.slice(0, 60);
  let tags = [];

  if (key()) {
    const result = await ai(
      'Верни только JSON: {"title":"короткий заголовок","tags":["тег"]}. До 5 тегов.',
      text,
      180
    );

    try {
      const parsed = JSON.parse(result?.match(/\{[\s\S]*\}/)?.[0] || "{}");
      title = String(parsed.title || title).slice(0, 90);
      tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5).map(String) : [];
    } catch (_) {}
  }

  db.notes.unshift({ id: Date.now(), title, text, tags, date: new Date().toISOString() });
  db.stats.wordsWritten += words(text).length;
  saveDB();
  renderFiles();
  noteSaving = false;
  haptic();
  toast("Заметка сохранена", "success");
}

function deleteNote(id) {
  db.notes = db.notes.filter((note) => note.id !== id);
  saveDB();
  renderFiles();
  toast("Заметка удалена");
}

function startEditNote(note) {
  const input = document.getElementById("smartNoteInput");

  db.notes = db.notes.filter((item) => item.id !== note.id);
  saveDB();
  renderFiles();

  input.value = note.text || "";
  noteCounter();
  autosize(input);
  switchTab("home", document.getElementById("nav-home"));
  input.focus();
  toast("Заметка открыта для редактирования");
}

/* ========== Дневник ========== */

function setMood(value) {
  const changed = mood !== value;
  mood = value;

  document.querySelectorAll(".journal-mood-selector button").forEach((button) => {
    button.classList.toggle("selected", button.getAttribute("onclick")?.includes(`'${value}'`));
  });

  if (changed) haptic();
}

function saveJournal() {
  const input = document.getElementById("journalInput");
  const text = input.value.trim();
  if (!text) return toast("Введите запись", "error");

  db.journal.unshift({ id: Date.now(), text, mood, date: new Date().toISOString() });
  db.stats.wordsWritten += words(text).length;
  input.value = "";
  input.style.height = "";
  saveDB();
  haptic();
  toast("Запись сохранена", "success");
}

/* ========== Файлы: рендер ========== */

const byDateDesc = (a, b) => new Date(b.date || 0) - new Date(a.date || 0);

function matchItem(item) {
  const text = `${item.title} ${item.text} ${(item.tags || []).join(" ")}`.toLowerCase();
  return text.includes(searchQuery);
}

function itemCard(item, query = "") {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `grid-item ${esc(item.type)}`;

  const url = safeUrl(item.url);
  const tileIcon = MEDIA_TILES[item.type];

  if (item.type === "photo" && url) {
    card.innerHTML = `<img src="${url}" alt="${esc(item.title)}" loading="lazy" decoding="async">`;
    card.onclick = () => openMedia(item);
  } else if (tileIcon && url) {
    card.innerHTML = `<span class="media-tile">${ICONS[tileIcon]}</span><span class="media-tile-label">${esc(item.title)}</span>`;
    card.onclick = () => openMedia(item);
  } else if (url && !clean(item.text)) {
    card.innerHTML = `<span class="media-tile">${ICONS.doc}</span><span class="media-tile-label">${esc(item.title)}</span>`;
    card.onclick = () => openDetails(item);
  } else {
    const body = clean(item.text).slice(0, 220);
    card.innerHTML = `
      <div class="text-card-body">
        <strong>${highlight(item.title, query)}</strong>
        <br><br>
        ${body ? highlight(body, query) : '<span class="text-muted">Текст не был передан сервером</span>'}
      </div>
    `;
    card.onclick = () => openDetails(item);
  }

  return card;
}

function emptyState(text, hint = "", retry = false) {
  return `
    <div class="empty-state">
      ${ICONS.empty}
      <p>${esc(text)}</p>
      ${hint ? `<small>${esc(hint)}</small>` : ""}
      ${retry ? '<button class="sheet-btn" type="button" onclick="loadFiles()">Повторить</button>' : ""}
    </div>
  `;
}

function renderFiles() {
  const grid = document.getElementById("folderGridView");
  const content = document.getElementById("folderContentsView");
  const topbar = document.getElementById("filesTopbar");
  const gallery = document.getElementById("folderGallery");

  /* Глобальный поиск из корня */
  if (searchQuery && !activeFolder) {
    grid.hidden = true;
    content.hidden = false;

    const items = allItems().filter(matchItem).sort(byDateDesc);

    topbar.innerHTML = `
      <button class="icon-btn" type="button" onclick="closeSearch()" aria-label="Назад">${ICONS.back}</button>
      <span class="files-topbar-title">Поиск</span>
      <span class="files-topbar-count">${items.length} ${plural(items.length, ["совпадение", "совпадения", "совпадений"])}</span>
    `;

    gallery.innerHTML = items.length ? "" : emptyState("Ничего не найдено", "Попробуйте другой запрос");
    items.forEach((item) => gallery.appendChild(itemCard(item, searchQuery)));

    syncBackButton();
    return;
  }

  /* Корень: папки */
  if (!activeFolder) {
    grid.hidden = false;
    content.hidden = true;

    topbar.innerHTML = `
      <span class="files-topbar-title">Файлы</span>
      <button class="icon-btn" type="button" onclick="loadFiles()" aria-label="Обновить">${ICONS.refresh}</button>
    `;

    document.getElementById("folderGrid").innerHTML = folders.map((folder) => {
      const count = allItems().filter((item) => folder.types.includes(item.type)).length;

      return `
        <button class="folder-card" type="button" onclick="openFolder('${folder.id}')">
          <span class="folder-card-icon folder-icon-${folder.icon}"></span>
          <span class="folder-card-name">${esc(folder.name)}</span>
          <span class="folder-card-count">${count} ${plural(count, ["файл", "файла", "файлов"])}</span>
        </button>
      `;
    }).join("");

    syncBackButton();
    return;
  }

  /* Внутри папки */
  grid.hidden = true;
  content.hidden = false;

  const folder = folders.find((item) => item.id === activeFolder);
  const items = allItems()
    .filter((item) => folder.types.includes(item.type) && (!searchQuery || matchItem(item)))
    .sort(byDateDesc);

  topbar.innerHTML = `
    <button class="icon-btn" type="button" onclick="closeFolder()" aria-label="Назад">${ICONS.back}</button>
    <span class="files-topbar-title">${esc(folder.name)}</span>
    <span class="files-topbar-count">${items.length} ${plural(items.length, ["элемент", "элемента", "элементов"])}</span>
  `;

  gallery.innerHTML = "";

  if (!items.length) {
    gallery.innerHTML = filesError && folder.id !== "smart_notes"
      ? emptyState("Не удалось загрузить файлы", "Проверьте соединение", true)
      : emptyState("Здесь пока пусто", FOLDER_HINTS[folder.id] || "");
  } else {
    items.forEach((item) => gallery.appendChild(itemCard(item, searchQuery)));
  }

  syncBackButton();
}

function openFolder(id) {
  activeFolder = id;
  searchQuery = "";
  document.getElementById("searchInput").value = "";
  renderFiles();
  haptic();
}

function closeFolder() {
  activeFolder = null;
  searchQuery = "";
  document.getElementById("searchInput").value = "";
  renderFiles();
}

function closeSearch() {
  searchQuery = "";
  document.getElementById("searchInput").value = "";
  renderFiles();
}

const renderAfterSearch = debounce(() => renderFiles(), 220);

function handleSearch() {
  searchQuery = document.getElementById("searchInput").value.trim().toLowerCase();
  renderAfterSearch();
}

/* ========== Чат ========== */

function relevant(question) {
  const query = words(question);

  return db.notes
    .map((note) => ({
      ...note,
      score: query.reduce(
        (score, word) =>
          score + (words(`${note.title} ${note.text} ${(note.tags || []).join(" ")}`).includes(word) ? 1 : 0),
        0
      )
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function mdLite(text) {
  return esc(text)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

function chatMessage(text, role, sources = [], save = false) {
  const box = document.getElementById("chatContainer");
  const item = document.createElement("div");
  item.className = `chat-msg ${role}`;

  if (role === "ai") item.innerHTML = mdLite(text);
  else item.textContent = text;

  if (sources.length) {
    const sourceBox = document.createElement("div");
    sourceBox.className = "chat-sources";

    sources.forEach((source) => {
      const button = document.createElement("button");
      button.className = "chat-source";
      button.textContent = source.title;
      button.onclick = () => openDetails(source);
      sourceBox.appendChild(button);
    });

    item.appendChild(sourceBox);
  }

  box.appendChild(item);
  box.scrollTop = box.scrollHeight;

  if (save) {
    db.chat.push({
      role,
      text,
      sources: sources.map((source) => ({ id: source.id, title: source.title }))
    });
    db.chat = db.chat.slice(-60);
    saveDB();
  }

  return item;
}

function chatTyping() {
  const box = document.getElementById("chatContainer");
  const item = document.createElement("div");
  item.className = "chat-msg ai chat-typing";
  item.innerHTML = "<span></span><span></span><span></span>";
  box.appendChild(item);
  box.scrollTop = box.scrollHeight;
  return item;
}

function renderChatHistory() {
  const box = document.getElementById("chatContainer");
  box.innerHTML = "";

  if (!db.chat.length) {
    box.innerHTML = '<div class="chat-msg ai">Спросите о заметках, мыслях или дневнике.</div>';
    return;
  }

  db.chat.forEach((message) => chatMessage(message.text, message.role, message.sources || []));
}

async function clearChat() {
  const ok = await confirmAction("Очистить историю чата?");
  if (!ok) return;

  db.chat = [];
  saveDB();
  renderChatHistory();
  toast("История очищена");
}

async function sendChatMessage() {
  if (chatBusy) return;

  const input = document.getElementById("chatInput");
  const question = input.value.trim();
  if (!question) return;

  chatBusy = true;
  input.value = "";
  haptic();
  chatMessage(question, "user", [], true);

  const notes = relevant(question);
  if (!notes.length && !db.journal.length) {
    chatMessage("Не нашёл записей. Сначала сохраните пару мыслей на главной или запись в дневнике.", "ai", [], true);
    chatBusy = false;
    return;
  }

  const notesCtx = notes
    .map((note, index) => `[${index + 1}] ${note.title}\n${note.text.slice(0, 1000)}`)
    .join("\n\n");

  const journalCtx = db.journal
    .slice(0, 3)
    .map((entry, index) => `[J${index + 1}] Дневник (${entry.mood || "—"}): ${entry.text.slice(0, 600)}`)
    .join("\n\n");

  const context = [notesCtx, journalCtx].filter(Boolean).join("\n\n");
  const loading = chatTyping();

  const answer = await ai(
    "Отвечай только по контексту, кратко, по-русски. Если ответа нет — скажи это.",
    context + `\n\nВОПРОС:\n${question}`,
    420
  );

  loading.remove();
  chatMessage(answer || "Не удалось ответить. Проверьте API-ключ в настройках ИИ.", "ai", notes, true);
  chatBusy = false;
}

function handleChatKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
  }
}

/* ========== Карта нейронов ========== */

function links(notes) {
  const result = [];
  const degree = {};

  notes.forEach((a, i) => notes.slice(i + 1).forEach((b) => {
    const tags = new Set((a.tags || []).map((tag) => tag.toLowerCase()));
    const common = (b.tags || []).filter((tag) => tags.has(tag.toLowerCase()));

    if (common.length) {
      result.push({ source: `note_${a.id}`, target: `note_${b.id}`, strength: common.length });
    }
  }));

  return result
    .sort((a, b) => b.strength - a.strength)
    .filter((link) => {
      if ((degree[link.source] || 0) >= 3 || (degree[link.target] || 0) >= 3) return false;
      degree[link.source] = (degree[link.source] || 0) + 1;
      degree[link.target] = (degree[link.target] || 0) + 1;
      return true;
    });
}

function openBrainMap() {
  const modal = document.getElementById("brainMapModal");
  const mount = document.getElementById("3d-graph");

  modal.classList.add("active");
  mount.innerHTML = "";

  if (!db.notes.length || typeof window.ForceGraph3D !== "function") {
    mount.innerHTML = '<p class="brain-empty-message">Добавьте несколько заметок с тегами — они станут нейронами карты.</p>';
    syncBackButton();
    return;
  }

  const nodes = db.notes.map((note) => ({
    id: `note_${note.id}`,
    note,
    name: note.title,
    description: clean(note.text).slice(0, 150),
    color: "#5b8cff",
    val: 3 + Math.min((note.tags || []).length, 5)
  }));

  brainGraph = window
    .ForceGraph3D()(mount)
    .graphData({ nodes, links: links(db.notes) })
    .backgroundColor("#020204")
    .nodeVal("val")
    .nodeColor("color")
    .nodeLabel((node) => `<b>${esc(node.name)}</b><br>${esc(node.description)}`)
    .linkColor((link) => link.strength > 1 ? "rgba(160,120,255,.75)" : "rgba(91,140,255,.45)")
    .linkWidth((link) => 0.8 + link.strength * 0.7)
    .linkDirectionalParticles(1)
    .linkDirectionalParticleWidth(1.5)
    .onNodeClick((node) => openDetails(node.note))
    .onNodeHover((node) => { mount.style.cursor = node ? "pointer" : "grab"; });

  brainGraph.controls().enableDamping = true;
  brainGraph.controls().dampingFactor = 0.1;
  brainGraph.d3Force("charge")?.strength(-125);
  brainGraph.d3Force("link")?.distance(100);

  document.getElementById("brainSearchInput").oninput = (event) => {
    const query = event.target.value.trim().toLowerCase();
    const found = nodes.find((node) => node.name.toLowerCase().includes(query));

    if (found) {
      brainGraph.cameraPosition(
        { x: found.x + 50, y: found.y + 50, z: found.z + 110 },
        found,
        600
      );
    }
  };

  setTimeout(() => brainGraph.zoomToFit(650, 70), 200);
  syncBackButton();
}

function toggleBrainHelp() {
  const help = document.getElementById("brainHelp");
  help.hidden = !help.hidden;
}

function closeBrainMap() {
  brainGraph?._destructor?.();
  brainGraph = null;
  document.getElementById("brainMapModal").classList.remove("active");
  syncBackButton();
}

/* ========== Полная заметка и медиа ========== */

function openDetails(item) {
  document.getElementById("details-overlay")?.remove();

  const isNote = item.type === "smart_note" || !item.internalId;
  const note = isNote ? db.notes.find((n) => n.id === item.id) : null;
  const data = note || item;

  const date = new Date(data.date || item.date || Date.now());
  const url = safeUrl(item.url || data.url);
  const tags = (data.tags || item.tags || []).slice(0, 8);
  const fallbackText = isNote && !note
    ? "Эта заметка была удалена."
    : "Сервер не передал содержимое файла.";

  const overlay = document.createElement("div");
  overlay.id = "details-overlay";
  overlay.className = "note-details-overlay";

  overlay.innerHTML = `
    <section class="note-details-card" role="dialog" aria-modal="true">
      <button class="note-details-close" type="button" aria-label="Закрыть">${ICONS.close}</button>
      <div class="note-details-date">${esc(date.toLocaleString("ru-RU"))} · ${fmtAgo(date)}</div>
      <h2>${esc(data.title || item.title || "Файл")}</h2>
      ${tags.length ? `<div class="details-tags">${tags.map((tag) => `<button class="chat-source" type="button" data-tag="${esc(tag)}">${esc(tag)}</button>`).join("")}</div>` : ""}
      <div class="note-details-text">${esc(data.text || item.text || fallbackText).replaceAll("\n", "<br>")}</div>
      <div class="note-details-actions">
        <button class="sheet-btn" type="button" data-action="copy">Копировать</button>
        ${url ? '<button class="sheet-btn" type="button" data-action="open">Открыть файл</button>' : ""}
        ${isNote ? '<button class="sheet-btn" type="button" data-action="edit">Изменить</button><button class="sheet-btn btn-danger" type="button" data-action="delete">Удалить</button>' : ""}
      </div>
    </section>
  `;

  overlay.onclick = (event) => {
    if (event.target === overlay || event.target.closest(".note-details-close")) closeDetails();
  };

  overlay.querySelector("[data-action=copy]").onclick = () => copyText(data.text || item.text || "");

  const openBtn = overlay.querySelector("[data-action=open]");
  if (openBtn) {
    openBtn.onclick = () => {
      if (tg?.openLink) tg.openLink(url);
      else window.open(url, "_blank");
    };
  }

  const editBtn = overlay.querySelector("[data-action=edit]");
  if (editBtn) {
    editBtn.onclick = () => {
      closeDetails();
      startEditNote(data);
    };
  }

  const deleteBtn = overlay.querySelector("[data-action=delete]");
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      const ok = await confirmAction("Удалить заметку?");
      if (!ok) return;
      deleteNote(data.id);
      closeDetails();
    };
  }

  overlay.querySelectorAll("[data-tag]").forEach((button) => {
    button.onclick = () => {
      closeDetails();
      searchTag(button.dataset.tag);
    };
  });

  document.body.appendChild(overlay);
  lockScroll();
  syncBackButton();
}

function closeDetails() {
  document.getElementById("details-overlay")?.remove();
  lockScroll();
  syncBackButton();
}

function searchTag(tag) {
  switchTab("files", document.getElementById("nav-files"));
  activeFolder = "smart_notes";
  searchQuery = String(tag).toLowerCase();
  document.getElementById("searchInput").value = tag;
  renderFiles();
}

function openMedia(file) {
  const url = safeUrl(file.url);
  if (!url) return;

  const box = document.getElementById("modalContent");
  const type = file.type;

  if (["video", "animation", "video_note"].includes(type)) {
    box.innerHTML = `<video src="${url}" controls autoplay playsinline></video>`;
  } else if (["audio", "voice"].includes(type)) {
    box.innerHTML = `<audio src="${url}" controls autoplay></audio>`;
  } else {
    box.innerHTML = `<img src="${url}" alt="${esc(file.title)}">`;
  }

  document.getElementById("mediaModal").classList.add("active");
  syncBackButton();
  haptic();
}

function closeModal() {
  document.getElementById("mediaModal").classList.remove("active");
  document.getElementById("modalContent").innerHTML = "";
  syncBackButton();
}

/* ========== Календарь дневника ========== */

function openJournalCalendar() {
  document.querySelector(".calendar-overlay")?.remove();
  calendarOffset = 0;

  const overlay = document.createElement("div");
  overlay.className = "calendar-overlay";
  overlay.innerHTML = '<section class="calendar-card"></section>';

  overlay.onclick = (event) => {
    if (event.target === overlay || event.target.closest(".calendar-close")) {
      overlay.remove();
      lockScroll();
      syncBackButton();
    }
  };

  document.body.appendChild(overlay);
  renderCalendar(overlay.querySelector(".calendar-card"));
  lockScroll();
  syncBackButton();
}

function renderCalendar(card) {
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + calendarOffset);

  const year = base.getFullYear();
  const month = base.getMonth();
  const now = new Date();
  const saved = new Set(db.journal.map((entry) => dateKey(entry.date)));
  const start = (new Date(year, month, 1).getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();

  let days = "";

  for (let day = 1; day <= count; day += 1) {
    const key = dateKey(new Date(year, month, day));
    const has = saved.has(key);
    const isToday = key === dateKey(now);

    days += `<button type="button" class="calendar-day ${has ? "has-entry" : "no-entry"} ${isToday ? "today" : ""}" ${has ? `data-day="${key}"` : ""}>${day}</button>`;
  }

  card.innerHTML = `
    <button class="calendar-close" type="button" aria-label="Закрыть">${ICONS.close}</button>
    <div class="calendar-nav">
      <button type="button" class="calendar-nav-btn" data-shift="-1" aria-label="Предыдущий месяц">${ICONS.chevronLeft}</button>
      <h2>${base.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}</h2>
      <button type="button" class="calendar-nav-btn" data-shift="1" aria-label="Следующий месяц">${ICONS.chevronRight}</button>
    </div>
    <div class="calendar-grid">${"<span></span>".repeat(start)}${days}</div>
  `;

  card.querySelectorAll(".calendar-nav-btn").forEach((button) => {
    button.onclick = () => {
      calendarOffset += Number(button.dataset.shift);
      renderCalendar(card);
      haptic();
    };
  });

  card.querySelectorAll("[data-day]").forEach((button) => {
    button.onclick = () => openJournalDay(button.dataset.day);
  });
}

function openJournalDay(key) {
  const entries = db.journal
    .filter((entry) => dateKey(entry.date) === key)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!entries.length) return;

  document.querySelector(".journal-day-overlay")?.remove();

  const [y, m, d] = key.split("-").map(Number);
  const dayLabel = new Date(y, m - 1, d).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });

  const overlay = document.createElement("div");
  overlay.className = "calendar-overlay journal-day-overlay";

  overlay.innerHTML = `
    <section class="note-details-card">
      <button class="note-details-close" type="button" aria-label="Закрыть">${ICONS.close}</button>
      <div class="note-details-date">${esc(dayLabel)}</div>
      ${entries.map((entry) => `
        <article class="journal-entry">
          <div class="journal-entry-head">
            ${MOODS[entry.mood] || ""}
            <span>${esc(new Date(entry.date).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }))}</span>
            <button type="button" class="journal-entry-del" data-id="${entry.id}" aria-label="Удалить запись">${ICONS.trash}</button>
          </div>
          <div class="journal-entry-text">${esc(entry.text)}</div>
        </article>
      `).join("")}
    </section>
  `;

  overlay.onclick = (event) => {
    if (event.target === overlay || event.target.closest(".note-details-close")) {
      overlay.remove();
      lockScroll();
      syncBackButton();
    }
  };

  overlay.querySelectorAll(".journal-entry-del").forEach((button) => {
    button.onclick = async () => {
      const ok = await confirmAction("Удалить запись дневника?");
      if (!ok) return;

      db.journal = db.journal.filter((entry) => entry.id !== Number(button.dataset.id));
      saveDB();

      overlay.remove();
      const calendarCard = document.querySelector(".calendar-overlay:not(.journal-day-overlay) .calendar-card");
      if (calendarCard) renderCalendar(calendarCard);

      lockScroll();
      syncBackButton();
      toast("Запись удалена");
    };
  });

  document.body.appendChild(overlay);
  lockScroll();
  syncBackButton();
}

/* ========== Активность и портрет ========== */

function renderActivity() {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const key = dateKey(date);

    return {
      label: date.toLocaleDateString("ru-RU", { weekday: "short" }).slice(0, 2),
      count: db.notes.filter((item) => dateKey(item.date) === key).length +
        db.journal.filter((item) => dateKey(item.date) === key).length
    };
  });

  const max = Math.max(1, ...days.map((day) => day.count));
  document.getElementById("activityTotal").textContent = days.reduce((sum, day) => sum + day.count, 0);

  document.getElementById("activityChart").innerHTML = days
    .map((day) => `<div class="activity-bar-wrap"><div class="activity-bar" style="height:${Math.max(8, day.count / max * 100)}%"></div><span class="activity-label">${day.label}</span></div>`)
    .join("");
}

async function generateDailyInsight() {
  if (insightBusy) return;

  const button = document.querySelector(".insight-card .primary-btn");
  const area = document.getElementById("dailyInsightContent");

  const end = new Date();
  const start = new Date();
  if (insightPeriod === "week") start.setDate(end.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  const records = [...db.notes, ...db.journal]
    .filter((item) => new Date(item.date) >= start)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8)
    .map((item) => `${item.title || "Дневник"}: ${String(item.text).slice(0, 550)}`)
    .join("\n---\n");

  if (!records) {
    area.textContent = "За выбранный период нет записей.";
    return;
  }

  insightBusy = true;
  const label = button.textContent;
  button.textContent = "Создаю…";
  button.disabled = true;
  area.textContent = "Создаю портрет…";

  const result = await ai(
    "Сделай бережный краткий портрет человека только по записям. Что он может чувствовать, о чём думает, что ему может помочь. Не ставь диагнозов. До 5 предложений.",
    records,
    260
  );

  area.textContent = result || "Не удалось создать портрет. Проверьте API-ключ.";
  button.textContent = label;
  button.disabled = false;
  insightBusy = false;
}

/* ========== Экспорт и импорт ========== */

function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `infinity-backup-${dateKey(new Date())}.json`;
  link.click();

  URL.revokeObjectURL(url);
  toast("Экспортировано", "success");
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.notes)) throw new Error();

      /* страховочный бэкап старых данных */
      const backup = localStorage.getItem("infinityLocalDB");
      if (backup) {
        try { localStorage.setItem("infinityBackup", backup); } catch (e) {}
      }

      localStorage.setItem("infinityLocalDB", JSON.stringify(parsed));
      toast("Импортировано", "success");
      setTimeout(() => location.reload(), 600);
    } catch (_) {
      toast("Файл повреждён или имеет неверный формат", "error");
    }
    event.target.value = "";
  };
  reader.readAsText(file);
}

/* ========== Навигация, кнопка «Назад», тосты ========== */

function switchTab(id, button) {
  currentTab = id;

  document.querySelectorAll(".tab-content").forEach((item) => item.classList.remove("active"));
  document.getElementById(`tab-${id}`).classList.add("active");

  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  (button || document.getElementById(`nav-${id}`))?.classList.add("active");

  if (id === "profile") renderActivity();
  haptic();
  syncBackButton();
}

function syncBackButton() {
  const bb = tg?.BackButton;
  if (!bb) return;

  const overlayOpen = !!document.querySelector(".note-details-overlay,.calendar-overlay") ||
    document.getElementById("brainMapModal").classList.contains("active") ||
    document.getElementById("mediaModal").classList.contains("active");

  const visible = currentTab !== "home" || activeFolder || searchQuery || overlayOpen;

  try {
    visible ? bb.show() : bb.hide();
  } catch (_) {}
}

function backAction(canSwitchTab = true) {
  if (document.getElementById("brainMapModal").classList.contains("active")) return closeBrainMap();
  if (document.getElementById("mediaModal").classList.contains("active")) return closeModal();

  const details = document.getElementById("details-overlay");
  if (details) return closeDetails();

  const overlays = [...document.querySelectorAll(".calendar-overlay")];
  if (overlays.length) {
    overlays.pop().remove();
    lockScroll();
    return syncBackButton();
  }

  if (activeFolder) return closeFolder();
  if (searchQuery) return closeSearch();
  if (canSwitchTab && currentTab !== "home") return switchTab("home", document.getElementById("nav-home"));
}

try {
  tg?.BackButton?.onClick(() => backAction(true));
} catch (_) {}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") backAction(false);
});

function toast(text, type = "") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = text;
  document.getElementById("toast-box").appendChild(item);

  setTimeout(() => item.classList.add("toast-out"), 2600);
  setTimeout(() => item.remove(), 3000);
}

/* ========== Инициализация ========== */

async function init() {
  const name = user?.first_name || "Пользователь";

  document.getElementById("userName").textContent = name;
  document.getElementById("userAvatar").textContent = (name[0] || "U").toUpperCase();

  const noteInput = document.getElementById("smartNoteInput");
  noteInput.addEventListener("input", noteCounter);
  bindAutosize(noteInput);
  bindAutosize(document.getElementById("journalInput"));

  document.getElementById("aiProvider").onchange = changeProvider;
  document.getElementById("saveSettingsBtn").onclick = saveSettings;

  document.getElementById("toggleApiKey").onclick = () => {
    const input = document.getElementById("togetherApiKey");
    input.type = input.type === "password" ? "text" : "password";
  };

  document.getElementById("toggleAISettings").onclick = () => {
    const panel = document.getElementById("aiSettingsPanel");
    panel.hidden = !panel.hidden;
  };

  document.querySelectorAll("[data-insight-period]").forEach((button) => {
    button.onclick = () => {
      insightPeriod = button.dataset.insightPeriod;
      document.querySelectorAll("[data-insight-period]").forEach((item) => item.classList.toggle("active", item === button));
    };
  });

  /* Кнопка очистки чата (добавляется динамически, HTML менять не нужно) */
  document.querySelector(".chat-input-area").insertAdjacentHTML(
    "afterbegin",
    `<button id="clearChatBtn" class="chat-clear-btn" type="button" aria-label="Очистить чат">${ICONS.trash}</button>`
  );
  document.getElementById("clearChatBtn").onclick = clearChat;

  /* Закрытие медиа по тапу по фону */
  document.getElementById("mediaModal").addEventListener("click", (event) => {
    if (event.target.id === "mediaModal") closeModal();
  });

  loadSettings();
  noteCounter();
  updateStreak();
  setMood("calm");
  renderChatHistory();
  await loadFiles();
  renderActivity();

  setTimeout(() => document.getElementById("app-loader").classList.add("hidden"), 300);
}

document.addEventListener("DOMContentLoaded", init);
