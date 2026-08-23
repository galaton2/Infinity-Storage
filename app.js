"use strict";

const tg = window.Telegram?.WebApp || null;

try {
  tg?.ready?.();
  tg?.expand?.();
  tg?.setHeaderColor?.("#070b12");
  tg?.setBackgroundColor?.("#070b12");
} catch (_) {}

const user = tg?.initDataUnsafe?.user || null;
const API_URL = "https://galaxylab.i234.me:8443/api/files";

const AI = {
  together: {
    models: [
      ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Llama 3.3 70B"],
      ["meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo", "Llama 3.1 8B"],
      ["Qwen/Qwen2.5-72B-Instruct-Turbo", "Qwen 2.5 72B"]
    ]
  },
  openai: {
    models: [
      ["gpt-4o-mini", "GPT-4o mini"],
      ["gpt-4.1-mini", "GPT-4.1 mini"]
    ]
  },
  anthropic: {
    models: [["claude-3-5-haiku-latest", "Claude 3.5 Haiku"]]
  },
  google: {
    models: [["gemini-2.0-flash", "Gemini 2.0 Flash"]]
  }
};

const initialDB = {
  notes: [],
  journal: [],
  customFolders: [],
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

const baseFolders = [
  {
    id: "smart_notes",
    name: "Заметки",
    icon: "brain",
    types: ["smart_note"]
  },
  {
    id: "telegram_texts",
    name: "Тексты Telegram",
    icon: "file",
    types: ["text"]
  },
  {
    id: "documents",
    name: "Документы",
    icon: "doc",
    types: ["document", "audio", "voice"]
  },
  {
    id: "media",
    name: "Медиа",
    icon: "image",
    types: ["photo", "video", "animation", "video_note"]
  }
];

const moodData = {
  sad: { emoji: "😔", title: "Грустно" },
  calm: { emoji: "😌", title: "Спокойно" },
  good: { emoji: "🙂", title: "Хорошо" },
  great: { emoji: "🤩", title: "Отлично" }
};

let db = loadDB();
let files = [];
let activeFolder = null;
let searchQuery = "";
let mood = "calm";
let insightPeriod = "day";
let brainGraph = null;
let calendarDate = new Date();

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
    .filter((word) => word.length > 1);
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
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatDate(value, options = {}) {
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...options
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
    result.customFolders = Array.isArray(result.customFolders) ? result.customFolders : [];
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
  localStorage.setItem("infinityLocalDB", JSON.stringify(db));
  updateStats();
  updateStorage();
}

function haptic(type = "selectionChanged") {
  try {
    tg?.HapticFeedback?.[type]?.();
  } catch (_) {}
}

function allFolders() {
  return [
    ...baseFolders,
    ...db.customFolders.map((folder) => ({
      ...folder,
      icon: "custom",
      types: []
    }))
  ];
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
      folderId: note.folderId || "",
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
  if (size < 1024) return `${size} байт`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} КБ`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} МБ`;
  return `${(size / 1024 ** 3).toFixed(2)} ГБ`;
}

function updateStorage() {
  const actualTotal = allItems().reduce((sum, item) => sum + fileSize(item), 0);
  const shownTotal = actualTotal || 14;
  const visual = actualTotal
    ? Math.min(8 + Math.log10(actualTotal + 1) * 11, 96)
    : 4;

  document.getElementById("dataUsedText").textContent = fmtSize(shownTotal);
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
  const current = provider();

  return (
    db.settings.apiKeys?.[current] ||
    (current === "together" ? db.settings.togetherApiKey : "") ||
    ""
  ).trim();
}

