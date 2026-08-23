
"use strict";

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
      ["meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo", "Llama 3.1 8B"],
      ["Qwen/Qwen2.5-72B-Instruct-Turbo", "Qwen 2.5 72B"]
    ]
  },
  openai: {
    title: "OpenAI",
    models: [
      ["gpt-4o-mini", "GPT-4o mini"],
      ["gpt-4.1-mini", "GPT-4.1 mini"]
    ]
  },
  anthropic: {
    title: "Anthropic",
    models: [
      ["claude-3-5-haiku-latest", "Claude 3.5 Haiku"]
    ]
  },
  google: {
    title: "Google Gemini",
    models: [
      ["gemini-2.0-flash", "Gemini 2.0 Flash"]
    ]
  }
};

const initialDB = {
  notes: [],
  journal: [],
  tags: [],
  telegramTexts: {},
  stats: {
    streak: 0,
    lastLogin: null,
    wordsWritten: 0
  },
  settings: {
    aiProvider: "together",
    aiModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    apiKeys: {},
    togetherApiKey: ""
  }
};

const folders = [
  {
    id: "smart_notes",
    name: "Локальные заметки",
    icon: "brain",
    source: "Созданы в приложении и хранятся локально.",
    types: ["smart_note"]
  },
  {
    id: "telegram_texts",
    name: "Тексты Telegram",
    icon: "file",
    source: "Текстовые файлы и сообщения, полученные через Telegram.",
    types: ["text"]
  },
  {
    id: "documents",
    name: "Документы и аудио",
    icon: "doc",
    source: "Файлы из Telegram. Доступность зависит от соединения и Telegram.",
    types: ["document", "audio", "voice"]
  },
  {
    id: "media",
    name: "Медиа",
    icon: "image",
    source: "Фото, видео и анимации, полученные через Telegram.",
    types: ["photo", "video", "animation", "video_note"]
  }
];

let db = loadDB();
let files = [];
let activeFolder = null;
let searchQuery = "";
let mood = "calm";
let insightPeriod = "day";
let brainGraph = null;
let currentDetailsItem = null;
let currentCalendarDate = new Date();
let currentCalendarEntry = null;
let noteSaving = false;
let filesState = "loading";
let modalStack = [];
let manualNoteTags = [];

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

function uniqueStrings(values = []) {
  const result = [];
  const used = new Set();

  values.forEach((value) => {
    const tag = clean(value).replace(/^#/, "").slice(0, 40);
    const key = tag.toLowerCase();

    if (tag && !used.has(key)) {
      used.add(key);
      result.push(tag);
    }
  });

  return result;
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

function formatDate(value) {
  const date = new Date(value || Date.now());

  if (Number.isNaN(date.getTime())) return "Дата неизвестна";

  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function loadDB() {
  try {
    const saved = JSON.parse(localStorage.getItem("infinityLocalDB"));

    const result = {
      ...clone(initialDB),
      ...(saved || {}),
      stats: {
        ...initialDB.stats,
        ...(saved?.stats || {})
      },
      settings: {
        ...initialDB.settings,
        ...(saved?.settings || {})
      }
    };

    result.notes = Array.isArray(result.notes) ? result.notes : [];
    result.journal = Array.isArray(result.journal) ? result.journal : [];
    result.tags = Array.isArray(result.tags) ? uniqueStrings(result.tags) : [];
    result.telegramTexts ||= {};
    result.settings.apiKeys ||= {};

    result.notes = result.notes.map((note) => ({
      ...note,
      title: clean(note.title) || "Заметка",
      text: String(note.text || ""),
      tags: uniqueStrings(note.tags || [])
    }));

    if (result.settings.togetherApiKey && !result.settings.apiKeys.together) {
      result.settings.apiKeys.together = result.settings.togetherApiKey;
    }

    return result;
  } catch (_) {
    return clone(initialDB);
  }
}

function saveDB() {
  localStorage.setItem("infinityLocalDB", JSON.stringify(db));
  updateStats();
  updateStorage();
}

function haptic() {
  try {
    tg?.HapticFeedback?.selectionChanged?.();
  } catch (_) {}
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
      local: true,
      size: new Blob([note.text || ""]).size
    }))
  ];
}

function fileSize(file = {}) {
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

function getFolder(item) {
  return folders.find((folder) => folder.types.includes(item.type)) || folders[2];
}

function itemSource(item) {
  return item.type === "smart_note" || item.local
    ? "Локальная заметка"
    : "Файл из Telegram";
}

function typeLabel(item) {
  const labels = {
    smart_note: "Заметка",
    text: "Текст",
    document: "Документ",
    photo: "Фото",
    video: "Видео",
    animation: "Анимация",
    video_note: "Видео",
    audio: "Аудио",
    voice: "Аудио"
  };

  return labels[item.type] || "Файл";
}

/* Память складывает заметки и полученные из Telegram файлы. */
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

  document.getElementById("homeEmptyState").hidden = allItems().length > 0;
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

  return (
    db.settings.apiKeys?.[item] ||
    (item === "together" ? db.settings.togetherApiKey : "") ||
    ""
  ).trim();
}

