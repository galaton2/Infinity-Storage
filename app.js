"use strict";

/* ─────────────────────────────────────────────────────────────
   Telegram: безопасная работа и в Telegram, и в обычном браузере
───────────────────────────────────────────────────────────── */
const tg = window.Telegram?.WebApp || null;

try {
  tg?.ready();
  tg?.expand();
  tg?.setHeaderColor?.("#020204");
  tg?.setBackgroundColor?.("#020204");
  tg?.setBottomBarColor?.("#020204");
} catch (error) {
  console.warn("Telegram WebApp недоступен:", error);
}

const telegramUser = tg?.initDataUnsafe?.user || null;

function haptic(type = "selection") {
  try {
    if (type === "impact") {
      tg?.HapticFeedback?.impactOccurred?.("medium");
    } else {
      tg?.HapticFeedback?.selectionChanged?.();
    }
  } catch {
    /* В обычном браузере вибрации Telegram нет. */
  }
}

/* ─────────────────────────────────────────────────────────────
   Константы и состояние
───────────────────────────────────────────────────────────── */
const API_URL = "https://galaxylab.i234.me:8443/api/files";

const AI_PROVIDERS = {
  together: {
    name: "Together AI",
    models: [
      {
        value: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        label: "Llama 3.3 70B"
      },
      {
        value: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
        label: "Llama 3.1 8B"
      },
      {
        value: "Qwen/Qwen2.5-72B-Instruct-Turbo",
        label: "Qwen 2.5 72B"
      }
    ]
  },

  openai: {
    name: "OpenAI",
    models: [
      { value: "gpt-4o-mini", label: "GPT-4o mini" },
      { value: "gpt-4.1-mini", label: "GPT-4.1 mini" },
      { value: "gpt-4o", label: "GPT-4o" }
    ]
  },

  anthropic: {
    name: "Anthropic",
    models: [
      {
        value: "claude-3-5-haiku-latest",
        label: "Claude 3.5 Haiku"
      },
      {
        value: "claude-3-5-sonnet-latest",
        label: "Claude 3.5 Sonnet"
      }
    ]
  },

  google: {
    name: "Google Gemini",
    models: [
      { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" }
    ]
  }
};

let globalFiles = [];
let activeFolder = null;
let searchQuery = "";
let currentMood = "😐";

let folders = [
  {
    id: "smart_notes",
    name: "Smart Notes",
    emoji: "🧠",
    accent: "#ff9800",
    bg: "rgba(255,152,0,.1)",
    autoTypes: ["smart_note"]
  },
  {
    id: "texts",
    name: "Texts",
    emoji: "📝",
    accent: "#a078ff",
    bg: "rgba(160,120,255,.1)",
    autoTypes: ["text"]
  },
  {
    id: "documents",
    name: "Documents",
    emoji: "📄",
    accent: "#5b8cff",
    bg: "rgba(91,140,255,.1)",
    autoTypes: ["document", "audio", "voice"]
  },
  {
    id: "media",
    name: "Media",
    emoji: "🖼️",
    accent: "#00d98a",
    bg: "rgba(0,217,138,.1)",
    autoTypes: ["photo", "video", "animation", "video_note"]
  }
];

/* ─────────────────────────────────────────────────────────────
   Local Storage
───────────────────────────────────────────────────────────── */
const defaultDatabase = {
  notes: [],
  journal: [],
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

function loadLocalDatabase() {
  try {
    const saved = JSON.parse(localStorage.getItem("infinityLocalDB"));

    if (!saved || typeof saved !== "object") {
      return structuredClone(defaultDatabase);
    }

    const database = {
      ...structuredClone(defaultDatabase),
      ...saved,
      stats: {
        ...structuredClone(defaultDatabase.stats),
        ...(saved.stats || {})
      },
      settings: {
        ...structuredClone(defaultDatabase.settings),
        ...(saved.settings || {})
      }
    };

    database.notes = Array.isArray(database.notes) ? database.notes : [];
    database.journal = Array.isArray(database.journal) ? database.journal : [];
    database.settings.apiKeys = database.settings.apiKeys || {};

    /* Совместимость со старой версией приложения */
    if (
      database.settings.togetherApiKey &&
      !database.settings.apiKeys.together
    ) {
      database.settings.apiKeys.together =
        database.settings.togetherApiKey;
    }

    return database;
  } catch (error) {
    console.error("Не удалось прочитать локальные данные:", error);
    return structuredClone(defaultDatabase);
  }
}

let localDB = loadLocalDatabase();

function saveLocalDB() {
  try {
    localStorage.setItem("infinityLocalDB", JSON.stringify(localDB));
  } catch (error) {
    console.error("Не удалось сохранить данные:", error);
    showToast("Не удалось сохранить данные в браузере");
  }

  updateStatsUI();
  updateStorageUI();
}

/* ─────────────────────────────────────────────────────────────
   Вспомогательные функции
───────────────────────────────────────────────────────────── */
function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const url = new URL(value, window.location.href);

    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch {
    /* Невалидная ссылка не должна попасть в DOM */
  }

  return "";
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;

  if (value < 1024) return `${value} Б`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} КБ`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} МБ`;

  return `${(value / 1024 ** 3).toFixed(2)} ГБ`;
}

