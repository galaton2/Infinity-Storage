"use strict";

/* ───────── Telegram ───────── */
const tg = window.Telegram?.WebApp || null;

try {
  tg?.ready?.();
  tg?.expand?.();
  tg?.setHeaderColor?.("#020204");
  tg?.setBackgroundColor?.("#020204");
} catch (_) {}

const telegramUser = tg?.initDataUnsafe?.user || null;

function haptic(kind = "selection") {
  try {
    if (kind === "impact") tg?.HapticFeedback?.impactOccurred?.("medium");
    else tg?.HapticFeedback?.selectionChanged?.();
  } catch (_) {}
}

/* ───────── Настройки ИИ ───────── */
const API_URL = "https://galaxylab.i234.me:8443/api/files";

const AI_PROVIDERS = {
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
      ["gpt-4.1-mini", "GPT-4.1 mini"],
      ["gpt-4o", "GPT-4o"]
    ]
  },
  anthropic: {
    title: "Anthropic",
    models: [
      ["claude-3-5-haiku-latest", "Claude 3.5 Haiku"],
      ["claude-3-5-sonnet-latest", "Claude 3.5 Sonnet"]
    ]
  },
  google: {
    title: "Google Gemini",
    models: [
      ["gemini-2.0-flash", "Gemini 2.0 Flash"],
      ["gemini-1.5-flash", "Gemini 1.5 Flash"],
      ["gemini-1.5-pro", "Gemini 1.5 Pro"]
    ]
  }
};