function renderModels(name, selected = "") {
  const select = document.getElementById("aiModel");
  const models = AI[name].models;

  select.innerHTML = models
    .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`)
    .join("");

  const result = models.some(([value]) => value === selected)
    ? selected
    : models[0][0];

  select.value = result;
  return result;
}

function loadSettings() {
  const current = provider();

  document.getElementById("aiProvider").value = current;
  db.settings.aiModel = renderModels(current, db.settings.aiModel);
  document.getElementById("togetherApiKey").value =
    db.settings.apiKeys?.[current] || "";
}

function changeProvider() {
  const old = provider();
  const next = document.getElementById("aiProvider").value;

  db.settings.apiKeys[old] = document
    .getElementById("togetherApiKey")
    .value
    .trim();

  db.settings.aiProvider = next;
  db.settings.aiModel = renderModels(next);
  document.getElementById("togetherApiKey").value =
    db.settings.apiKeys[next] || "";
}

function saveSettings() {
  const current = document.getElementById("aiProvider").value;

  db.settings.aiProvider = current;
  db.settings.aiModel = document.getElementById("aiModel").value;
  db.settings.apiKeys[current] = document
    .getElementById("togetherApiKey")
    .value
    .trim();

  db.settings.togetherApiKey = db.settings.apiKeys.together || "";

  saveDB();
  toast("Настройки ИИ сохранены");
}

async function ai(system, prompt, limit = 550) {
  if (!key()) {
    toast("Добавьте API-ключ в настройках ИИ");
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
          headers: {
            Authorization: `Bearer ${key()}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: model(),
            temperature: 0.35,
            max_tokens: limit,
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompt }
            ]
          })
        }
      );

      if (!response.ok) throw new Error();
      text = (await response.json()).choices?.[0]?.message?.content || "";
    }

    if (provider() === "anthropic") {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key(),
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
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
      text =
        (await response.json()).candidates?.[0]?.content?.parts?.[0]?.text ||
        "";
    }

    return text.trim() || null;
  } catch (_) {
    toast("Не удалось получить ответ ИИ");
    return null;
  }
}

/* Доступные модальные окна: Esc, ловушка фокуса и возврат на элемент-источник. */

function focusableElements(modal) {
  return [...modal.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => !element.hidden && element.offsetParent !== null);
}

function openAccessibleModal(id, trigger = document.activeElement) {
  const modal = document.getElementById(id);

  if (!modal) return;

  if (!modal.classList.contains("active")) {
    modal._restoreFocus = trigger instanceof HTMLElement ? trigger : null;
    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
    modalStack.push(id);
  }

  const focusable = focusableElements(modal);
  const target = focusable[0] || modal;

  setTimeout(() => target.focus(), 0);
}

function closeAccessibleModal(id) {
  const modal = document.getElementById(id);

  if (!modal || !modal.classList.contains("active")) return;

  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");

  modalStack = modalStack.filter((modalId) => modalId !== id);

  if (id === "mediaModal") {
    document.getElementById("modalContent").innerHTML = "";
  }

  if (id === "brainMapModal") {
    brainGraph?._destructor?.();
    brainGraph = null;
  }

  const restore = modal._restoreFocus;

  setTimeout(() => {
    if (restore?.isConnected) restore.focus();
  }, 0);
}

function closeTopModal() {
  const id = modalStack.at(-1);
  if (id) closeAccessibleModal(id);
}

function setupModalAccessibility() {
  document.addEventListener("keydown", (event) => {
    const activeId = modalStack.at(-1);

    if (!activeId) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeTopModal();
      return;
    }

    if (event.key !== "Tab") return;

    const modal = document.getElementById(activeId);
    const elements = focusableElements(modal);

    if (!elements.length) {
      event.preventDefault();
      modal.focus();
      return;
    }

    const first = elements[0];
    const last = elements.at(-1);

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("mousedown", (event) => {
      if (event.target === modal && !modal.classList.contains("brain-modal")) {
        closeAccessibleModal(modal.id);
      }
    });
  });
}

/* Telegram-текстовый файл: загрузка содержимого в кэш браузера. */

function isTextFile(file) {
  const name = `${file.name || ""} ${file.file_name || ""} ${file.title || ""}`.toLowerCase();
  const mime = String(
    file.mime_type || file.mime || file.content_type || ""
  ).toLowerCase();

  return (
    file.type === "text" ||
    mime.startsWith("text/") ||
    /\.(txt|md|csv|json|log|html|css|js|xml)$/i.test(name)
  );
}

function isAudioFile(file) {
  const mime = String(
    file.mime_type || file.mime || file.content_type || ""
  ).toLowerCase();

  return ["audio", "voice"].includes(file.type) || mime.startsWith("audio/");
}

function isVideoFile(file) {
  const mime = String(
    file.mime_type || file.mime || file.content_type || ""
  ).toLowerCase();

  return (
    ["video", "animation", "video_note"].includes(file.type) ||
    mime.startsWith("video/")
  );
}