function getAllItems() {
  const localNotes = localDB.notes.map((note) => ({
    internalId: `local_note_${note.id}`,
    id: note.id,
    type: "smart_note",
    text: note.text || "",
    title: note.title || "Заметка",
    tags: Array.isArray(note.tags) ? note.tags : [],
    date: note.date || new Date().toISOString(),
    size: new Blob([note.text || ""]).size
  }));

  return [...globalFiles, ...localNotes];
}

function getCurrentProvider() {
  return localDB.settings.aiProvider in AI_PROVIDERS
    ? localDB.settings.aiProvider
    : "together";
}

function getCurrentModel() {
  const provider = getCurrentProvider();
  const models = AI_PROVIDERS[provider].models;
  const selected = localDB.settings.aiModel;

  return models.some((model) => model.value === selected)
    ? selected
    : models[0].value;
}

function getCurrentApiKey() {
  const provider = getCurrentProvider();

  return (
    localDB.settings.apiKeys?.[provider] ||
    (provider === "together"
      ? localDB.settings.togetherApiKey || ""
      : "")
  ).trim();
}

/* ─────────────────────────────────────────────────────────────
   Настройки ИИ
───────────────────────────────────────────────────────────── */
function renderModelOptions(provider, selectedModel = "") {
  const modelSelect = document.getElementById("aiModel");
  const availableModels = AI_PROVIDERS[provider]?.models || [];

  modelSelect.innerHTML = availableModels
    .map(
      (model) =>
        `<option value="${esc(model.value)}">${esc(model.label)}</option>`
    )
    .join("");

  const validModel = availableModels.some(
    (model) => model.value === selectedModel
  )
    ? selectedModel
    : availableModels[0]?.value || "";

  modelSelect.value = validModel;
  return validModel;
}

function loadSettingsUI() {
  const providerSelect = document.getElementById("aiProvider");
  const keyInput = document.getElementById("togetherApiKey");

  const provider = getCurrentProvider();
  providerSelect.value = provider;

  const selectedModel = renderModelOptions(
    provider,
    localDB.settings.aiModel
  );

  localDB.settings.aiProvider = provider;
  localDB.settings.aiModel = selectedModel;
  keyInput.value = localDB.settings.apiKeys?.[provider] || "";
}

function onProviderChange() {
  const provider = document.getElementById("aiProvider").value;
  const previousProvider = getCurrentProvider();
  const keyInput = document.getElementById("togetherApiKey");

  localDB.settings.apiKeys ||= {};
  localDB.settings.apiKeys[previousProvider] = keyInput.value.trim();

  localDB.settings.aiProvider = provider;
  localDB.settings.aiModel = renderModelOptions(
    provider,
    localDB.settings.aiModel
  );

  keyInput.value = localDB.settings.apiKeys[provider] || "";
}