function renderModels(name, selected = "") {
  const select = document.getElementById("aiModel");
  const models = AI[name].models;

  select.innerHTML = models
    .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`)
    .join("");

  const selectedModel = models.some(([value]) => value === selected)
    ? selected
    : models[0][0];

  select.value = selectedModel;

  return selectedModel;
}

function loadSettings() {
  const current = provider();

  document.getElementById("aiProvider").value = current;
  db.settings.aiModel = renderModels(current, db.settings.aiModel);
  document.getElementById("togetherApiKey").value = db.settings.apiKeys?.[current] || "";
}

function changeProvider() {
  const oldProvider = provider();
  const nextProvider = document.getElementById("aiProvider").value;

  db.settings.apiKeys[oldProvider] =
    document.getElementById("togetherApiKey").value.trim();

  db.settings.aiProvider = nextProvider;
  db.settings.aiModel = renderModels(nextProvider);
  document.getElementById("togetherApiKey").value =
    db.settings.apiKeys[nextProvider] || "";
}

function saveSettings() {
  const current = document.getElementById("aiProvider").value;

  db.settings.aiProvider = current;
  db.settings.aiModel = document.getElementById("aiModel").value;
  db.settings.apiKeys[current] =
    document.getElementById("togetherApiKey").value.trim();

  db.settings.togetherApiKey = db.settings.apiKeys.together || "";
  saveDB();
  toast("Настройки ИИ сохранены");
}

async function ai(system, prompt, limit = 550) {
  if (!key()) {
    toast("Добавьте API-ключ в профиле → Настройки ИИ");
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

      if (!response.ok) throw new Error("AI request failed");

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

      if (!response.ok) throw new Error("AI request failed");

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

      if (!response.ok) throw new Error("AI request failed");

      text =
        (await response.json()).candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    return text.trim() || null;
  } catch (_) {
    toast("ИИ сейчас недоступен. Проверьте ключ и подключение.");
    return null;
  }
}

/* Загрузка файлов */

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

async function loadFiles() {
  try {
    const response = await fetch(
      `${API_URL}?user_id=${encodeURIComponent(user?.id || "browser-user")}&limit=100`
    );

    if (!response.ok) throw new Error();

    const data = await response.json();

    files = await Promise.all(
      (data.files || []).map(async (file, index) => {
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
      })
    );
  } catch (_) {
    files = [];
  }

  updateStorage();
  updateStats();
  renderFiles();
}

/* Заметки */

function noteCounter() {
  const input = document.getElementById("smartNoteInput");
  document.getElementById("noteCharCounter").textContent =
    `${input.value.length} / ${input.maxLength}`;
}

async function saveSmartNote() {
  const input = document.getElementById("smartNoteInput");
  const text = input.value.trim();

  if (!text) {
    toast("Сначала напишите мысль");
    return;
  }

  input.value = "";
  noteCounter();

  let title = text.slice(0, 60);
  let tags = [];

  if (key()) {
    const result = await ai(
      "Верни только JSON формата: {\"title\":\"короткий заголовок\",\"tags\":[\"тег\"]}. Не больше пяти тегов.",
      text,
      180
    );

    try {
      const parsed = JSON.parse(result?.match(/\{[\s\S]*\}/)?.[0] || "{}");
      title = String(parsed.title || title).slice(0, 90);
      tags = Array.isArray(parsed.tags)
        ? parsed.tags.slice(0, 5).map(String)
        : [];
    } catch (_) {}
  }

  db.notes.unshift({
    id: Date.now(),
    title,
    text,
    tags,
    date: new Date().toISOString()
  });

  db.stats.wordsWritten += words(text).length;

  saveDB();
  renderFiles();
  haptic("impactOccurred");
  toast("Заметка сохранена");
}

/* Папки */

function folderIcon(folder) {
  const icons = {
    brain: "✦",
    file: "≡",
    doc: "▤",
    image: "◈",
    custom: "⌁"
  };

  return icons[folder.icon] || "⌁";
}

function isItemInFolder(item, folder) {
  if (folder.icon === "custom") {
    return item.folderId === folder.id;
  }

  return folder.types.includes(item.type);
}

function countFolderItems(folder) {
  return allItems().filter((item) => isItemInFolder(item, folder)).length;
}

function renderFiles() {
  const gridView = document.getElementById("folderGridView");
  const contentView = document.getElementById("folderContentsView");
  const topbar = document.getElementById("filesTopbar");

  if (!activeFolder) {
    gridView.hidden = false;
    contentView.hidden = true;
    topbar.innerHTML = "";

    document.getElementById("folderGrid").innerHTML = allFolders()
      .map(
        (folder) => `
          <button class="folder-card" type="button" onclick="openFolder('${esc(folder.id)}')">
            <span class="folder-card-icon folder-icon-${esc(folder.icon)}">${folderIcon(folder)}</span>
            <span class="folder-card-name">${esc(folder.name)}</span>
            <span class="folder-card-count">${countFolderItems(folder)} материалов</span>
          </button>
        `
      )
      .join("");

    return;
  }

  gridView.hidden = true;
  contentView.hidden = false;

  const folder = allFolders().find((item) => item.id === activeFolder);

  if (!folder) {
    activeFolder = null;
    renderFiles();
    return;
  }

  topbar.innerHTML = `
    <button class="back-folder-btn" type="button" onclick="closeFolder()" aria-label="Назад">
      <svg class="svg-icon"><use href="#i-arrow-left"></use></svg>
    </button>
    <span class="files-topbar-title">${esc(folder.name)}</span>
  `;

  const items = allItems().filter((item) => {
    const itemText = `${item.title} ${item.text} ${(item.tags || []).join(" ")}`.toLowerCase();

    return (
      isItemInFolder(item, folder) &&
      (!searchQuery || itemText.includes(searchQuery))
    );
  });

  const gallery = document.getElementById("folderGallery");
  gallery.innerHTML = "";

  if (!items.length) {
    gallery.innerHTML = `
      <div class="empty-files">
        В этой папке пока нет материалов
      </div>
    `;
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `grid-item ${item.type}`;

    if (item.type === "photo" && safeUrl(item.url)) {
      card.innerHTML = `<img src="${safeUrl(item.url)}" alt="${esc(item.title)}">`;
      card.onclick = () => openMedia(item);
    } else {
      const preview = clean(item.text).slice(0, 190) || "Откройте, чтобы посмотреть материал";

      card.innerHTML = `
        <div class="text-card-body">
          <strong>${esc(item.title)}</strong>
          <span>${esc(preview)}</span>
        </div>
      `;

      card.onclick = () => openDetails(item);
    }

    gallery.appendChild(card);
  });
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

function handleSearch() {
  searchQuery = document.getElementById("searchInput").value.trim().toLowerCase();

  if (activeFolder) renderFiles();
}

function openCreateFolderModal() {
  const modal = document.getElementById("createFolderModal");
  const input = document.getElementById("newFolderName");

  modal.classList.add("active");
  input.value = "";

  setTimeout(() => input.focus(), 150);
}

function closeCreateFolderModal() {
  document.getElementById("createFolderModal").classList.remove("active");
}

function createFolder() {
  const input = document.getElementById("newFolderName");
  const name = clean(input.value);

  if (name.length < 2) {
    toast("Введите название папки");
    input.focus();
    return;
  }

  const alreadyExists = allFolders().some(
    (folder) => folder.name.toLowerCase() === name.toLowerCase()
  );

  if (alreadyExists) {
    toast("Папка с таким названием уже есть");
    return;
  }

  db.customFolders.push({
    id: `folder_${Date.now()}`,
    name: name.slice(0, 40),
    createdAt: new Date().toISOString()
  });

  saveDB();
  closeCreateFolderModal();
  renderFiles();
  haptic("impactOccurred");
  toast("Папка создана");
}

/* ИИ-чат */

function relevant(question) {
  const query = words(question);

  return db.notes
    .map((note) => ({
      ...note,
      score: query.reduce((total, word) => {
        const noteWords = words(
          `${note.title} ${note.text} ${(note.tags || []).join(" ")}`
        );

        return total + (noteWords.includes(word) ? 1 : 0);
      }, 0)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function chatMessage(text, role, sources = []) {
  const box = document.getElementById("chatContainer");
  const welcome = box.querySelector(".chat-welcome");

  if (welcome) welcome.remove();

  const item = document.createElement("div");
  item.className = `chat-msg ${role}`;
  item.textContent = text;

  if (sources.length) {
    const sourceBox = document.createElement("div");
    sourceBox.className = "chat-sources";

    sources.forEach((source) => {
      const button = document.createElement("button");
      button.className = "chat-source";
      button.textContent = source.title || "Заметка";
      button.onclick = () => openDetails(source);
      sourceBox.appendChild(button);
    });

    item.appendChild(sourceBox);
  }

  box.appendChild(item);
  box.scrollTop = box.scrollHeight;

  return item;
}

function askAiSuggestion(question) {
  document.getElementById("chatInput").value = question;
  sendChatMessage();
}

async function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const question = input.value.trim();

  if (!question) return;

  input.value = "";
  chatMessage(question, "user");

  const notes = relevant(question);

  if (!notes.length) {
    chatMessage(
      "Пока не нашёл подходящих заметок. Добавьте несколько мыслей в раздел «Главная», и я смогу искать связи между ними.",
      "ai"
    );
    return;
  }

  const context = notes
    .map((note, index) => `[${index + 1}] ${note.title}\n${note.text.slice(0, 1000)}`)
    .join("\n\n");

  const loading = chatMessage("Думаю над вашими материалами…", "ai");

  const answer = await ai(
    "Ты Infinity AI — помощник по личным заметкам. Отвечай дружелюбно, кратко и только по данному контексту. Если информации не хватает, прямо скажи об этом.",
    `${context}\n\nВОПРОС:\n${question}`,
    420
  );

  loading.remove();

  chatMessage(
    answer || "Не получилось получить ответ. Проверьте API-ключ в настройках профиля.",
    "ai",
    notes
  );
}

function handleChatKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
  }
}

/* Дневник */

function setMood(value) {
  mood = moodData[value] ? value : "calm";

  document.querySelectorAll(".mood-btn").forEach((button) => {
    button.classList.toggle("selected", button.dataset.mood === mood);
  });

  haptic();
}

function journalCounter() {
  const input = document.getElementById("journalInput");
  const counter = document.getElementById("journalCharCounter");

  if (counter) {
    counter.textContent = `${input.value.length} / ${input.maxLength}`;
  }
}

function saveJournal() {
  const input = document.getElementById("journalInput");
  const text = input.value.trim();

  if (!text) {
    toast("Введите запись дневника");
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
  journalCounter();

  saveDB();
  renderJournalCalendars();
  renderActivity();

  haptic("impactOccurred");
  toast("Запись дневника сохранена");
}

function monthTitle(date) {
  const value = date.toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric"
  });

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function calendarMarkup(date, full = false) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const today = dateKey(new Date());
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const entriesByDate = new Map(
    db.journal.map((entry) => [dateKey(entry.date), entry])
  );

  let markup = "";

  for (let index = 0; index < firstDay; index += 1) {
    markup += '<span class="calendar-day blank"></span>';
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const entry = entriesByDate.get(key);
    const classes = [
      "calendar-day",
      entry ? "has-entry" : "no-entry",
      key === today ? "today" : ""
    ]
      .filter(Boolean)
      .join(" ");

    if (entry && full) {
      markup += `
        <button class="${classes}" type="button" onclick="openJournalEntry('${entry.id}')">
          ${day}
        </button>
      `;
    } else {
      markup += `<span class="${classes}">${day}</span>`;
    }
  }

  return markup;
}

function renderJournalCalendars() {
  const now = new Date();
  const preview = document.getElementById("journalCalendarPreview");
  const previewTitle = document.getElementById("calendarMonthTitle");

  if (preview) preview.innerHTML = calendarMarkup(now, false);
  if (previewTitle) previewTitle.textContent = monthTitle(now);

  const fullCalendar = document.getElementById("fullJournalCalendar");
  const fullTitle = document.getElementById("fullCalendarTitle");

  if (fullCalendar) fullCalendar.innerHTML = calendarMarkup(calendarDate, true);
  if (fullTitle) fullTitle.textContent = monthTitle(calendarDate);
}

function openJournalCalendar() {
  calendarDate = new Date();
  renderJournalCalendars();
  document.getElementById("journalCalendarModal").classList.add("active");
  haptic();
}

function closeJournalCalendar() {
  document.getElementById("journalCalendarModal").classList.remove("active");
}

function changeCalendarMonth(offset) {
  calendarDate = new Date(
    calendarDate.getFullYear(),
    calendarDate.getMonth() + offset,
    1
  );

  renderJournalCalendars();
  haptic();
}

function openJournalEntry(id) {
  const entry = db.journal.find((item) => String(item.id) === String(id));

  if (!entry) {
    toast("Запись не найдена");
    return;
  }

  const moodInfo = moodData[entry.mood] || moodData.calm;

  document.getElementById("journalEntryDate").textContent =
    formatDate(entry.date).toUpperCase();

  document.getElementById("journalEntryTitle").textContent = "Запись дневника";
  document.getElementById("journalEntryMood").textContent =
    `${moodInfo.emoji} ${moodInfo.title}`;

  document.getElementById("journalEntryText").textContent = entry.text;
  document.getElementById("journalEntryModal").classList.add("active");
}

function closeJournalEntry() {
  document.getElementById("journalEntryModal").classList.remove("active");
}

/* Карта нейронов */

function createLinks(notes) {
  const links = [];
  const degree = {};

  notes.forEach((first, index) => {
    notes.slice(index + 1).forEach((second) => {
      const firstTags = new Set(
        (first.tags || []).map((tag) => String(tag).toLowerCase())
      );

      const commonTags = (second.tags || []).filter((tag) =>
        firstTags.has(String(tag).toLowerCase())
      );

      const textMatches = words(first.text)
        .filter((word) => word.length > 4 && words(second.text).includes(word))
        .slice(0, 2);

      const strength = commonTags.length + (textMatches.length ? 1 : 0);

      if (strength) {
        links.push({
          source: `note_${first.id}`,
          target: `note_${second.id}`,
          strength
        });
      }
    });
  });

  return links
    .sort((a, b) => b.strength - a.strength)
    .filter((link) => {
      if ((degree[link.source] || 0) >= 5 || (degree[link.target] || 0) >= 5) {
        return false;
      }

      degree[link.source] = (degree[link.source] || 0) + 1;
      degree[link.target] = (degree[link.target] || 0) + 1;

      return true;
    });
}

function createNeuron(node) {
  if (!window.THREE) return null;

  const group = new window.THREE.Group();
  const radius = 2.6 + Math.min((node.note.tags || []).length, 5) * 0.35;

  const core = new window.THREE.Mesh(
    new window.THREE.SphereGeometry(radius, 18, 18),
    new window.THREE.MeshBasicMaterial({
      color: node.color,
      transparent: true,
      opacity: .96
    })
  );

  const glow = new window.THREE.Mesh(
    new window.THREE.SphereGeometry(radius * 1.8, 18, 18),
    new window.THREE.MeshBasicMaterial({
      color: node.color,
      transparent: true,
      opacity: .11
    })
  );

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 110;

  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(8, 13, 23, .92)";
  context.roundRect(8, 8, 496, 94, 28);
  context.fill();

  context.fillStyle = "#f4f7ff";
  context.font = "700 33px Outfit, Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";

  const title = String(node.name).slice(0, 29);
  context.fillText(title, 256, 55);

  const texture = new window.THREE.CanvasTexture(canvas);
  const label = new window.THREE.Sprite(
    new window.THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    })
  );

  label.scale.set(34, 7.3, 1);
  label.position.set(0, radius + 6, 0);
  label.visible = false;

  group.add(glow);
  group.add(core);
  group.add(label);

  node.labelSprite = label;

  return group;
}

function openBrainMap() {
  const modal = document.getElementById("brainMapModal");
  const mount = document.getElementById("3d-graph");

  modal.classList.add("active");
  mount.innerHTML = "";

  if (!db.notes.length || typeof window.ForceGraph3D !== "function") {
    mount.innerHTML = `
      <p class="brain-empty-message">
        Добавьте несколько заметок. ИИ подберёт им теги, а здесь появятся связи между идеями.
      </p>
    `;
    return;
  }

  const nodes = db.notes.map((note) => ({
    id: `note_${note.id}`,
    note,
    name: note.title || "Заметка",
    description: clean(note.text).slice(0, 160),
    color: note.tags?.length ? "#8d7cff" : "#6c91ff",
    val: 3 + Math.min((note.tags || []).length, 5)
  }));

  const graphLinks = createLinks(db.notes);

  brainGraph = window
    .ForceGraph3D()(mount)
    .graphData({ nodes, links: graphLinks })
    .backgroundColor("#050911")
    .nodeVal("val")
    .nodeColor("color")
    .nodeThreeObject(createNeuron)
    .nodeLabel((node) => `<b>${esc(node.name)}</b><br>${esc(node.description)}`)
    .linkColor((link) =>
      link.strength > 1
        ? "rgba(174, 132, 255, .82)"
        : "rgba(108, 145, 255, .48)"
    )
    .linkWidth((link) => 0.8 + link.strength * 0.7)
    .linkDirectionalParticles((link) => (link.strength > 1 ? 2 : 1))
    .linkDirectionalParticleWidth(1.5)
    .linkDirectionalParticleSpeed(.004)
    .onNodeClick((node) => openDetails(node.note))
    .onNodeHover((node) => {
      mount.style.cursor = node ? "pointer" : "grab";
    })
    .onEngineTick(() => {
      const camera = brainGraph?.cameraPosition?.();

      if (!camera) return;

      nodes.forEach((node) => {
        if (!node.labelSprite || !Number.isFinite(node.x)) return;

        const distance = Math.hypot(
          camera.x - node.x,
          camera.y - node.y,
          camera.z - node.z
        );

        node.labelSprite.visible = distance < 205;
      });
    });

  brainGraph.controls().enableDamping = true;
  brainGraph.controls().dampingFactor = .1;
  brainGraph.d3Force("charge")?.strength(-190);
  brainGraph.d3Force("link")?.distance(115);

  document.getElementById("brainSearchInput").oninput = (event) => {
    const query = event.target.value.trim().toLowerCase();

    if (!query) return;

    const found = nodes.find((node) =>
      node.name.toLowerCase().includes(query)
    );

    if (found) {
      brainGraph.cameraPosition(
        {
          x: found.x + 55,
          y: found.y + 55,
          z: found.z + 125
        },
        found,
        600
      );
    }
  };

  setTimeout(() => brainGraph.zoomToFit(750, 90), 250);
}

function closeBrainMap() {
  brainGraph?._destructor?.();
  brainGraph = null;

  document.getElementById("brainMapModal").classList.remove("active");
}

/* Открытие материалов */

function openDetails(item) {
  document.getElementById("details-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "details-overlay";
  overlay.className = "note-details-overlay";

  overlay.innerHTML = `
    <section class="note-details-card" role="dialog" aria-modal="true">
      <button class="note-details-close" type="button" aria-label="Закрыть">
        <svg class="svg-icon"><use href="#i-close"></use></svg>
      </button>
      <div class="note-details-date">${esc(formatDate(item.date || Date.now()))}</div>
      <h2>${esc(item.title || "Материал")}</h2>
      <div class="note-details-text">
        ${esc(item.text || "Содержимое файла не было передано сервером.").replaceAll("\n", "<br>")}
      </div>
    </section>
  `;

  overlay.onclick = (event) => {
    if (event.target === overlay || event.target.closest(".note-details-close")) {
      overlay.remove();
    }
  };

  document.body.appendChild(overlay);
}

function openMedia(file) {
  const url = safeUrl(file.url);

  if (!url) return;

  document.getElementById("modalContent").innerHTML =
    `<img src="${url}" alt="${esc(file.title)}">`;

  document.getElementById("mediaModal").classList.add("active");
}

function closeModal() {
  document.getElementById("mediaModal").classList.remove("active");
  document.getElementById("modalContent").innerHTML = "";
}

/* Активность и портрет */

function renderActivity() {
  const today = new Date();

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));

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
    .map(
      (day) => `
        <div class="activity-bar-wrap">
          <div class="activity-bar" style="height:${Math.max(8, (day.count / max) * 100)}%"></div>
          <span class="activity-label">${day.label}</span>
        </div>
      `
    )
    .join("");
}

async function generateDailyInsight() {
  const end = new Date();
  const start = new Date();

  if (insightPeriod === "week") {
    start.setDate(end.getDate() - 6);
  }

  const records = [...db.notes, ...db.journal]
    .filter((item) => new Date(item.date) >= start)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8)
    .map(
      (item) =>
        `${item.title || "Дневник"}: ${String(item.text).slice(0, 550)}`
    )
    .join("\n---\n");

  const area = document.getElementById("dailyInsightContent");

  if (!records) {
    area.textContent = "За выбранный период пока нет записей.";
    return;
  }

  area.textContent = "Создаю бережный портрет…";

  const result = await ai(
    "Сделай бережный краткий портрет человека только по его записям. Отметь возможные мысли, чувства и одну полезную рекомендацию. Не ставь диагнозов. До 5 предложений.",
    records,
    260
  );

  area.textContent = result || "Не удалось создать портрет.";
}

/* Экспорт, импорт и навигация */

function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 2)], {
    type: "application/json"
  });

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
      const imported = JSON.parse(String(reader.result));

      if (!imported || typeof imported !== "object") {
        throw new Error();
      }

      localStorage.setItem("infinityLocalDB", JSON.stringify(imported));
      location.reload();
    } catch (_) {
      toast("Не удалось импортировать файл");
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
  if (id === "journal") renderJournalCalendars();

  haptic();
}

function toast(text) {
  const item = document.createElement("div");

  item.className = "toast";
  item.textContent = text;

  document.getElementById("toast-box").appendChild(item);

  setTimeout(() => item.remove(), 3000);
}

function closeModalOnBackdrop(modalId) {
  const modal = document.getElementById(modalId);

  modal.addEventListener("click", (event) => {
    if (event.target !== modal) return;

    if (modalId === "createFolderModal") closeCreateFolderModal();
    if (modalId === "journalCalendarModal") closeJournalCalendar();
    if (modalId === "journalEntryModal") closeJournalEntry();
  });
}

async function init() {
  const name = user?.first_name || "Пользователь";

  document.getElementById("userName").textContent = name;
  document.getElementById("userAvatar").textContent = name[0].toUpperCase();

  document.getElementById("journalCurrentDate").textContent =
    formatDate(new Date(), { weekday: "long" });

  document.getElementById("smartNoteInput").oninput = noteCounter;
  document.getElementById("journalInput").oninput = journalCounter;

  document.getElementById("newFolderName").onkeydown = (event) => {
    if (event.key === "Enter") createFolder();
  };

  document.getElementById("aiProvider").onchange = changeProvider;
  document.getElementById("saveSettingsBtn").onclick = saveSettings;

  document.getElementById("toggleApiKey").onclick = () => {
    const input = document.getElementById("togetherApiKey");
    input.type = input.type === "password" ? "text" : "password";
  };

  document.getElementById("toggleAISettings").onclick = () => {
    const panel = document.getElementById("aiSettingsPanel");
    const button = document.getElementById("toggleAISettings");

    panel.hidden = !panel.hidden;
    button.setAttribute("aria-expanded", String(!panel.hidden));
  };

  document.querySelectorAll("[data-insight-period]").forEach((button) => {
    button.onclick = () => {
      insightPeriod = button.dataset.insightPeriod;

      document.querySelectorAll("[data-insight-period]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
    };
  });

  closeModalOnBackdrop("createFolderModal");
  closeModalOnBackdrop("journalCalendarModal");
  closeModalOnBackdrop("journalEntryModal");

  loadSettings();
  noteCounter();
  journalCounter();
  updateStreak();
  setMood("calm");

  renderJournalCalendars();
  renderActivity();

  await loadFiles();

  setTimeout(() => {
    document.getElementById("app-loader").classList.add("hidden");
  }, 300);
}

document.addEventListener("DOMContentLoaded", init);