function isPhotoFile(file) {
  const mime = String(
    file.mime_type || file.mime || file.content_type || ""
  ).toLowerCase();

  return file.type === "photo" || mime.startsWith("image/");
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

function setFilesState(state) {
  filesState = state;

  const loading = document.getElementById("filesLoadingState");
  const error = document.getElementById("filesErrorState");
  const empty = document.getElementById("filesEmptyState");
  const grid = document.getElementById("folderGrid");

  loading.hidden = state !== "loading";
  error.hidden = state !== "error";
  empty.hidden = state !== "empty";
  grid.hidden = state !== "ready";
}

async function loadFiles() {
  setFilesState("loading");

  try {
    const response = await fetch(
      `${API_URL}?user_id=${encodeURIComponent(user?.id || "browser-user")}&limit=100`
    );

    if (!response.ok) throw new Error();

    const data = await response.json();

    files = await Promise.all((data.files || []).map(async (file, index) => {
      const item = {
        ...file,
        internalId: `server_${file.id || index}`,
        id: file.id || `server_${index}`,
        type: file.type || file.file_type || "document",
        title: file.title || file.name || file.file_name || "Файл",
        text: file.text || file.caption || "",
        tags: uniqueStrings(file.tags || []),
        date: file.date || file.created_at || file.createdAt || null,
        url: file.url || file.file_url || "",
        size: fileSize(file)
      };

      if (isTextFile(item)) {
        item.type = "text";
        item.text = await readTelegramText(item);
      }

      return item;
    }));

    setFilesState(files.length || db.notes.length ? "ready" : "empty");
  } catch (_) {
    files = [];
    setFilesState("error");
  }

  updateStorage();
  updateStats();
  renderFiles();
}

function retryLoadFiles() {
  loadFiles();
}

function retryLoadFolder() {
  renderFolderContents();
}

/* Локальные заметки и ручные теги. */

function noteCounter() {
  const input = document.getElementById("smartNoteInput");

  document.getElementById("noteCharCounter").textContent =
    `${input.value.length} / ${input.maxLength}`;
}

function renderManualTags() {
  const list = document.getElementById("manualTagsList");

  list.innerHTML = manualNoteTags
    .map((tag, index) => `
      <span class="tag-chip">
        #${esc(tag)}
        <button
          type="button"
          onclick="removeManualTag(${index})"
          aria-label="Удалить тег ${esc(tag)}"
          title="Удалить тег"
        >×</button>
      </span>
    `)
    .join("");
}

function addManualTag() {
  const input = document.getElementById("manualTagInput");
  const tag = clean(input.value).replace(/^#/, "");

  if (!tag) return;

  manualNoteTags = uniqueStrings([...manualNoteTags, tag]);
  db.tags = uniqueStrings([...db.tags, tag]);

  input.value = "";
  renderManualTags();
}

function handleManualTagKey(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    addManualTag();
  }
}

function removeManualTag(index) {
  manualNoteTags.splice(index, 1);
  renderManualTags();
}

function openTagManager(trigger) {
  renderTagManager();
  openAccessibleModal("tagManagerModal", trigger);
}

function closeTagManager() {
  closeAccessibleModal("tagManagerModal");
}

function renderTagManager() {
  const list = document.getElementById("tagManagerList");

  if (!db.tags.length) {
    list.innerHTML = `
      <div class="empty-state">
        <p>Создайте первый тег, чтобы добавлять его к заметкам вручную.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = db.tags
    .map((tag, index) => `
      <div class="tag-manager-row">
        <input
          id="managedTag-${index}"
          value="${esc(tag)}"
          maxlength="40"
          aria-label="Название тега"
        >
        <button type="button" onclick="renameTag(${index})">Сохранить</button>
        <button
          class="delete-tag-btn"
          type="button"
          onclick="deleteTag(${index})"
          aria-label="Удалить тег ${esc(tag)}"
        >Удалить</button>
      </div>
    `)
    .join("");
}

function createTag() {
  const input = document.getElementById("newTagName");
  const tag = clean(input.value).replace(/^#/, "");

  if (!tag) {
    toast("Введите название тега");
    return;
  }

  if (db.tags.some((item) => item.toLowerCase() === tag.toLowerCase())) {
    toast("Такой тег уже есть");
    return;
  }

  db.tags.push(tag);
  db.tags = uniqueStrings(db.tags);
  input.value = "";
  saveDB();
  renderTagManager();
  toast("Тег создан");
}

function renameTag(index) {
  const oldTag = db.tags[index];
  const input = document.getElementById(`managedTag-${index}`);
  const newTag = clean(input?.value).replace(/^#/, "");

  if (!newTag) {
    toast("Название тега не может быть пустым");
    return;
  }

  const duplicate = db.tags.some(
    (tag, tagIndex) =>
      tagIndex !== index && tag.toLowerCase() === newTag.toLowerCase()
  );

  if (duplicate) {
    toast("Такой тег уже есть");
    return;
  }

  db.tags[index] = newTag;

  db.notes.forEach((note) => {
    note.tags = uniqueStrings(
      (note.tags || []).map((tag) =>
        tag.toLowerCase() === oldTag.toLowerCase() ? newTag : tag
      )
    );
  });

  manualNoteTags = manualNoteTags.map((tag) =>
    tag.toLowerCase() === oldTag.toLowerCase() ? newTag : tag
  );

  saveDB();
  renderTagManager();
  renderManualTags();
  renderFiles();
  toast("Тег переименован");
}

function deleteTag(index) {
  const tag = db.tags[index];

  db.tags.splice(index, 1);

  db.notes.forEach((note) => {
    note.tags = (note.tags || []).filter(
      (noteTag) => noteTag.toLowerCase() !== tag.toLowerCase()
    );
  });

  manualNoteTags = manualNoteTags.filter(
    (noteTag) => noteTag.toLowerCase() !== tag.toLowerCase()
  );

  saveDB();
  renderTagManager();
  renderManualTags();
  renderFiles();
  toast("Тег удалён");
}

async function saveSmartNote() {
  if (noteSaving) return;

  const input = document.getElementById("smartNoteInput");
  const saveButton = document.getElementById("saveSmartNoteBtn");
  const status = document.getElementById("smartNoteAiStatus");
  const text = input.value.trim();

  if (!text) {
    toast("Напишите мысль");
    return;
  }

  noteSaving = true;
  input.disabled = true;
  saveButton.disabled = true;

  let title = text.slice(0, 60);
  let aiTags = [];

  if (key()) {
    status.hidden = false;

    const result = await ai(
      "Верни только JSON без Markdown: {\"title\":\"короткий заголовок\",\"tags\":[\"тег\"]}. До 5 коротких тегов на русском.",
      text,
      180
    );

    try {
      const json = result?.match(/\{[\s\S]*\}/)?.[0] || "{}";
      const parsed = JSON.parse(json);

      title = clean(parsed.title || title).slice(0, 90) || title;
      aiTags = Array.isArray(parsed.tags) ? parsed.tags : [];
    } catch (_) {
      /* Если ИИ вернул не JSON, заметка всё равно сохранится с ручными тегами. */
    }
  }

  try {
    const tags = uniqueStrings([...manualNoteTags, ...aiTags]).slice(0, 8);

    db.notes.unshift({
      id: Date.now(),
      title,
      text,
      tags,
      date: new Date().toISOString()
    });

    db.tags = uniqueStrings([...db.tags, ...tags]);
    db.stats.wordsWritten += words(text).length;

    saveDB();

    /* Очищаем текст только после успешного сохранения. */
    input.value = "";
    manualNoteTags = [];
    noteCounter();
    renderManualTags();
    renderFiles();

    toast("Заметка сохранена");
  } catch (_) {
    toast("Не удалось сохранить заметку. Текст оставлен в поле.");
  } finally {
    noteSaving = false;
    input.disabled = false;
    saveButton.disabled = false;
    status.hidden = true;
  }
}

/* Дневник. */

function setMood(value) {
  mood = value;

  document.querySelectorAll(".journal-mood-selector button").forEach((button) => {
    button.classList.toggle(
      "selected",
      button.getAttribute("onclick")?.includes(`'${value}'`)
    );
  });
}

function saveJournal() {
  const input = document.getElementById("journalInput");
  const text = input.value.trim();

  if (!text) {
    toast("Введите запись");
    return;
  }

  db.journal.unshift({
    id: Date.now(),
    text,
    mood,
    date: new Date().toISOString()
  });

  db.stats.wordsWritten += words(text).length;
  input.value = "";

  saveDB();
  renderActivity();
  toast("Запись сохранена");
}

/* Папки, состояния загрузки и глобальный поиск. */

function renderFiles() {
  const gridView = document.getElementById("folderGridView");
  const contentsView = document.getElementById("folderContentsView");
  const results = document.getElementById("globalSearchResults");

  if (searchQuery) {
    gridView.hidden = false;
    contentsView.hidden = true;
    results.hidden = false;
    renderGlobalSearch();
    return;
  }

  results.hidden = true;

  if (!activeFolder) {
    gridView.hidden = false;
    contentsView.hidden = true;

    if (filesState === "error") {
      setFilesState("error");
      return;
    }

    const hasItems = allItems().length > 0;
    setFilesState(hasItems ? "ready" : "empty");

    document.getElementById("folderGrid").innerHTML = folders
      .map((folder) => {
        const count = allItems().filter((item) =>
          folder.types.includes(item.type)
        ).length;

        return `
          <button class="folder-card" type="button" onclick="openFolder('${folder.id}')">
            <span class="folder-card-icon folder-icon-${folder.icon}"></span>
            <span class="folder-card-name">${esc(folder.name)}</span>
            <span class="folder-card-count">${count} ${declension(count, ["материал", "материала", "материалов"])}</span>
          </button>
        `;
      })
      .join("");

    return;
  }

  gridView.hidden = true;
  contentsView.hidden = false;
  renderFolderContents();
}

function renderFolderContents() {
  const folder = folders.find((item) => item.id === activeFolder);

  if (!folder) {
    closeFolder();
    return;
  }

  const gallery = document.getElementById("folderGallery");
  const loading = document.getElementById("folderLoadingState");
  const error = document.getElementById("folderErrorState");
  const empty = document.getElementById("folderEmptyState");

  document.getElementById("currentFolderTitle").textContent = folder.name;
  document.getElementById("currentFolderSource").textContent = folder.source;

  loading.hidden = true;
  error.hidden = true;
  empty.hidden = true;
  gallery.innerHTML = "";

  if (filesState === "error" && folder.id !== "smart_notes") {
    error.hidden = false;
    return;
  }

  const items = allItems().filter((item) => folder.types.includes(item.type));

  if (!items.length) {
    empty.hidden = false;
    return;
  }

  items.forEach((item) => gallery.appendChild(createItemCard(item)));
}

function createItemCard(item) {
  const card = document.createElement("button");
  const url = safeUrl(item.url);

  card.type = "button";
  card.className = `grid-item ${item.type}`;
  card.setAttribute(
    "aria-label",
    `Открыть: ${item.title || typeLabel(item)} (${typeLabel(item)})`
  );

  const badge = `<span class="file-type-badge">${esc(typeLabel(item))}</span>`;

  if (isPhotoFile(item) && url) {
    card.innerHTML = `<img src="${url}" alt="${esc(item.title)}">${badge}`;
  } else if (isVideoFile(item) && url) {
    card.innerHTML = `
      <video muted preload="metadata" aria-hidden="true">
        <source src="${url}">
      </video>
      ${badge}
    `;
  } else {
    const text = clean(item.text).slice(0, 170);

    card.innerHTML = `
      <div class="text-card-body">
        <strong>${esc(item.title || "Файл")}</strong>
        <br><br>
        ${esc(text || mediaDescription(item))}
      </div>
      ${badge}
    `;
  }

  card.onclick = () => {
    if (isPhotoFile(item) || isVideoFile(item) || isAudioFile(item) || item.type === "document") {
      openMedia(item, card);
    } else {
      openDetails(item, card);
    }
  };

  return card;
}

function mediaDescription(item) {
  if (isAudioFile(item)) return "Нажмите, чтобы прослушать аудио.";
  if (isVideoFile(item)) return "Нажмите, чтобы открыть видео.";
  if (item.type === "document") return "Нажмите, чтобы открыть документ.";
  return "Содержимое не было передано сервером.";
}

function openFolder(id) {
  activeFolder = id;
  searchQuery = "";

  document.getElementById("searchInput").value = "";
  document.getElementById("clearSearchBtn").hidden = true;

  renderFiles();
}

function closeFolder() {
  activeFolder = null;
  renderFiles();
}

function matchesSearch(item, query) {
  const folder = getFolder(item);

  const searchable = [
    item.title,
    item.text,
    ...(item.tags || []),
    item.type,
    typeLabel(item),
    folder.name,
    itemSource(item)
  ].join(" ").toLowerCase();

  return searchable.includes(query);
}

function handleSearch() {
  searchQuery = document.getElementById("searchInput").value.trim().toLowerCase();
  document.getElementById("clearSearchBtn").hidden = !searchQuery;

  renderFiles();
}

function clearSearch() {
  searchQuery = "";
  document.getElementById("searchInput").value = "";
  document.getElementById("clearSearchBtn").hidden = true;

  renderFiles();
}

function renderGlobalSearch() {
  const matches = allItems().filter((item) => matchesSearch(item, searchQuery));
  const list = document.getElementById("searchResultsList");

  document.getElementById("searchResultsCount").textContent =
    `${matches.length} ${declension(matches.length, ["результат", "результата", "результатов"])}`;

  if (!matches.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon" aria-hidden="true">⌕</div>
        <h2>Ничего не найдено</h2>
        <p>Попробуйте другое слово, название папки или тег.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = "";

  matches.forEach((item) => {
    const folder = getFolder(item);
    const button = document.createElement("button");

    button.className = "search-result-item";
    button.type = "button";
    button.innerHTML = `
      <strong>${esc(item.title || "Без названия")}</strong>
      <span class="search-result-meta">
        ${esc(typeLabel(item))} · ${esc(folder.name)} · ${esc(itemSource(item))}
      </span>
    `;

    button.onclick = () => {
      if (isPhotoFile(item) || isVideoFile(item) || isAudioFile(item) || item.type === "document") {
        openMedia(item, button);
      } else {
        openDetails(item, button);
      }
    };

    list.appendChild(button);
  });
}

/* Чат: в ИИ уходят только заметки с ненулевой релевантностью. */

function relevant(question) {
  const query = uniqueStrings(words(question));

  if (!query.length) return [];

  return db.notes
    .map((note) => {
      const titleWords = new Set(words(note.title));
      const textWords = new Set(words(note.text));
      const tagWords = new Set((note.tags || []).flatMap((tag) => words(tag)));

      const score = query.reduce((total, word) => {
        if (tagWords.has(word)) return total + 4;
        if (titleWords.has(word)) return total + 3;
        if (textWords.has(word)) return total + 1;
        return total;
      }, 0);

      return { ...note, score };
    })
    .filter((note) => note.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function chatMessage(text, role, sources = []) {
  const box = document.getElementById("chatContainer");
  const item = document.createElement("div");

  item.className = `chat-msg ${role}`;
  item.textContent = text;

  if (sources.length) {
    const sourceBox = document.createElement("div");
    sourceBox.className = "chat-sources";

    sources.forEach((source) => {
      const button = document.createElement("button");

      button.className = "chat-source";
      button.type = "button";
      button.textContent = source.title;
      button.onclick = () => openDetails(source, button);

      sourceBox.appendChild(button);
    });

    item.appendChild(sourceBox);
  }

  box.appendChild(item);
  box.scrollTop = box.scrollHeight;

  return item;
}

async function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const button = document.getElementById("sendChatBtn");
  const question = input.value.trim();

  if (!question || button.disabled) return;

  input.value = "";
  button.disabled = true;

  chatMessage(question, "user");

  const notes = relevant(question);

  if (!notes.length) {
    chatMessage(
      "Не нашёл заметок, которые подходят к этому вопросу. Поэтому ничего не отправлял в ИИ.",
      "ai"
    );
    button.disabled = false;
    return;
  }

  const context = notes
    .map((note, index) => {
      const tags = note.tags?.length ? `Теги: ${note.tags.join(", ")}\n` : "";
      return `[${index + 1}] ${note.title}\n${tags}${note.text.slice(0, 1200)}`;
    })
    .join("\n\n---\n\n");

  const loading = chatMessage("Думаю…", "ai");

  const answer = await ai(
    "Отвечай только на основе переданного контекста, кратко и по-русски. Если в контексте нет ответа, честно скажи об этом. Не добавляй неподтверждённые факты.",
    `${context}\n\nВОПРОС:\n${question}`,
    420
  );

  loading.remove();
  chatMessage(answer || "Не удалось ответить.", "ai", notes);

  button.disabled = false;
}

function handleChatKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
  }
}

/* Карта знаний. */

function links(notes) {
  const result = [];
  const degree = {};

  notes.forEach((a, index) => {
    notes.slice(index + 1).forEach((b) => {
      const tags = new Set((a.tags || []).map((tag) => tag.toLowerCase()));
      const common = (b.tags || []).filter((tag) =>
        tags.has(tag.toLowerCase())
      );

      if (common.length) {
        result.push({
          source: `note_${a.id}`,
          target: `note_${b.id}`,
          strength: common.length
        });
      }
    });
  });

  return result
    .sort((a, b) => b.strength - a.strength)
    .filter((link) => {
      if ((degree[link.source] || 0) >= 3 || (degree[link.target] || 0) >= 3) {
        return false;
      }

      degree[link.source] = (degree[link.source] || 0) + 1;
      degree[link.target] = (degree[link.target] || 0) + 1;

      return true;
    });
}

function openBrainMap(trigger) {
  const mount = document.getElementById("3d-graph");

  openAccessibleModal("brainMapModal", trigger);
  mount.innerHTML = "";

  if (!db.notes.length || typeof window.ForceGraph3D !== "function") {
    mount.innerHTML = `
      <p class="brain-empty-message">
        Добавьте несколько заметок с тегами, чтобы появилась карта знаний.
      </p>
    `;
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
    .linkColor((link) =>
      link.strength > 1
        ? "rgba(160,120,255,.75)"
        : "rgba(91,140,255,.45)"
    )
    .linkWidth((link) => .8 + link.strength * .7)
    .linkDirectionalParticles(1)
    .linkDirectionalParticleWidth(1.5)
    .onNodeClick((node) => openDetails(node.note, document.activeElement))
    .onNodeHover((node) => {
      mount.style.cursor = node ? "pointer" : "grab";
    });

  brainGraph.controls().enableDamping = true;
  brainGraph.controls().dampingFactor = .1;
  brainGraph.d3Force("charge")?.strength(-125);
  brainGraph.d3Force("link")?.distance(100);

  document.getElementById("brainSearchInput").oninput = (event) => {
    const query = event.target.value.trim().toLowerCase();
    const found = nodes.find((node) =>
      node.name.toLowerCase().includes(query)
    );

    if (found) {
      brainGraph.cameraPosition(
        {
          x: found.x + 50,
          y: found.y + 50,
          z: found.z + 110
        },
        found,
        600
      );
    }
  };

  setTimeout(() => brainGraph?.zoomToFit(650, 70), 200);
}

function toggleBrainHelp() {
  const help = document.getElementById("brainHelp");
  help.hidden = !help.hidden;
}

function closeBrainMap() {
  closeAccessibleModal("brainMapModal");
}

/* Детали заметки и полноценный просмотр медиа. */

function openDetails(item, trigger = document.activeElement) {
  currentDetailsItem = item;

  document.getElementById("noteDetailsTitle").textContent =
    item.title || "Материал";

  document.getElementById("noteDetailsDate").textContent =
    `${formatDate(item.date)} · ${itemSource(item)}`;

  document.getElementById("noteDetailsText").textContent =
    item.text || mediaDescription(item);

  const tags = document.getElementById("noteDetailsTags");
  const itemTags = uniqueStrings(item.tags || []);

  tags.innerHTML = itemTags.length
    ? itemTags.map((tag) => `<span class="tag-chip">#${esc(tag)}</span>`).join("")
    : '<span class="tag-chip">Без тегов</span>';

  const openFolderButton = document.getElementById("openNoteFolderBtn");
  openFolderButton.hidden = !getFolder(item);

  openAccessibleModal("noteDetailsModal", trigger);
}

function closeNoteDetails() {
  closeAccessibleModal("noteDetailsModal");
  currentDetailsItem = null;
}

async function copyCurrentNote() {
  const item = currentDetailsItem;

  if (!item) return;

  const text = [
    item.title || "Материал",
    formatDate(item.date),
    item.tags?.length ? `#${item.tags.join(" #")}` : "",
    item.text || ""
  ].filter(Boolean).join("\n\n");

  try {
    await navigator.clipboard.writeText(text);
    toast("Скопировано");
  } catch (_) {
    toast("Не удалось скопировать текст");
  }
}

function openCurrentNoteFolder() {
  if (!currentDetailsItem) return;

  const folder = getFolder(currentDetailsItem);

  closeNoteDetails();

  switchTab("files", document.getElementById("nav-files"));
  openFolder(folder.id);
}

function openMedia(file, trigger = document.activeElement) {
  const url = safeUrl(file.url);

  if (!url) {
    openDetails(file, trigger);
    return;
  }

  const content = document.getElementById("modalContent");
  const title = file.title || typeLabel(file);

  document.getElementById("mediaModalTitle").textContent = title;

  if (isPhotoFile(file)) {
    content.innerHTML = `<img src="${url}" alt="${esc(title)}">`;
  } else if (isVideoFile(file)) {
    content.innerHTML = `
      <video controls playsinline preload="metadata" aria-label="${esc(title)}">
        <source src="${url}">
        Ваш браузер не поддерживает просмотр видео.
      </video>
    `;
  } else if (isAudioFile(file)) {
    content.innerHTML = `
      <audio controls preload="metadata" aria-label="${esc(title)}">
        <source src="${url}">
        Ваш браузер не поддерживает воспроизведение аудио.
      </audio>
    `;
  } else {
    content.innerHTML = `
      <iframe
        class="document-preview"
        src="${url}"
        title="${esc(title)}"
        sandbox="allow-scripts allow-same-origin allow-popups"
      ></iframe>
    `;
  }

  openAccessibleModal("mediaModal", trigger);
}

function closeModal() {
  closeAccessibleModal("mediaModal");
}

/* Календарь: смена месяцев и открытие записи по дню. */

function openJournalCalendar(trigger) {
  currentCalendarDate = new Date();
  currentCalendarDate.setDate(1);
  currentCalendarEntry = null;

  renderJournalCalendar();
  openAccessibleModal("journalCalendarModal", trigger);
}

function closeJournalCalendar() {
  closeAccessibleModal("journalCalendarModal");
}

function changeCalendarMonth(delta) {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() + delta);
  currentCalendarEntry = null;
  renderJournalCalendar();
}

function renderJournalCalendar() {
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysCount = new Date(year, month + 1, 0).getDate();

  document.getElementById("calendarMonthLabel").textContent =
    new Date(year, month, 1).toLocaleDateString("ru-RU", {
      month: "long",
      year: "numeric"
    });

  const entriesByDate = new Map();

  db.journal.forEach((entry) => {
    const key = dateKey(entry.date);

    if (!entriesByDate.has(key)) entriesByDate.set(key, entry);
  });

  const days = document.getElementById("calendarDays");
  days.innerHTML = "";

  for (let index = 0; index < firstWeekday; index += 1) {
    const blank = document.createElement("span");
    blank.className = "calendar-day empty";
    days.appendChild(blank);
  }

  for (let day = 1; day <= daysCount; day += 1) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const entry = entriesByDate.get(key);
    const button = document.createElement("button");

    button.type = "button";
    button.className = `calendar-day${entry ? " has-entry" : ""}${
      currentCalendarEntry?.id === entry?.id ? " selected" : ""
    }`;
    button.textContent = day;
    button.setAttribute(
      "aria-label",
      entry
        ? `${day}. Есть запись дневника`
        : `${day}. Нет записи дневника`
    );

    if (entry) {
      button.onclick = () => selectCalendarEntry(entry);
    } else {
      button.disabled = true;
    }

    days.appendChild(button);
  }

  const preview = document.getElementById("calendarEntryPreview");

  if (!currentCalendarEntry) {
    preview.hidden = true;
    return;
  }

  preview.hidden = false;
  document.getElementById("calendarEntryDate").textContent =
    formatDate(currentCalendarEntry.date);

  document.getElementById("calendarEntryText").textContent =
    currentCalendarEntry.text;

  document.getElementById("calendarOpenEntryBtn").onclick = () => {
    const entry = {
      ...currentCalendarEntry,
      title: "Запись дневника",
      tags: [currentCalendarEntry.mood || "дневник"]
    };

    openDetails(entry, document.getElementById("calendarOpenEntryBtn"));
  };
}