function saveSettings() {
  const provider = document.getElementById("aiProvider").value;
  const model = document.getElementById("aiModel").value;
  const apiKey = document.getElementById("togetherApiKey").value.trim();

  localDB.settings.apiKeys ||= {};
  localDB.settings.aiProvider = provider;
  localDB.settings.aiModel = model;
  localDB.settings.apiKeys[provider] = apiKey;

  /* Оставлено только для совместимости со старыми резервными копиями */
  localDB.settings.togetherApiKey =
    localDB.settings.apiKeys.together || "";

  saveLocalDB();
  showToast(`Настройки ${AI_PROVIDERS[provider].name} сохранены`);
}

function toggleApiKeyVisibility() {
  const keyInput = document.getElementById("togetherApiKey");

  keyInput.type = keyInput.type === "password" ? "text" : "password";
}

/* ─────────────────────────────────────────────────────────────
   Запросы к ИИ
───────────────────────────────────────────────────────────── */
async function readApiError(response) {
  try {
    const data = await response.json();

    return (
      data?.error?.message ||
      data?.message ||
      data?.error ||
      `Ошибка API: ${response.status}`
    );
  } catch {
    return `Ошибка API: ${response.status}`;
  }
}

async function callAI(systemPrompt, userPrompt) {
  const provider = getCurrentProvider();
  const model = getCurrentModel();
  const apiKey = getCurrentApiKey();

  if (!apiKey) {
    showToast(`Введите API-ключ для ${AI_PROVIDERS[provider].name}`);
    return null;
  }

  try {
    let response;
    let text = "";

    if (provider === "together" || provider === "openai") {
      const endpoint =
        provider === "together"
          ? "https://api.together.xyz/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions";

      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.5,
          max_tokens: 700
        })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const data = await response.json();
      text = data?.choices?.[0]?.message?.content || "";
    }

    if (provider === "anthropic") {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          max_tokens: 700,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }]
        })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const data = await response.json();
      text = data?.content?.[0]?.text || "";
    }

    if (provider === "google") {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: systemPrompt }]
            },
            contents: [
              {
                role: "user",
                parts: [{ text: userPrompt }]
              }
            ],
            generationConfig: {
              temperature: 0.5,
              maxOutputTokens: 700
            }
          })
        }
      );

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const data = await response.json();
      text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    if (!text.trim()) {
      throw new Error("ИИ вернул пустой ответ");
    }

    return text.trim();
  } catch (error) {
    console.error("Ошибка ИИ:", error);

    const message =
      error instanceof Error ? error.message : "Неизвестная ошибка";

    if (/401|403|key|auth|unauthorized/i.test(message)) {
      showToast("Проверьте API-ключ и доступ к выбранной модели");
    } else {
      showToast("Не удалось получить ответ ИИ");
    }

    return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   Статистика
───────────────────────────────────────────────────────────── */
function updateStatsUI() {
  const streak = document.getElementById("streakCounter");
  const words = document.getElementById("wordsCount");
  const total = document.getElementById("totalFilesCount");

  if (streak) streak.textContent = `🔥 ${localDB.stats.streak || 0}`;
  if (words) words.textContent = localDB.stats.wordsWritten || 0;
  if (total) total.textContent = getAllItems().length;
}

function updateStorageUI() {
  const allItems = getAllItems();

  const serverBytes = globalFiles.reduce(
    (sum, file) => sum + Number(file.size || file.file_size || 0),
    0
  );

  const notesBytes = localDB.notes.reduce(
    (sum, note) => sum + new Blob([note.text || ""]).size,
    0
  );

  const usedBytes = serverBytes + notesBytes;
  const storageText = document.getElementById("dataUsedText");
  const fill = document.getElementById("dataUsedFill");

  if (storageText) storageText.textContent = formatBytes(usedBytes);

  /*
    Это не лимит хранилища, а просто визуальная шкала.
    После 100 МБ она будет показывать 100%.
  */
  const percent = Math.min((usedBytes / (100 * 1024 * 1024)) * 100, 100);

  if (fill) {
    fill.style.width = `${percent}%`;
    fill.parentElement?.setAttribute(
      "aria-valuenow",
      String(Math.round(percent))
    );
  }

  updateStatsUI();
}

function updateStreak() {
  const today = new Date().toDateString();

  if (localDB.stats.lastLogin === today) return;

  const yesterday = new Date(Date.now() - 86400000).toDateString();

  localDB.stats.streak =
    localDB.stats.lastLogin === yesterday
      ? (localDB.stats.streak || 0) + 1
      : 1;

  localDB.stats.lastLogin = today;
  saveLocalDB();
}

/* ─────────────────────────────────────────────────────────────
   Серверные файлы
───────────────────────────────────────────────────────────── */
async function fetchServerFiles() {
  const userId = telegramUser?.id || "browser-user";

  try {
    const response = await fetch(
      `${API_URL}?user_id=${encodeURIComponent(userId)}&limit=100`
    );

    if (!response.ok) {
      throw new Error(`Сервер вернул ${response.status}`);
    }

    const data = await response.json();
    const files = Array.isArray(data?.files) ? data.files : [];

    globalFiles = files.map((file, index) => ({
      ...file,
      internalId: `server_${file.id || index}`,
      type: file.type || file.file_type || "document",
      title: file.title || file.name || file.file_name || "Файл",
      text: file.text || file.caption || "",
      url: file.url || file.file_url || "",
      size: Number(file.size || file.file_size || 0),
      date: file.date || file.created_at || new Date().toISOString()
    }));
  } catch (error) {
    globalFiles = [];
    console.warn("Серверные файлы недоступны:", error);
  }

  updateStorageUI();
}

/* ─────────────────────────────────────────────────────────────
   Умные заметки
───────────────────────────────────────────────────────────── */
function parseNoteAnalysis(answer) {
  const fallback = {
    title: "Заметка",
    tags: []
  };

  try {
    const jsonPart = answer.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonPart) return fallback;

    const parsed = JSON.parse(jsonPart);

    return {
      title:
        typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title.trim().slice(0, 80)
          : fallback.title,

      tags: Array.isArray(parsed.tags)
        ? parsed.tags
            .filter((tag) => typeof tag === "string")
            .map((tag) => tag.trim().replace(/^#/, "").slice(0, 30))
            .filter(Boolean)
            .slice(0, 5)
        : []
    };
  } catch {
    return fallback;
  }
}

async function saveSmartNote() {
  const input = document.getElementById("smartNoteInput");
  const text = input.value.trim();

  if (!text) {
    showToast("Введите текст заметки");
    input.focus();
    return;
  }

  haptic("impact");
  input.value = "";

  let noteData = {
    title: "Заметка",
    tags: []
  };

  if (getCurrentApiKey()) {
    showToast("ИИ анализирует заметку…");

    const answer = await callAI(
      "Ты помощник по организации заметок. Верни только валидный JSON без Markdown: {\"title\":\"краткий заголовок\",\"tags\":[\"тег1\",\"тег2\"]}. Заголовок — до 80 символов, тегов — до 5.",
      text
    );

    if (answer) {
      noteData = parseNoteAnalysis(answer);
    }
  }

  localDB.notes.unshift({
    id: Date.now(),
    text,
    title: noteData.title,
    tags: noteData.tags,
    date: new Date().toISOString()
  });

  localDB.stats.wordsWritten += text.split(/\s+/).filter(Boolean).length;

  saveLocalDB();
  renderFilesView();

  showToast("Заметка сохранена");
}

/* ─────────────────────────────────────────────────────────────
   Дневник
───────────────────────────────────────────────────────────── */
function setMood(mood) {
  currentMood = mood;

  document
    .querySelectorAll(".journal-mood-selector button")
    .forEach((button) => {
      button.classList.toggle(
        "selected",
        button.getAttribute("aria-label") ===
          {
            "😢": "Грустно",
            "😐": "Нейтрально",
            "😊": "Хорошо",
            "🤩": "Отлично"
          }[mood]
      );
    });

  haptic();
}

function renderJournalFeed() {
  const feed = document.getElementById("journalFeed");
  if (!feed) return;

  if (!localDB.journal.length) {
    feed.innerHTML =
      '<div class="journal-entry" style="color:var(--text-muted);text-align:center;">Записей пока нет.</div>';
    return;
  }

  feed.innerHTML = localDB.journal
    .map((entry) => {
      const date = new Date(entry.date);

      const dateText = Number.isNaN(date.getTime())
        ? ""
        : `${date.toLocaleDateString("ru-RU")} · ${date.toLocaleTimeString(
            "ru-RU",
            {
              hour: "2-digit",
              minute: "2-digit"
            }
          )}`;

      return `
        <article class="journal-entry">
          <div class="journal-entry-header">
            <span>${esc(dateText)}</span>
            <span aria-label="Настроение">${esc(entry.mood || "😐")}</span>
          </div>
          <div>${esc(entry.text || "")}</div>
          ${
            entry.aiComment
              ? `<div class="journal-ai-comment">✨ ${esc(entry.aiComment)}</div>`
              : ""
          }
        </article>
      `;
    })
    .join("");
}

async function saveJournal() {
  const input = document.getElementById("journalInput");
  const text = input.value.trim();

  if (!text) {
    showToast("Введите запись для дневника");
    input.focus();
    return;
  }

  haptic("impact");
  input.value = "";

  let aiComment =
    "Запись сохранена. Возвращайтесь к ней позже, чтобы увидеть свои мысли со стороны.";

  if (getCurrentApiKey()) {
    showToast("ИИ готовит рефлексию…");

    const answer = await callAI(
      "Ты бережный помощник по рефлексии. Дай короткий, спокойный и поддерживающий комментарий к дневниковой записи: максимум два предложения. Не ставь диагнозы, не утверждай медицинские факты.",
      `Настроение: ${currentMood}\n\nЗапись:\n${text}`
    );

    if (answer) aiComment = answer;
  }

  localDB.journal.unshift({
    id: Date.now(),
    text,
    mood: currentMood,
    aiComment,
    date: new Date().toISOString()
  });

  localDB.stats.wordsWritten += text.split(/\s+/).filter(Boolean).length;

  saveLocalDB();
  renderJournalFeed();

  showToast("Запись дневника сохранена");
}

/* ─────────────────────────────────────────────────────────────
   Чат по заметкам
───────────────────────────────────────────────────────────── */
function appendChatMsg(text, sender, id = "") {
  const container = document.getElementById("chatContainer");
  if (!container) return;

  const message = document.createElement("div");
  message.className = `chat-msg ${sender}`;

  if (id) message.id = id;

  /* textContent защищает чат от вставки HTML/скриптов */
  message.textContent = text;

  container.appendChild(message);
  container.scrollTop = container.scrollHeight;
}

function buildRagContext() {
  const notes = localDB.notes
    .slice(0, 20)
    .map(
      (note) =>
        `ЗАМЕТКА: ${note.title || "Без названия"}\n${note.text || ""}`
    );

  const journal = localDB.journal
    .slice(0, 10)
    .map((entry) => `ДНЕВНИК: ${entry.text || ""}`);

  const context = [...notes, ...journal].join("\n\n---\n\n");

  return context.slice(0, 14000);
}

async function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const question = input.value.trim();

  if (!question) return;

  input.value = "";
  appendChatMsg(question, "user");

  if (!getCurrentApiKey()) {
    appendChatMsg(
      "Укажите API-ключ и выберите ИИ в разделе «Профиль».",
      "ai"
    );
    return;
  }

  const context = buildRagContext();

  if (!context) {
    appendChatMsg(
      "У вас пока нет заметок или записей дневника, по которым я мог бы ответить.",
      "ai"
    );
    return;
  }

  appendChatMsg("Думаю…", "ai", "temp-loader");

  const answer = await callAI(
    `Ты — Second Brain пользователя. Отвечай только на основе контекста ниже. Если ответа нет в контексте, честно скажи об этом. Не выдумывай факты. Пиши кратко, на русском языке.\n\nКОНТЕКСТ:\n${context}`,
    question
  );

  document.getElementById("temp-loader")?.remove();

  appendChatMsg(
    answer || "Не удалось получить ответ. Попробуйте ещё раз.",
    "ai"
  );
}

function handleChatKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
  }
}

