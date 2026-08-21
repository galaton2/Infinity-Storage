"use strict";

const tg = window.Telegram?.WebApp || null;
try {
  tg?.ready?.();
  tg?.expand?.();
  tg?.setHeaderColor?.("#020204");
  tg?.setBackgroundColor?.("#020204");
} catch (_) {}

const telegramUser = tg?.initDataUnsafe?.user || null;
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
      ["gpt-4.1-mini", "GPT-4.1 mini"]
    ]
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

const defaultDB = {
  notes: [],
  journal: [],
  stats: { streak: 0, lastLogin: null, wordsWritten: 0 },
  settings: {
    aiProvider: "together",
    aiModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    apiKeys: {},
    togetherApiKey: ""
  }
};

const folders = [
  { id: "smart_notes", name: "Smart Notes", emoji: "🧠", bg: "rgba(255,152,0,.1)", autoTypes: ["smart_note"] },
  { id: "texts", name: "Texts", emoji: "📝", bg: "rgba(160,120,255,.1)", autoTypes: ["text"] },
  { id: "documents", name: "Documents", emoji: "📄", bg: "rgba(91,140,255,.1)", autoTypes: ["document", "audio", "voice"] },
  { id: "media", name: "Media", emoji: "🖼️", bg: "rgba(0,217,138,.1)", autoTypes: ["photo", "video", "animation", "video_note"] }
];

let globalFiles = [];
let activeFolder = null;
let searchQuery = "";
let currentMood = "😐";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function splitWords(text = "") {
  return cleanText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

function haptic(type = "selection") {
  try {
    type === "impact"
      ? tg?.HapticFeedback?.impactOccurred?.("medium")
      : tg?.HapticFeedback?.selectionChanged?.();
  } catch (_) {}
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

    if (db.settings.togetherApiKey && !db.settings.apiKeys.together) {
      db.settings.apiKeys.together = db.settings.togetherApiKey;
    }

    return db;
  } catch (_) {
    return clone(defaultDB);
  }
}

let localDB = loadDB();

function saveDB() {
  localStorage.setItem("infinityLocalDB", JSON.stringify(localDB));
  updateStatsUI();
  updateStorageUI();
}