function selectCalendarEntry(entry) {
  currentCalendarEntry = entry;
  renderJournalCalendar();
}

/* Портрет: «Сегодня» начинается в 00:00, а не в текущее время. */

function renderActivity() {
  const today = new Date();

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));

    const key = dateKey(date);

    return {
      label: date
        .toLocaleDateString("ru-RU", { weekday: "short" })
        .slice(0, 2),
      count:
        db.notes.filter((item) => dateKey(item.date) === key).length +
        db.journal.filter((item) => dateKey(item.date) === key).length
    };
  });

  const max = Math.max(1, ...days.map((day) => day.count));

  document.getElementById("activityTotal").textContent = days.reduce(
    (sum, day) => sum + day.count,
    0
  );

  document.getElementById("activityChart").innerHTML = days
    .map((day) => `
      <div class="activity-bar-wrap">
        <div
          class="activity-bar"
          style="height:${Math.max(8, day.count / max * 100)}%"
          title="${day.count}"
        ></div>
        <span class="activity-label">${day.label}</span>
      </div>
    `)
    .join("");
}

async function generateDailyInsight() {
  const end = new Date();
  let start;

  if (insightPeriod === "day") {
    start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  } else {
    start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    start.setDate(start.getDate() - 6);
  }

  const records = [
    ...db.notes.map((item) => ({
      ...item,
      title: item.title || "Заметка"
    })),
    ...db.journal.map((item) => ({
      ...item,
      title: "Дневник"
    }))
  ]
    .filter((item) => new Date(item.date) >= start && new Date(item.date) <= end)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8)
    .map((item) => `${item.title}: ${String(item.text).slice(0, 550)}`)
    .join("\n---\n");

  const area = document.getElementById("dailyInsightContent");

  if (!records) {
    area.textContent =
      insightPeriod === "day"
        ? "Сегодня записей пока нет."
        : "За эту неделю записей пока нет.";
    return;
  }

  area.textContent = "Создаю портрет…";

  const result = await ai(
    "Сделай бережный краткий портрет человека только по переданным записям. Опиши возможные чувства и темы, предложи одну мягкую поддержку. Не ставь диагнозов. До 5 предложений.",
    records,
    260
  );

  area.textContent = result || "Не удалось создать портрет.";
}