/* ─────────────────────────────────────────────────────────────
   Файлы и папки
───────────────────────────────────────────────────────────── */
function updateTopbar() {
  const bar = document.getElementById("filesTopbar");
  if (!bar) return;

  if (activeFolder === null) {
    bar.innerHTML = '<span class="files-topbar-title">Папки</span>';
    return;
  }

  const folder = folders.find((item) => item.id === activeFolder);

  bar.innerHTML = `
    <button class="icon-btn" type="button" onclick="closeFolder()" aria-label="Назад">
      <svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </button>
    <span class="files-topbar-title">${esc(folder?.name || "Папка")}</span>
  `;
}

function renderFolderGrid() {
  const grid = document.getElementById("folderGrid");
  if (!grid) return;

  const allItems = getAllItems();

  grid.innerHTML = folders
    .map((folder) => {
      const count = allItems.filter((item) =>
        folder.autoTypes.includes(item.type)
      ).length;

      return `
        <button class="folder-card" type="button" onclick="openFolder('${esc(folder.id)}')">
          <span class="folder-card-icon" style="background:${esc(folder.bg)}">${folder.emoji}</span>
          <span class="folder-card-name">${esc(folder.name)}</span>
          <span class="folder-card-count">${count} ${count === 1 ? "элемент" : "элементов"}</span>
        </button>
      `;
    })
    .join("");
}