function safeUrl(value) {
  try {
    const url = new URL(value, window.location.href);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch (_) {
    return "";
  }
}

function bytesOf(file) {
  const direct = [
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

  const size = direct.find((item) => Number(item) > 0);
  if (size) return Number(size);

  if (typeof file.base64 === "string") {
    return Math.ceil((file.base64.length * 3) / 4);
  }

  return 0;
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
  const models = AI_PROVIDERS[getProvider()].models;
  return models.some(([model]) => model === localDB.settings.aiModel)
    ? localDB.settings.aiModel
    : models[0][0];
}

function getKey() {
  const provider = getProvider();
  return (
    localDB.settings.apiKeys?.[provider] ||
    (provider === "together" ? localDB.settings.togetherApiKey : "") ||
    ""
  ).trim();
}

/* ───────── Память ───────── */

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
}

function updateStorageUI() {
  const items = allItems();
  const total = items.reduce((sum, item) => sum + bytesOf(item), 0);

  const photos = items.filter((item) =>
    ["photo", "video", "animation", "video_note"].includes(item.type)
  ).length;

  const documents = items.filter((item) =>
    ["document", "audio", "voice"].includes(item.type)
  ).length;

  const notes = items.filter((item) => item.type === "smart_note").length;

  document.getElementById("dataUsedText").textContent =
    `${formatBytes(total)} · ${notes} заметок · ${photos} медиа · ${documents} файлов`;

  /*
    Шкала визуальная: слева 0 Б, справа ∞.
    Она не ограничивает реальную память, но заполняется логарифмически.
  */
  const visualPercent = total
    ? Math.min(8 + Math.log10(total + 1) * 11, 96)
    : 0;

  document.getElementById("dataUsedFill").style.width = `${visualPercent}%`;
  document.getElementById("storageRangeDot").style.left = `${visualPercent}%`;
  document
    .querySelector(".storage-range")
    ?.setAttribute("aria-valuenow", String(Math.round(visualPercent)));
}

function updateStatsUI() {
  document.getElementById("streakCounter").textContent =
    `🔥 ${localDB.stats.streak || 0}`;

  document.getElementById("wordsCount").textContent =
    localDB.stats.wordsWritten || 0;

  document.getElementById("totalFilesCount").textContent = allItems().length;
}

function updateStreak() {
  const today = new Date().toDateString();
  if (localDB.stats.lastLogin === today) return;

  const yesterday = new Date(Date.now() - 86400000).toDateString();

  localDB.stats.streak =
    localDB.stats.lastLogin === yesterday
      ? Number(localDB.stats.streak || 0) + 1
      : 1;

  localDB.stats.lastLogin = today;
  saveDB();
}

/* ───────── Настройки ИИ ───────── */

function renderModels(provider, selected = "") {
  const select = document.getElementById("aiModel");
  const models = AI_PROVIDERS[provider].models;

  select.innerHTML = models
    .map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`)
    .join("");

  const result = models.some(([value]) => value === selected)
    ? selected
    : models[0][0];

  select.value = result;
  return result;
}

function loadSettingsUI() {
  const provider = getProvider();
  document.getElementById("aiProvider").value = provider;
  localDB.settings.aiModel = renderModels(provider, localDB.settings.aiModel);
  document.getElementById("togetherApiKey").value =
    localDB.settings.apiKeys?.[provider] || "";
}

function changeProvider() {
  const oldProvider = getProvider();
  const nextProvider = document.getElementById("aiProvider").value;
  const input = document.getElementById("togetherApiKey");

  localDB.settings.apiKeys ||= {};
  localDB.settings.apiKeys[oldProvider] = input.value.trim();
  localDB.settings.aiProvider = nextProvider;
  localDB.settings.aiModel = renderModels(nextProvider);
  input.value = localDB.settings.apiKeys[nextProvider] || "";
}

function saveSettings() {
  const provider = document.getElementById("aiProvider").value;

  localDB.settings.apiKeys ||= {};
  localDB.settings.aiProvider = provider;
  localDB.settings.aiModel = document.getElementById("aiModel").value;
  localDB.settings.apiKeys[provider] =
    document.getElementById("togetherApiKey").value.trim();

  localDB.settings.togetherApiKey =
    localDB.settings.apiKeys.together || "";

  saveDB();
  showToast("Настройки ИИ сохранены");
}

function toggleApiKeyVisibility() {
  const input = document.getElementById("togetherApiKey");
  input.type = input.type === "password" ? "text" : "password";
}

async function getApiError(response) {
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
    showToast(`Введите ключ ${AI_PROVIDERS[provider].title}`);
    return null;
  }

  try {
    let response;
    let answer = "";

    if (provider === "together" || provider === "openai") {
      response = await fetch(
        provider === "together"
          ? "https://api.together.xyz/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions",
        {
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
        }
      );

      if (!response.ok) throw new Error(await getApiError(response));
      answer = (await response.json())?.choices?.[0]?.message?.content || "";
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

      if (!response.ok) throw new Error(await getApiError(response));
      answer = (await response.json())?.content?.[0]?.text || "";
    }

    if (provider === "google") {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }]
          })
        }
      );

      if (!response.ok) throw new Error(await getApiError(response));
      answer = (await response.json())?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    if (!answer.trim()) throw new Error("Пустой ответ");
    return answer.trim();
  } catch (error) {
    console.error(error);
    showToast("ИИ недоступен. Проверьте ключ или попробуйте позже");
    return null;
  }
}

/* ───────── Заметки ───────── */

function updateNoteCounter() {
  const input = document.getElementById("smartNoteInput");
  const counter = document.getElementById("noteCharCounter");
  counter.textContent = `${input.value.length} / ${input.maxLength}`;
}

function parseNoteAnalysis(text) {
  try {
    const data = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0]);

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
    showToast("Напишите мысль");
    return;
  }

  input.value = "";
  updateNoteCounter();
  haptic("impact");

  let info = { title: text.slice(0, 60), tags: [] };

  if (getKey()) {
    showToast("ИИ обрабатывает мысль…");

    const answer = await callAI(
      "Верни только JSON: {\"title\":\"краткий заголовок\",\"tags\":[\"тег1\",\"тег2\"]}. Максимум 6 тегов. Русский язык.",
      text
    );

    if (answer) info = parseNoteAnalysis(answer);
  }

  localDB.notes.unshift({
    id: Date.now(),
    title: info.title,
    text,
    tags: info.tags,
    date: new Date().toISOString()
  });

  localDB.stats.wordsWritten += splitWords(text).length;
  saveDB();
  renderFilesView();

  showToast("Заметка сохранена");
}

/* ───────── Дневник и календарь ───────── */

function setMood(mood) {
  currentMood = mood;
  const names = {
    "😞": "Грустно",
    "😐": "Спокойно",
    "🙂": "Хорошо",
    "😄": "Отлично"
  };

  document.querySelectorAll(".journal-mood-selector button").forEach((button) => {
    button.classList.toggle("selected", button.getAttribute("aria-label") === names[mood]);
  });

  haptic();
}

/* Дневник сохраняется без автоматического ответа ИИ. */
function saveJournal() {
  const input = document.getElementById("journalInput");
  const text = input.value.trim();

  if (!text) {
    input.focus();
    showToast("Введите запись для дневника");
    return;
  }

  input.value = "";
  localDB.journal.unshift({
    id: Date.now(),
    text,
    mood: currentMood,
    date: new Date().toISOString()
  });

  localDB.stats.wordsWritten += splitWords(text).length;
  saveDB();
  haptic("impact");
  showToast("Запись сохранена");
}

function dateKey(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function openJournalCalendar() {
  document.getElementById("journal-calendar-overlay")?.remove();

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const entryDays = new Set(localDB.journal.map((entry) => dateKey(entry.date)));

  const firstDay = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const start = (firstDay.getDay() + 6) % 7;
  const today = dateKey(now);

  let cells = "";

  for (let blank = 0; blank < start; blank += 1) {
    cells += '<span class="calendar-day calendar-day-empty"></span>';
  }

  for (let day = 1; day <= days; day += 1) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const hasEntry = entryDays.has(key);

    cells += `
      <button
        type="button"
        class="calendar-day ${hasEntry ? "has-entry" : "no-entry"} ${key === today ? "today" : ""}"
        data-date="${key}"
        title="${hasEntry ? "Есть запись" : "Нет записи"}"
      >
        ${day}
      </button>
    `;
  }

  const overlay = document.createElement("div");
  overlay.id = "journal-calendar-overlay";
  overlay.className = "calendar-overlay";

  overlay.innerHTML = `
    <section class="calendar-card" role="dialog" aria-modal="true">
      <button class="calendar-close" type="button" aria-label="Закрыть">×</button>
      <h2>${now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}</h2>
      <p>Зелёный — есть запись · жёлтый — записи нет</p>
      <div class="calendar-weekdays">
        <span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span>
      </div>
      <div class="calendar-grid">${cells}</div>
      <div class="calendar-entry-preview" id="calendarEntryPreview">
        Нажмите на зелёный день, чтобы прочитать запись.
      </div>
    </section>
  `;

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest(".calendar-close")) {
      overlay.remove();
      return;
    }

    const day = event.target.closest(".calendar-day.has-entry");
    if (!day) return;

    const entries = localDB.journal.filter((entry) => dateKey(entry.date) === day.dataset.date);

    document.getElementById("calendarEntryPreview").innerHTML = entries
      .map(
        (entry) => `
          <div class="calendar-preview-entry">
            <span>${esc(entry.mood || "😐")}</span>
            <p>${esc(entry.text)}</p>
          </div>
        `
      )
      .join("");
  });

  document.body.appendChild(overlay);
}

/* ───────── ИИ-чат ───────── */

function scoreNote(note, questionWords) {
  const noteWords = new Set(splitWords(
    `${note.title || ""} ${note.text || ""} ${(note.tags || []).join(" ")}`
  ));

  let score = 0;

  questionWords.forEach((word) => {
    if (noteWords.has(word)) score += 3;
    if ((note.tags || []).some((tag) => tag.toLowerCase() === word)) score += 5;
  });

  return score;
}

function relevantNotes(question) {
  const query = splitWords(question);

  return localDB.notes
    .map((note) => ({ ...note, score: scoreNote(note, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
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
    const sourceBox = document.createElement("div");
    sourceBox.className = "chat-sources";
    sourceBox.innerHTML = '<div class="chat-sources-title">Источники</div>';

    sources.forEach((note) => {
      const button = document.createElement("button");
      button.className = "chat-source";
      button.type = "button";
      button.textContent = note.title || "Заметка";
      button.addEventListener("click", () => openNoteDetails(note));
      sourceBox.appendChild(button);
    });

    message.appendChild(sourceBox);
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
    appendChatMessage("Откройте настройки ИИ в профиле и добавьте API-ключ.", "ai");
    return;
  }

  const notes = relevantNotes(question);
  const today = dateKey(new Date());

  const journals = localDB.journal
    .filter((entry) => dateKey(entry.date) === today)
    .slice(0, 4);

  if (!notes.length && !journals.length) {
    appendChatMessage("Пока не нашёл записей, на которые можно опереться.", "ai");
    return;
  }

  const noteContext = notes
    .map((note, index) => `[${index + 1}] ${note.title}\n${note.text.slice(0, 2200)}`)
    .join("\n\n---\n\n");

  const journalContext = journals
    .map((entry) => `ДНЕВНИК: ${entry.text}`)
    .join("\n\n");

  appendChatMessage("Ищу ответ в ваших записях…", "ai", [], "chat-thinking");

  const answer = await callAI(
    `Ты Second Brain пользователя. Используй только контекст. Не выдумывай факты. Отвечай кратко и по-русски.

ЗАМЕТКИ:
${noteContext}

ДНЕВНИК:
${journalContext}`,
    question
  );

  document.getElementById("chat-thinking")?.remove();
  appendChatMessage(answer || "Не удалось получить ответ.", "ai", notes);
}

function handleChatKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
  }
}

/* ───────── Нейронная карта ───────── */

function openNoteDetails(note) {
  document.getElementById("note-details-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "note-details-overlay";
  overlay.className = "note-details-overlay";

  overlay.innerHTML = `
    <section class="note-details-card" role="dialog" aria-modal="true">
      <button class="note-details-close" type="button" aria-label="Закрыть">×</button>
      <div class="note-details-date">${esc(new Date(note.date || Date.now()).toLocaleString("ru-RU"))}</div>
      <h2>${esc(note.title || "Заметка")}</h2>
      ${
        note.tags?.length
          ? `<div class="note-details-tags">${note.tags.map((tag) => `<span>#${esc(tag)}</span>`).join("")}</div>`
          : ""
      }
      <div class="note-details-text">${esc(note.text || "").replaceAll("\n", "<br>")}</div>
    </section>
  `;

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest(".note-details-close")) {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
}

function buildBrainLinks(notes) {
  const candidateLinks = [];
  const degree = {};

  for (let i = 0; i < notes.length; i += 1) {
    for (let j = i + 1; j < notes.length; j += 1) {
      const tagsA = new Set((notes[i].tags || []).map((tag) => tag.toLowerCase()));
      const common = (notes[j].tags || []).filter((tag) => tagsA.has(tag.toLowerCase()));

      if (common.length) {
        candidateLinks.push({
          source: `note_${notes[i].id}`,
          target: `note_${notes[j].id}`,
          strength: common.length
        });
      }
    }
  }

  return candidateLinks
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

function openBrainMap() {
  const modal = document.getElementById("brainMapModal");
  const container = document.getElementById("3d-graph");

  modal.classList.add("active");
  container.innerHTML = "";

  if (!localDB.notes.length) {
    container.innerHTML = '<p class="brain-empty-message">Добавьте несколько заметок с тегами — и между ними появятся связи.</p>';
    return;
  }

  if (typeof window.ForceGraph3D !== "function") {
    container.innerHTML = '<p class="brain-empty-message">Не удалось загрузить карту нейронов.</p>';
    return;
  }

  const nodes = localDB.notes.map((note) => ({
    id: `note_${note.id}`,
    note,
    name: note.title || "Заметка",
    description: cleanText(note.text).slice(0, 180),
    tags: note.tags || [],
    color: "#5b8cff",
    val: 3 + Math.min((note.tags || []).length, 5)
  }));

  const graph = window
    .ForceGraph3D()(container)
    .graphData({ nodes, links: buildBrainLinks(localDB.notes) })
    .backgroundColor("#020204")
    .nodeColor("color")
    .nodeVal("val")
    .nodeLabel(
      (node) => `
        <div style="max-width:260px;padding:8px 10px">
          <b>${esc(node.name)}</b>
          <div style="margin-top:5px;color:#c7c7d5;font-size:12px">${esc(node.description)}</div>
          <div style="margin-top:7px;color:#8eafff;font-size:11px">${node.tags.map((tag) => `#${esc(tag)}`).join(" ")}</div>
        </div>
      `
    )
    .linkColor((link) => link.strength > 1 ? "rgba(160,120,255,.72)" : "rgba(91,140,255,.42)")
    .linkWidth((link) => 0.8 + link.strength * 0.7)
    .linkDirectionalParticles((link) => link.strength > 1 ? 2 : 1)
    .linkDirectionalParticleWidth(1.5)
    .linkDirectionalParticleSpeed(0.004)
    .onNodeClick((node) => openNoteDetails(node.note))
    .onNodeHover((node) => {
      container.style.cursor = node ? "pointer" : "grab";
    });

  graph.d3Force("charge")?.strength(-120);
  graph.d3Force("link")?.distance(95);

  setTimeout(() => graph.zoomToFit(700, 65), 200);
}

function closeBrainMap() {
  document.getElementById("brainMapModal")?.classList.remove("active");
}

/* ───────── Файлы ───────── */

async function fetchServerFiles() {
  try {
    const userId = telegramUser?.id || "browser-user";
    const response = await fetch(`${API_URL}?user_id=${encodeURIComponent(userId)}&limit=100`);

    if (!response.ok) throw new Error();

    const data = await response.json();

    globalFiles = (Array.isArray(data?.files) ? data.files : []).map((file, index) => ({
      ...file,
      internalId: `server_${file.id || index}`,
      type: file.type || file.file_type || "document",
      title: file.title || file.name || file.file_name || "Файл",
      text: file.text || file.caption || "",
      url: file.url || file.file_url || "",
      size: bytesOf(file)
    }));
  } catch (_) {
    globalFiles = [];
  }

  updateStatsUI();
  updateStorageUI();
}

function updateTopbar() {
  const bar = document.getElementById("filesTopbar");

  if (!activeFolder) {
    bar.innerHTML = '<span class="files-topbar-title">Папки</span>';
    return;
  }

  const folder = folders.find((item) => item.id === activeFolder);

  bar.innerHTML = `
    <button class="icon-btn" type="button" onclick="closeFolder()" aria-label="Назад">
      <svg class="svg-icon" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"></polyline></svg>
    </button>
    <span class="files-topbar-title">${esc(folder?.name || "Папка")}</span>
  `;
}

function renderFolderGrid() {
  const items = allItems();

  document.getElementById("folderGrid").innerHTML = folders.map((folder) => {
    const count = items.filter((item) => folder.autoTypes.includes(item.type)).length;

    return `
      <button class="folder-card" type="button" onclick="openFolder('${folder.id}')">
        <span class="folder-card-icon" style="background:${folder.bg}">${folder.emoji}</span>
        <span class="folder-card-name">${esc(folder.name)}</span>
        <span class="folder-card-count">${count} шт.</span>
      </button>
    `;
  }).join("");
}

function renderFolderContents() {
  const folder = folders.find((item) => item.id === activeFolder);
  const gallery = document.getElementById("folderGallery");
  const query = searchQuery.toLowerCase();

  const files = allItems().filter((file) => {
    if (!folder?.autoTypes.includes(file.type)) return false;

    return !query || cleanText(`${file.title} ${file.text} ${(file.tags || []).join(" ")}`)
      .toLowerCase()
      .includes(query);
  });

  if (!files.length) {
    gallery.innerHTML = '<div class="empty-files">Здесь пока ничего нет.</div>';
    return;
  }

  gallery.innerHTML = "";

  files.forEach((file) => {
    const card = document.createElement("div");
    card.className = `grid-item ${file.type}`;

    if (file.type === "smart_note") {
      card.innerHTML = `<div class="text-card-body"><strong>${esc(file.title)}</strong><br><br>${esc(file.text)}</div>`;
      card.addEventListener("click", () => openNoteDetails(file));
    } else if (file.type === "photo" && safeUrl(file.url)) {
      const image = document.createElement("img");
      image.src = safeUrl(file.url);
      image.loading = "lazy";
      image.alt = file.title;
      card.appendChild(image);
      card.addEventListener("click", () => openModal(file));
    } else {
      card.innerHTML = `<div class="text-card-body file-card-label">${esc(file.title || file.type)}</div>`;
    }

    gallery.appendChild(card);
  });
}

function renderFilesView() {
  const grid = document.getElementById("folderGridView");
  const contents = document.getElementById("folderContentsView");

  updateTopbar();

  if (!activeFolder) {
    grid.hidden = false;
    contents.hidden = true;
    renderFolderGrid();
  } else {
    grid.hidden = true;
    contents.hidden = false;
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
  if (activeFolder) renderFolderContents();
}

function openModal(file) {
  const url = safeUrl(file.url);
  if (!url) return;

  const content = document.getElementById("modalContent");
  content.innerHTML = "";

  const image = document.createElement("img");
  image.src = url;
  image.alt = file.title || "Файл";
  content.appendChild(image);

  document.getElementById("mediaModal").classList.add("active");
}

function closeModal() {
  document.getElementById("mediaModal")?.classList.remove("active");
  document.getElementById("modalContent").innerHTML = "";
}

/* ───────── Профиль ───────── */

function renderActivityChart() {
  const chart = document.getElementById("activityChart");
  const total = document.getElementById("activityTotal");
  const now = new Date();
  const days = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(now);
    day.setDate(now.getDate() - offset);

    const key = dateKey(day);
    const count =
      localDB.notes.filter((note) => dateKey(note.date) === key).length +
      localDB.journal.filter((entry) => dateKey(entry.date) === key).length;

    days.push({
      label: day.toLocaleDateString("ru-RU", { weekday: "short" }).slice(0, 2),
      count
    });
  }

  const max = Math.max(1, ...days.map((day) => day.count));
  total.textContent = days.reduce((sum, day) => sum + day.count, 0);

  chart.innerHTML = days
    .map(
      (day) => `
        <div class="activity-bar-wrap">
          <span class="activity-value">${day.count || ""}</span>
          <div class="activity-bar" style="height:${Math.max(8, day.count / max * 100)}%"></div>
          <span class="activity-label">${esc(day.label)}</span>
        </div>
      `
    )
    .join("");
}

async function generateDailyInsight() {
  const area = document.getElementById("dailyInsightContent");
  const today = dateKey(new Date());

  const notes = localDB.notes.filter((note) => dateKey(note.date) === today);
  const journal = localDB.journal.filter((entry) => dateKey(entry.date) === today);

  if (!notes.length && !journal.length) {
    area.textContent = "Сегодня ещё нет заметок или записей дневника.";
    return;
  }

  if (!getKey()) {
    area.textContent = "Откройте настройки ИИ и добавьте API-ключ.";
    return;
  }

  area.textContent = "ИИ анализирует сегодняшние записи…";

  const context = [
    ...notes.map((note) => `ЗАМЕТКА: ${note.title}\n${note.text}`),
    ...journal.map((entry) => `ДНЕВНИК (${entry.mood}): ${entry.text}`)
  ].join("\n\n---\n\n");

  const answer = await callAI(
    "Ты внимательный помощник. По сегодняшним заметкам пользователя сформируй очень краткий портрет дня: что он, вероятно, чувствует, о чём думает и что ему может быть полезно сделать. Не ставь диагнозов, не говори категорично. До 5 предложений, на русском.",
    context.slice(0, 12000)
  );

  area.textContent = answer || "Не удалось создать портрет дня.";
}

/* ───────── Данные и навигация ───────── */

function exportData() {
  const blob = new Blob([JSON.stringify(localDB, null, 2)], { type: "application/json" });
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

      localDB = {
        ...clone(defaultDB),
        ...data,
        stats: { ...clone(defaultDB.stats), ...(data.stats || {}) },
        settings: { ...clone(defaultDB.settings), ...(data.settings || {}) }
      };

      localDB.notes = Array.isArray(localDB.notes) ? localDB.notes : [];
      localDB.journal = Array.isArray(localDB.journal) ? localDB.journal : [];
      localDB.settings.apiKeys ||= {};

      if (localDB.settings.togetherApiKey && !localDB.settings.apiKeys.together) {
        localDB.settings.apiKeys.together = localDB.settings.togetherApiKey;
      }

      saveDB();
      loadSettingsUI();
      renderFilesView();
      renderActivityChart();
      showToast("Данные восстановлены");
    } catch (_) {
      showToast("Не удалось импортировать JSON");
    }
  };

  reader.readAsText(file);
  event.target.value = "";
}

function switchTab(tabId, button) {
  document.querySelectorAll(".tab-content").forEach((tab) => tab.classList.remove("active"));
  document.getElementById(`tab-${tabId}`)?.classList.add("active");

  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  button?.classList.add("active");

  if (tabId === "profile") renderActivityChart();

  window.scrollTo({ top: 0, behavior: "smooth" });
  haptic();
}

function showToast(text) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = text;

  document.getElementById("toast-box").appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/* ───────── Старт ───────── */

async function initApp() {
  const userName = telegramUser?.first_name || "Пользователь";

  document.getElementById("userName").textContent = userName;
  document.getElementById("userAvatar").textContent = userName[0].toUpperCase();

  document.getElementById("smartNoteInput").addEventListener("input", updateNoteCounter);
  document.getElementById("aiProvider").addEventListener("change", changeProvider);
  document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
  document.getElementById("toggleApiKey").addEventListener("click", toggleApiKeyVisibility);

  document.getElementById("toggleAISettings").addEventListener("click", () => {
    const panel = document.getElementById("aiSettingsPanel");
    const button = document.getElementById("toggleAISettings");
    panel.hidden = !panel.hidden;
    button.setAttribute("aria-expanded", String(!panel.hidden));
    button.classList.toggle("open", !panel.hidden);
  });

  loadSettingsUI();
  updateNoteCounter();
  updateStreak();
  setMood(currentMood);

  await fetchServerFiles();

  renderFilesView();
  renderActivityChart();
  updateStatsUI();
  updateStorageUI();

  setTimeout(() => {
    document.getElementById("app-loader")?.classList.add("hidden");
  }, 350);
}

document.addEventListener("DOMContentLoaded", initApp);