/* Экспорт, импорт и навигация. */

function exportData() {
  const blob = new Blob(
    [JSON.stringify(db, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "infinity-backup.json";
  link.click();

  URL.revokeObjectURL(url);
}

function importData(event) {
  const file = event.target.files?.[0];

  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));

      if (!parsed || typeof parsed !== "object") throw new Error();

      localStorage.setItem("infinityLocalDB", JSON.stringify(parsed));
      location.reload();
    } catch (_) {
      toast("Ошибка импорта: выберите корректный JSON-файл");
    }
  };

  reader.readAsText(file);
}

function switchTab(id, button) {
  document.querySelectorAll(".tab-content").forEach((item) => {
    item.classList.remove("active");
  });

  document.getElementById(`tab-${id}`).classList.add("active");

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("active");
  });

  button?.classList.add("active");

  if (id === "profile") renderActivity();
  if (id === "files") renderFiles();

  haptic();
}

function declension(number, forms) {
  const value = Math.abs(number) % 100;
  const last = value % 10;

  if (value > 10 && value < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];

  return forms[2];
}

function toast(text) {
  const item = document.createElement("div");

  item.className = "toast";
  item.textContent = text;

  document.getElementById("toast-box").appendChild(item);

  setTimeout(() => item.remove(), 3000);
}