function renderFolderContents() {
  const gallery = document.getElementById("folderGallery");
  const folder = folders.find((item) => item.id === activeFolder);

  if (!gallery || !folder) return;

  const query = searchQuery.trim().toLowerCase();

  const files = getAllItems().filter((file) => {
    if (!folder.autoTypes.includes(file.type)) return false;

    if (!query) return true;

    const haystack = [
      file.title,
      file.text,
      file.name,
      ...(Array.isArray(file.tags) ? file.tags : [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });

  if (!files.length) {
    gallery.innerHTML =
      '<div style="grid-column:1/-1;padding:24px;color:var(--text-muted);text-align:center;">Ничего не найдено</div>';
    return;
  }

  gallery.innerHTML = "";

  files.forEach((file) => {
    const card = document.createElement("div");
    card.className = `grid-item ${file.type || "document"}`;

    if (file.type === "smart_note") {
      card.innerHTML = `
        <div class="text-card-body">
          <strong style="color:var(--blue);font-family:Outfit,sans-serif;">
            ${esc(file.title || "Заметка")}
          </strong>
          <br><br>
          ${esc(file.text || "")}
        </div>
      `;

      card.addEventListener("click", () => {
        if (tg?.showAlert) {
          tg.showAlert(file.text || "");
        } else {
          showToast(file.text || "Заметка пуста");
        }
      });
    } else if (file.type === "photo" && safeUrl(file.url)) {
      const image = document.createElement("img");
      image.src = safeUrl(file.url);
      image.alt = file.title || "Изображение";
      image.loading = "lazy";

      card.appendChild(image);
      card.addEventListener("click", () => openModal(file));
    } else if (file.type === "video" && safeUrl(file.url)) {
      const video = document.createElement("video");
      video.src = safeUrl(file.url);
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";

      card.appendChild(video);
      card.addEventListener("click", () => openModal(file));
    } else {
      card.innerHTML = `
        <div class="text-card-body" style="display:flex;align-items:center;justify-content:center;text-align:center;">
          ${esc(file.title || file.type || "Файл")}
        </div>
      `;
    }

    gallery.appendChild(card);
  });
}

function renderFilesView() {
  const gridView = document.getElementById("folderGridView");
  const contentsView = document.getElementById("folderContentsView");

  updateTopbar();

  if (activeFolder === null) {
    gridView.hidden = false;
    contentsView.hidden = true;
    renderFolderGrid();
  } else {
    gridView.hidden = true;
    contentsView.hidden = false;
    renderFolderContents();
  }
}

function openFolder(folderId) {
  activeFolder = folderId;
  searchQuery = "";

  const search = document.getElementById("searchInput");
  if (search) search.value = "";

  renderFilesView();
  haptic();
}

function closeFolder() {
  activeFolder = null;
  searchQuery = "";

  const search = document.getElementById("searchInput");
  if (search) search.value = "";

  renderFilesView();
  haptic();
}

function handleSearch() {
  searchQuery = document.getElementById("searchInput")?.value || "";

  if (activeFolder !== null) {
    renderFolderContents();
  }
}

/* ─────────────────────────────────────────────────────────────
   Карта мыслей
───────────────────────────────────────────────────────────── */
function openBrainMap() {
  const modal = document.getElementById("brainMapModal");
  const container = document.getElementById("3d-graph");

  modal?.classList.add("active");

  if (!container) return;
  container.innerHTML = "";

  if (!localDB.notes.length) {
    container.innerHTML =
      '<p style="padding:50vh 20px 0;color:white;text-align:center;">Добавьте несколько заметок, чтобы построить карту мыслей.</p>';
    return;
  }

  if (typeof window.ForceGraph3D !== "function") {
    container.innerHTML =
      '<p style="padding:50vh 20px 0;color:white;text-align:center;">Не удалось загрузить библиотеку карты мыслей.</p>';
    return;
  }

  const nodes = [];
  const links = [];
  const tagIds = new Set();

  localDB.notes.forEach((note) => {
    const noteId = `note_${note.id}`;

    nodes.push({
      id: noteId,
      name: note.title || "Заметка",
      val: 3,
      color: "#5b8cff"
    });

    (note.tags || []).forEach((tag) => {
      const tagId = `tag_${tag.toLowerCase()}`;

      if (!tagIds.has(tagId)) {
        tagIds.add(tagId);

        nodes.push({
          id: tagId,
          name: `#${tag}`,
          val: 1.5,
          color: "#00d98a"
        });
      }

      links.push({ source: noteId, target: tagId });
    });
  });

  window
    .ForceGraph3D()(container)
    .graphData({ nodes, links })
    .nodeLabel("name")
    .nodeColor("color")
    .nodeVal("val")
    .backgroundColor("#020204")
    .linkColor(() => "rgba(255,255,255,0.18)");
}

function closeBrainMap() {
  document.getElementById("brainMapModal")?.classList.remove("active");
}

/* ─────────────────────────────────────────────────────────────
   Окно медиа
───────────────────────────────────────────────────────────── */
function openModal(file) {
  const modal = document.getElementById("mediaModal");
  const content = document.getElementById("modalContent");
  const url = safeUrl(file.url);

  if (!modal || !content || !url) return;

  content.innerHTML = "";

  if (file.type === "video") {
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    content.appendChild(video);
  } else {
    const image = document.createElement("img");
    image.src = url;
    image.alt = file.title || "Изображение";
    content.appendChild(image);
  }

  modal.classList.add("active");
}

function closeModal() {
  const modal = document.getElementById("mediaModal");
  const content = document.getElementById("modalContent");

  modal?.classList.remove("active");

  if (content) content.innerHTML = "";
}

/* ─────────────────────────────────────────────────────────────
   Экспорт и импорт
───────────────────────────────────────────────────────────── */
function exportData() {
  const data = JSON.stringify(localDB, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `infinity-backup-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
  showToast("Резервная копия скачана");
}

function importData(event) {
  const file = event.target.files?.[0];

  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const imported = JSON.parse(String(reader.result));

      if (!imported || typeof imported !== "object") {
        throw new Error("Некорректный файл");
      }

      localDB = {
        ...structuredClone(defaultDatabase),
        ...imported,
        stats: {
          ...structuredClone(defaultDatabase.stats),
          ...(imported.stats || {})
        },
        settings: {
          ...structuredClone(defaultDatabase.settings),
          ...(imported.settings || {})
        }
      };

      localDB.notes = Array.isArray(localDB.notes) ? localDB.notes : [];
      localDB.journal = Array.isArray(localDB.journal)
        ? localDB.journal
        : [];
      localDB.settings.apiKeys ||= {};

      if (
        localDB.settings.togetherApiKey &&
        !localDB.settings.apiKeys.together
      ) {
        localDB.settings.apiKeys.together =
          localDB.settings.togetherApiKey;
      }

      saveLocalDB();
      loadSettingsUI();
      renderJournalFeed();
      renderFilesView();

      showToast("Данные успешно восстановлены");
    } catch (error) {
      console.error("Ошибка импорта:", error);
      showToast("Не удалось импортировать этот JSON-файл");
    }
  };

  reader.onerror = () => showToast("Не удалось прочитать файл");

  reader.readAsText(file);
  event.target.value = "";
}

/* ─────────────────────────────────────────────────────────────
   Навигация и уведомления
───────────────────────────────────────────────────────────── */
function switchTab(tabId, navButton) {
  const nextTab = document.getElementById(`tab-${tabId}`);

  if (!nextTab) return;

  document
    .querySelectorAll(".tab-content")
    .forEach((tab) => tab.classList.remove("active"));

  nextTab.classList.add("active");

  document
    .querySelectorAll(".nav-item")
    .forEach((button) => button.classList.remove("active"));

  navButton?.classList.add("active");

  window.scrollTo({ top: 0, behavior: "smooth" });
  haptic();
}

function showToast(message) {
  const box = document.getElementById("toast-box");
  if (!box) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;

  box.appendChild(toast);

  window.setTimeout(() => toast.remove(), 3000);
}

/* ─────────────────────────────────────────────────────────────
   Запуск
───────────────────────────────────────────────────────────── */
async function initApp() {
  const name = telegramUser?.first_name || "Пользователь";
  const avatar = document.getElementById("userAvatar");
  const userName = document.getElementById("userName");

  if (userName) userName.textContent = name;
  if (avatar) avatar.textContent = name.charAt(0).toUpperCase();

  document
    .getElementById("aiProvider")
    ?.addEventListener("change", onProviderChange);

  document.getElementById("aiModel")?.addEventListener("change", () => {
    localDB.settings.aiModel = document.getElementById("aiModel").value;
  });

  document
    .getElementById("saveSettingsBtn")
    ?.addEventListener("click", saveSettings);

  document
    .getElementById("toggleApiKey")
    ?.addEventListener("click", toggleApiKeyVisibility);

  loadSettingsUI();
  updateStreak();
  setMood(currentMood);
  renderJournalFeed();

  await fetchServerFiles();

  renderFilesView();
  updateStatsUI();
  updateStorageUI();

  window.setTimeout(() => {
    document.getElementById("app-loader")?.classList.add("hidden");
  }, 350);
}

document.addEventListener("DOMContentLoaded", initApp);