/* ───────── Данные ───────── */
const defaultDB = {
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadDB() {
  try {
    const saved = JSON.parse(localStorage.getItem("infinityLocalDB"));

    if (!saved || typeof saved !== "object") return clone(defaultDB);

    const db = {
      ...clone(defaultDB),
      ...saved,
      stats: { ...clone(defaultDB.stats), ...(saved.stats || {}) },
      settings: { ...clone(defaultDB.settings), ...(saved.settings || {}) }
    };

    db.notes = Array.isArray(db.notes) ? db.notes : [];
    db.journal = Array.isArray(db.journal) ? db.journal : [];
    db.settings.apiKeys ||= {};

    /* Совместимость со старым ключом Together AI */
    if (db.settings.togetherApiKey && !db.settings.apiKeys.together) {
      db.settings.apiKeys.together = db.settings.togetherApiKey;
    }

    return db;
  } catch (_) {
    return clone(defaultDB);
  }
}

let localDB = loadDB();
let globalFiles = [];
let activeFolder = null;
let searchQuery = "";
let currentMood = "😐";

const folders = [
  {
    id: "smart_notes",
    name: "Smart Notes",
    emoji: "🧠",
    bg: "rgba(255,152,0,.1)",
    autoTypes: ["smart_note"]
  },
  {
    id: "texts",
    name: "Texts",
    emoji: "📝",
    bg: "rgba(160,120,255,.1)",
    autoTypes: ["text"]
  },
  {
    id: "documents",
    name: "Documents",
    emoji: "📄",
    bg: "rgba(91,140,255,.1)",
    autoTypes: ["document", "audio", "voice"]
  },
  {
    id: "media",
    name: "Media",
    emoji: "🖼️",
    bg: "rgba(0,217,138,.1)",
    autoTypes: ["photo", "video", "animation", "video_note"]
  }
];

function saveDB() {
  localStorage.setItem("infinityLocalDB", JSON.stringify(localDB));
  updateStatsUI();
  updateStorageUI();
}

function esc(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function words(text = "") {
  return cleanText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

function safeUrl(value) {
  try {
    const url = new URL(value, window.location.href);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch (_) {
    return "";
  }
}

function allItems() {
  const notes = localDB.notes.map((note) => ({
    internalId: `note_${note.id}`,
    id: note.id,
    type: "smart_note",
    title: note.title || "Заметка",
    text: note.text || "",
    tags: Array.isArray(note.tags) ? note.tags : [],
    date: note.date || new Date().toISOString(),
    size: new Blob([note.text || ""]).size
  }));

  return [...globalFiles, ...notes];
}

function getProvider() {
  return AI_PROVIDERS[localDB.settings.aiProvider]
    ? localDB.settings.aiProvider
    : "together";
}

function getModel() {
  const provider = getProvider();
  const models = AI_PROVIDERS[provider].models;
  const saved = localDB.settings.aiModel;

  return models.some(([id]) => id === saved) ? saved : models[0][0];
}

function getKey() {
  const provider = getProvider();

  return (
    localDB.settings.apiKeys?.[provider] ||
    (provider === "together" ? localDB.settings.togetherApiKey : "") ||
    ""
  ).trim();
}

/* ───────── UI настроек ───────── */
function renderModels(provider, selected = "") {
  const select = document.getElementById("aiModel");
  const models = AI_PROVIDERS[provider]?.models || [];

  select.innerHTML = models
    .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`)
    .join("");

  const valid = models.some(([value]) => value === selected)
    ? selected
    : models[0]?.[0] || "";

  select.value = valid;
  return valid;
}

function loadSettingsUI() {
  const provider = getProvider();
  const providerSelect = document.getElementById("aiProvider");
  const keyInput = document.getElementById("togetherApiKey");

  providerSelect.value = provider;
  localDB.settings.aiModel = renderModels(provider, localDB.settings.aiModel);
  keyInput.value = localDB.settings.apiKeys?.[provider] || "";
}

function changeProvider() {
  const previousProvider = getProvider();
  const nextProvider = document.getElementById("aiProvider").value;
  const keyInput = document.getElementById("togetherApiKey");

  localDB.settings.apiKeys ||= {};
  localDB.settings.apiKeys[previousProvider] = keyInput.value.trim();
  localDB.settings.aiProvider = nextProvider;
  localDB.settings.aiModel = renderModels(nextProvider, "");

  keyInput.value = localDB.settings.apiKeys[nextProvider] || "";
}

function saveSettings() {
  const provider = document.getElementById("aiProvider").value;
  const model = document.getElementById("aiModel").value;
  const key = document.getElementById("togetherApiKey").value.trim();

  localDB.settings.apiKeys ||= {};
  localDB.settings.aiProvider = provider;
  localDB.settings.aiModel = model;
  localDB.settings.apiKeys[provider] = key;
  localDB.settings.togetherApiKey = localDB.settings.apiKeys.together || "";

  saveDB();
  showToast("Настройки ИИ сохранены");
}

function toggleApiKeyVisibility() {
  const input = document.getElementById("togetherApiKey");
  input.type = input.type === "password" ? "text" : "password";
}

/* ───────── API ИИ ───────── */
async function apiError(response) {
  try {
    const data = await response.json();
    return data?.error?.message || data?.message || `Ошибка ${response.status}`;
  } catch (_) {
    return `Ошибка ${response.status}`;
  }
}

async function callAI(system, prompt) {
  const provider = getProvider();
  const model = getModel();
  const key = getKey();

  if (!key) {
    showToast(`Введите API-ключ ${AI_PROVIDERS[provider].title}`);
    return null;
  }

  try {
    let response;
    let answer = "";

    if (provider === "together" || provider === "openai") {
      const endpoint =
        provider === "together"
          ? "https://api.together.xyz/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions";

      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          temperature: 0.35,
          max_tokens: 900,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt }
          ]
        })
      });

      if (!response.ok) throw new Error(await apiError(response));

      const data = await response.json();
      answer = data?.choices?.[0]?.message?.content || "";
    }

    if (provider === "anthropic") {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          max_tokens: 900,
          system,
          messages: [{ role: "user", content: prompt }]
        })
      });

      if (!response.ok) throw new Error(await apiError(response));

      const data = await response.json();
      answer = data?.content?.[0]?.text || "";
    }

    if (provider === "google") {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.35,
              maxOutputTokens: 900
            }
          })
        }
      );

      if (!response.ok) throw new Error(await apiError(response));

      const data = await response.json();
      answer = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    if (!answer.trim()) throw new Error("Пустой ответ от модели");

    return answer.trim();
  } catch (error) {
    console.error("AI error:", error);
    const message = error instanceof Error ? error.message : "";

    if (/401|403|key|auth|unauthorized/i.test(message)) {
      showToast("Проверьте API-ключ и доступ к этой модели");
    } else {
      showToast("ИИ сейчас недоступен. Попробуйте ещё раз");
    }

    return null;
  }
}

/* ───────── Статистика ───────── */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function updateStatsUI() {
  document.getElementById("streakCounter").textContent =
    `🔥 ${localDB.stats.streak || 0}`;

  document.getElementById("wordsCount").textContent =
    localDB.stats.wordsWritten || 0;

  document.getElementById("totalFilesCount").textContent = allItems().length;
}

function updateStorageUI() {
  const serverSize = globalFiles.reduce(
    (total, file) => total + Number(file.size || file.file_size || 0),
    0
  );

  const notesSize = localDB.notes.reduce(
    (total, note) => total + new Blob([note.text || ""]).size,
    0
  );

  const size = serverSize + notesSize;
  document.getElementById("dataUsedText").textContent = formatBytes(size);

  const percent = Math.min(size / (100 * 1024 * 1024) * 100, 100);
  document.getElementById("dataUsedFill").style.width = `${percent}%`;
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
  saveDB();
}

/* ───────── Загрузка серверных файлов ───────── */
async function fetchServerFiles() {
  const userId = telegramUser?.id || "browser-user";

  try {
    const response = await fetch(
      `${API_URL}?user_id=${encodeURIComponent(userId)}&limit=100`
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    globalFiles = (Array.isArray(data?.files) ? data.files : []).map(
      (file, index) => ({
        ...file,
        internalId: `server_${file.id || index}`,
        type: file.type || file.file_type || "document",
        title: file.title || file.name || file.file_name || "Файл",
        text: file.text || file.caption || "",
        url: file.url || file.file_url || "",
        size: Number(file.size || file.file_size || 0)
      })
    );
  } catch (error) {
    console.warn("Файлы сервера не загружены:", error);
    globalFiles = [];
  }

  updateStatsUI();
  updateStorageUI();
}

/* ───────── Умные заметки ───────── */
function parseNoteAnalysis(answer) {
  try {
    const json = answer.match(/\{[\s\S]*\}/)?.[0];
    const data = JSON.parse(json);

    return {
      title: String(data.title || "Заметка").slice(0, 90),
      tags: Array.isArray(data.tags)
        ? data.tags
            .map((tag) => String(tag).trim().replace(/^#/, ""))
            .filter(Boolean)
            .slice(0, 6)
        : []
    };
  } catch (_) {
    return { title: "Заметка", tags: [] };
  }
}

async function saveSmartNote() {
  const input = document.getElementById("smartNoteInput");
  const text = input.value.trim();

  if (!text) {
    input.focus();
    showToast("Напишите заметку");
    return;
  }

  haptic("impact");
  input.value = "";

  let data = {
    title: text.slice(0, 55),
    tags: []
  };

  if (getKey()) {
    showToast("ИИ анализирует заметку…");

    const answer = await callAI(
      "Верни только валидный JSON без Markdown: {\"title\":\"краткий заголовок\",\"tags\":[\"тег1\",\"тег2\"]}. Не более 6 тегов. Язык ответа — русский.",
      text
    );

    if (answer) data = parseNoteAnalysis(answer);
  }

  localDB.notes.unshift({
    id: Date.now(),
    title: data.title,
    text,
    tags: data.tags,
    date: new Date().toISOString()
  });

  localDB.stats.wordsWritten += words(text).length;

  saveDB();
  renderFilesView();
  showToast("Заметка сохранена");
}

/* ───────── Дневник ───────── */
function setMood(mood) {
  currentMood = mood;

  const labels = {
    "😢": "Грустно",
    "😐": "Нейтрально",
    "😊": "Хорошо",
    "🤩": "Отлично"
  };

  document.querySelectorAll(".journal-mood-selector button").forEach((button) => {
    button.classList.toggle(
      "selected",
      button.getAttribute("aria-label") === labels[mood]
    );
  });

  haptic();
}

function renderJournalFeed() {
  const feed = document.getElementById("journalFeed");

  if (!localDB.journal.length) {
    feed.innerHTML =
      '<div class="journal-entry" style="text-align:center;color:var(--text-muted)">Записей пока нет.</div>';
    return;
  }

  feed.innerHTML = localDB.journal
    .map((entry) => {
      const date = new Date(entry.date);

      return `
        <article class="journal-entry">
          <div class="journal-entry-header">
            <span>${esc(date.toLocaleDateString("ru-RU"))} · ${esc(
              date.toLocaleTimeString("ru-RU", {
                hour: "2-digit",
                minute: "2-digit"
              })
            )}</span>
            <span>${esc(entry.mood || "😐")}</span>
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
    input.focus();
    showToast("Введите запись для дневника");
    return;
  }

  input.value = "";
  haptic("impact");

  let aiComment = "Запись сохранена. Вернитесь к ней позже и посмотрите на мысли со стороны.";

  if (getKey()) {
    showToast("ИИ готовит рефлексию…");

    const answer = await callAI(
      "Ты бережный помощник по рефлексии. Дай короткий поддерживающий комментарий: максимум 2 предложения. Не ставь диагнозов и не используй медицинские утверждения.",
      `Настроение: ${currentMood}\n\nЗапись пользователя:\n${text}`
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

  localDB.stats.wordsWritten += words(text).length;

  saveDB();
  renderJournalFeed();
  showToast("Запись сохранена");
}

/* ───────── Умный RAG-чат ───────── */
function noteRelevance(note, questionWords) {
  const noteWords = words(
    `${note.title || ""} ${note.text || ""} ${(note.tags || []).join(" ")}`
  );

  const uniqueNoteWords = new Set(noteWords);
  let score = 0;

  questionWords.forEach((word) => {
    if (uniqueNoteWords.has(word)) score += 3;
    if ((note.tags || []).some((tag) => tag.toLowerCase() === word)) score += 5;
  });

  const ageDays = Math.max(
    0,
    (Date.now() - new Date(note.date || Date.now()).getTime()) / 86400000
  );

  score += Math.max(0, 0.8 - ageDays / 1000);
  return score;
}

function findRelevantNotes(question) {
  const questionWords = words(question);

  return localDB.notes
    .map((note) => ({
      ...note,
      relevance: noteRelevance(note, questionWords)
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 6);
}

function buildChatContext(notes) {
  return notes
    .map(
      (note, index) =>
        `[${index + 1}] ЗАГОЛОВОК: ${note.title || "Без названия"}\nТЕГИ: ${(note.tags || []).join(", ") || "нет"}\nТЕКСТ: ${(note.text || "").slice(0, 2500)}`
    )
    .join("\n\n---\n\n")
    .slice(0, 14500);
}

function appendChatMessage(text, sender, sources = [], id = "") {
  const container = document.getElementById("chatContainer");
  const message = document.createElement("div");

  message.className = `chat-msg ${sender}`;
  if (id) message.id = id;

  const body = document.createElement("div");
  body.textContent = text;
  message.appendChild(body);

  if (sources.length) {
    const sourceWrap = document.createElement("div");
    sourceWrap.className = "chat-sources";

    const title = document.createElement("div");
    title.className = "chat-sources-title";
    title.textContent = "Источники:";
    sourceWrap.appendChild(title);

    sources.forEach((note) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-source";
      button.textContent = note.title || "Заметка";

      button.addEventListener("click", () => openNoteDetails(note));
      sourceWrap.appendChild(button);
    });

    message.appendChild(sourceWrap);
  }

  container.appendChild(message);
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const question = input.value.trim();

  if (!question) return;

  input.value = "";
  appendChatMessage(question, "user");

  if (!getKey()) {
    appendChatMessage(
      "Сначала выберите ИИ и добавьте API-ключ в разделе «Профиль».",
      "ai"
    );
    return;
  }

  const relevantNotes = findRelevantNotes(question);

  if (!relevantNotes.length) {
    appendChatMessage(
      "У вас пока нет заметок. Сначала сохраните несколько мыслей на главной странице.",
      "ai"
    );
    return;
  }

  appendChatMessage("Ищу ответ в ваших заметках…", "ai", [], "chat-thinking");

  const context = buildChatContext(relevantNotes);

  const answer = await callAI(
    `Ты Second Brain пользователя. Отвечай только по заметкам из контекста. Не придумывай факты. Если точного ответа нет, скажи это прямо. Пиши на русском, кратко и понятно. При необходимости ссылайся на номера заметок в формате [1], [2].

КОНТЕКСТ:
${context}`,
    question
  );

  document.getElementById("chat-thinking")?.remove();

  appendChatMessage(
    answer || "Я не смог сформировать ответ. Попробуйте ещё раз.",
    "ai",
    relevantNotes
  );
}

function handleChatKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
  }
}

/* ───────── Карточка полной заметки ───────── */
function openNoteDetails(note) {
  document.getElementById("note-details-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "note-details-overlay";
  overlay.className = "note-details-overlay";

  overlay.innerHTML = `
    <section class="note-details-card" role="dialog" aria-modal="true">
      <button class="note-details-close" type="button" aria-label="Закрыть">×</button>
      <div class="note-details-date">${esc(
        new Date(note.date || Date.now()).toLocaleString("ru-RU", {
          dateStyle: "medium",
          timeStyle: "short"
        })
      )}</div>
      <h2>${esc(note.title || "Заметка")}</h2>
      ${
        note.tags?.length
          ? `<div class="note-details-tags">${note.tags
              .map((tag) => `<span>#${esc(tag)}</span>`)
              .join("")}</div>`
          : ""
      }
      <div class="note-details-text">${esc(note.text || "").replaceAll("\n", "<br>")}</div>
    </section>
  `;

  overlay.addEventListener("click", (event) => {
    if (
      event.target === overlay ||
      event.target.closest(".note-details-close")
    ) {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
}

/* ───────── Нейронная карта ───────── */
function buildBrainLinks(notes) {
  const pairs = new Map();

  for (let i = 0; i < notes.length; i += 1) {
    for (let j = i + 1; j < notes.length; j += 1) {
      const firstTags = new Set(
        (notes[i].tags || []).map((tag) => tag.toLowerCase())
      );

      const commonTags = (notes[j].tags || []).filter((tag) =>
        firstTags.has(tag.toLowerCase())
      );

      if (commonTags.length) {
        pairs.set(`${notes[i].id}|${notes[j].id}`, {
          source: `note_${notes[i].id}`,
          target: `note_${notes[j].id}`,
          strength: commonTags.length,
          tags: commonTags
        });
      }
    }
  }

  const degree = {};
  const links = [];

  [...pairs.values()]
    .sort((a, b) => b.strength - a.strength)
    .forEach((link) => {
      if ((degree[link.source] || 0) >= 3) return;
      if ((degree[link.target] || 0) >= 3) return;

      degree[link.source] = (degree[link.source] || 0) + 1;
      degree[link.target] = (degree[link.target] || 0) + 1;
      links.push(link);
    });

  return links;
}

function openBrainMap() {
  const modal = document.getElementById("brainMapModal");
  const container = document.getElementById("3d-graph");

  modal.classList.add("active");
  container.innerHTML = "";

  const notes = localDB.notes;

  if (!notes.length) {
    container.innerHTML =
      '<p class="brain-empty-message">Добавьте несколько заметок, а ИИ создаст для них теги и связи.</p>';
    return;
  }

  if (typeof window.ForceGraph3D !== "function") {
    container.innerHTML =
      '<p class="brain-empty-message">Не удалось загрузить карту мыслей.</p>';
    return;
  }

  const nodes = notes.map((note) => ({
    id: `note_${note.id}`,
    note,
    name: note.title || "Заметка",
    color: "#5b8cff",
    val: 3 + Math.min((note.tags || []).length, 5),
    description: cleanText(note.text).slice(0, 180),
    tags: note.tags || []
  }));

  const links = buildBrainLinks(notes);

  const graph = window
    .ForceGraph3D()(container)
    .graphData({ nodes, links })
    .backgroundColor("#020204")
    .nodeColor("color")
    .nodeVal("val")
    .nodeOpacity(0.95)
    .nodeLabel(
      (node) => `
        <div style="max-width:260px;padding:8px 10px;font-family:Arial,sans-serif;">
          <strong>${esc(node.name)}</strong>
          <div style="margin-top:5px;color:#b6b6c7;font-size:12px;">${esc(node.description)}</div>
          ${
            node.tags.length
              ? `<div style="margin-top:7px;color:#76a0ff;font-size:11px;">${node.tags
                  .map((tag) => `#${esc(tag)}`)
                  .join(" ")}</div>`
              : ""
          }
        </div>
      `
    )
    .linkColor((link) =>
      link.strength > 1
        ? "rgba(160,120,255,0.72)"
        : "rgba(91,140,255,0.42)"
    )
    .linkWidth((link) => 0.8 + link.strength * 0.7)
    .linkOpacity(0.65)
    .linkDirectionalParticles((link) => (link.strength > 1 ? 2 : 1))
    .linkDirectionalParticleWidth(1.6)
    .linkDirectionalParticleSpeed(0.004)
    .onNodeClick((node) => {
      openNoteDetails(node.note);
    })
    .onNodeHover((node) => {
      container.style.cursor = node ? "pointer" : "grab";
    });

  graph.d3Force("charge")?.strength(-120);
  graph.d3Force("link")?.distance(95);

  setTimeout(() => graph.zoomToFit(700, 60), 250);
}

function closeBrainMap() {
  document.getElementById("brainMapModal")?.classList.remove("active");
}

/* ───────── Папки ───────── */
function updateTopbar() {
  const bar = document.getElementById("filesTopbar");

  if (activeFolder === null) {
    bar.innerHTML = '<span class="files-topbar-title">Папки</span>';
    return;
  }

  const folder = folders.find((item) => item.id === activeFolder);

  bar.innerHTML = `
    <button class="icon-btn" type="button" onclick="closeFolder()" aria-label="Назад">
      <svg class="svg-icon" viewBox="0 0 24 24">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </button>
    <span class="files-topbar-title">${esc(folder?.name || "Папка")}</span>
  `;
}

function renderFolderGrid() {
  const grid = document.getElementById("folderGrid");
  const items = allItems();

  grid.innerHTML = folders
    .map((folder) => {
      const count = items.filter((item) =>
        folder.autoTypes.includes(item.type)
      ).length;

      return `
        <button class="folder-card" type="button" onclick="openFolder('${folder.id}')">
          <span class="folder-card-icon" style="background:${folder.bg}">${folder.emoji}</span>
          <span class="folder-card-name">${esc(folder.name)}</span>
          <span class="folder-card-count">${count} шт.</span>
        </button>
      `;
    })
    .join("");
}

function renderFolderContents() {
  const gallery = document.getElementById("folderGallery");
  const folder = folders.find((item) => item.id === activeFolder);

  if (!folder) return;

  const query = searchQuery.toLowerCase();

  const files = allItems().filter((file) => {
    if (!folder.autoTypes.includes(file.type)) return false;

    return !query || cleanText(
      `${file.title || ""} ${file.text || ""} ${(file.tags || []).join(" ")}`
    )
      .toLowerCase()
      .includes(query);
  });

  if (!files.length) {
    gallery.innerHTML =
      '<div class="empty-files">Здесь пока ничего нет.</div>';
    return;
  }

  gallery.innerHTML = "";

  files.forEach((file) => {
    const card = document.createElement("div");
    card.className = `grid-item ${file.type}`;

    if (file.type === "smart_note") {
      card.innerHTML = `
        <div class="text-card-body">
          <strong>${esc(file.title)}</strong>
          <br><br>
          ${esc(file.text)}
        </div>
      `;

      card.addEventListener("click", () => openNoteDetails(file));
    } else if (file.type === "photo" && safeUrl(file.url)) {
      const image = document.createElement("img");
      image.src = safeUrl(file.url);
      image.loading = "lazy";
      image.alt = file.title || "Фото";
      card.appendChild(image);
      card.addEventListener("click", () => openModal(file));
    } else {
      card.innerHTML = `
        <div class="text-card-body file-card-label">${esc(
          file.title || file.type || "Файл"
        )}</div>
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

function openFolder(id) {
  activeFolder = id;
  searchQuery = "";
  document.getElementById("searchInput").value = "";
  renderFilesView();
  haptic();
}

function closeFolder() {
  activeFolder = null;
  searchQuery = "";
  document.getElementById("searchInput").value = "";
  renderFilesView();
  haptic();
}

function handleSearch() {
  searchQuery = document.getElementById("searchInput").value || "";
  if (activeFolder !== null) renderFolderContents();
}

/* ───────── Медиа ───────── */
function openModal(file) {
  const modal = document.getElementById("mediaModal");
  const content = document.getElementById("modalContent");
  const url = safeUrl(file.url);

  if (!url) return;

  content.innerHTML = "";

  const image = document.createElement("img");
  image.src = url;
  image.alt = file.title || "Изображение";
  content.appendChild(image);

  modal.classList.add("active");
}

function closeModal() {
  document.getElementById("mediaModal")?.classList.remove("active");
  document.getElementById("modalContent").innerHTML = "";
}

/* ───────── Импорт и экспорт ───────── */
function exportData() {
  const blob = new Blob([JSON.stringify(localDB, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `infinity-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
  showToast("Бэкап скачан");
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));

      if (!data || typeof data !== "object") {
        throw new Error("Неверный JSON");
      }

      localDB = {
        ...clone(defaultDB),
        ...data,
        stats: { ...clone(defaultDB.stats), ...(data.stats || {}) },
        settings: { ...clone(defaultDB.settings), ...(data.settings || {}) }
      };

      localDB.notes = Array.isArray(localDB.notes) ? localDB.notes : [];
      localDB.journal = Array.isArray(localDB.journal) ? localDB.journal : [];
      localDB.settings.apiKeys ||= {};

      if (
        localDB.settings.togetherApiKey &&
        !localDB.settings.apiKeys.together
      ) {
        localDB.settings.apiKeys.together = localDB.settings.togetherApiKey;
      }

      saveDB();
      loadSettingsUI();
      renderJournalFeed();
      renderFilesView();

      showToast("Данные восстановлены");
    } catch (_) {
      showToast("Не удалось импортировать JSON");
    }
  };

  reader.readAsText(file);
  event.target.value = "";
}

/* ───────── Навигация ───────── */
function switchTab(tabId, button) {
  document.querySelectorAll(".tab-content").forEach((tab) => {
    tab.classList.remove("active");
  });

  document.getElementById(`tab-${tabId}`)?.classList.add("active");

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("active");
  });

  button?.classList.add("active");

  window.scrollTo({ top: 0, behavior: "smooth" });
  haptic();
}

function showToast(text) {
  const box = document.getElementById("toast-box");
  const toast = document.createElement("div");

  toast.className = "toast";
  toast.textContent = text;
  box.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

/* ───────── Запуск ───────── */
async function initApp() {
  const name = telegramUser?.first_name || "Пользователь";

  document.getElementById("userName").textContent = name;
  document.getElementById("userAvatar").textContent = name[0].toUpperCase();

  document
    .getElementById("aiProvider")
    .addEventListener("change", changeProvider);

  document
    .getElementById("saveSettingsBtn")
    .addEventListener("click", saveSettings);

  document
    .getElementById("toggleApiKey")
    .addEventListener("click", toggleApiKeyVisibility);

  document.getElementById("aiModel").addEventListener("change", (event) => {
    localDB.settings.aiModel = event.target.value;
  });

  loadSettingsUI();
  updateStreak();
  setMood(currentMood);
  renderJournalFeed();

  await fetchServerFiles();

  renderFilesView();
  updateStatsUI();
  updateStorageUI();

  setTimeout(() => {
    document.getElementById("app-loader")?.classList.add("hidden");
  }, 350);
}

document.addEventListener("DOMContentLoaded", initApp);