async function init() {
  const name = user?.first_name || "Пользователь";

  document.getElementById("userName").textContent = name;
  document.getElementById("userAvatar").textContent = name[0].toUpperCase();

  document.getElementById("smartNoteInput").oninput = noteCounter;
  document.getElementById("aiProvider").onchange = changeProvider;
  document.getElementById("saveSettingsBtn").onclick = saveSettings;

  document.getElementById("toggleApiKey").onclick = () => {
    const input = document.getElementById("togetherApiKey");

    input.type = input.type === "password" ? "text" : "password";
  };

  document.getElementById("toggleAISettings").onclick = () => {
    const panel = document.getElementById("aiSettingsPanel");
    const button = document.getElementById("toggleAISettings");
    const expanded = panel.hidden;

    panel.hidden = !expanded;
    button.setAttribute("aria-expanded", String(expanded));
  };

  document.querySelectorAll("[data-insight-period]").forEach((button) => {
    button.onclick = () => {
      insightPeriod = button.dataset.insightPeriod;

      document.querySelectorAll("[data-insight-period]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
    };
  });

  setupModalAccessibility();
  loadSettings();
  noteCounter();
  renderManualTags();
  updateStreak();
  setMood("calm");
  renderFiles();
  renderActivity();

  await loadFiles();

  setTimeout(() => {
    const loader = document.getElementById("app-loader");
    loader.classList.add("hidden");
    loader.setAttribute("aria-busy", "false");
  }, 300);
}

document.addEventListener("DOMContentLoaded", init);
