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
  {
    id: "smart_notes",
    name: "Notes",
    types: ["smart_note"],
    color: "blue",
    svg: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2.3h6c0-1.1.4-1.8 1-2.3A7 7 0 0 0 12 2z"></path></svg>'
  },
  {
    id: "telegram_texts",
    name: "Telegram Texts",
    types: ["text"],
    color: "purple",
    svg: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>'
  },
  {
    id: "documents",
    name: "Documents",
    types: ["document", "audio", "voice"],
    color: "green",
    svg: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line><line x1="8" y1="9" x2="10" y2="9"></line></svg>'
  },
  {
    id: "media",
    name: "Media",
    types: ["photo", "video", "animation", "video_note"],
    color: "yellow",
    svg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>'
  }
];

const MOOD_ICONS = {
  sad: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M8.5 16c1-1.5 2.1-2.2 3.5-2.2S14.5 14.5 15.5 16"></path><path d="M8 9h.01M16 9h.01"></path></svg>',
  calm: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M8 14h8M8 9h.01M16 9h.01"></path></svg>',
  good: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M8 13c1.2 1.7 2.5 2.5 4 2.5s2.8-.8 4-2.5M8 9h.01M16 9h.01"></path></svg>',
  great: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M7.5 12.5c1.4 2.3 2.9 3.3 4.5 3.3s3.1-1 4.5-3.3M8 9h.01M16 9h.01"></path></svg>'
};

let db = loadDB();
let files = [];
let activeFolder = null;
let searchQuery = "";
let mood = "calm";
let insightPeriod = "day";
let brainGraph = null;

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
      title: note.title || "Note",
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
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(2)} GB`;
}

/* Storage now adds up notes, documents, photos, videos and audio. */
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

function showStreakInfo() {
  const streak = Number(db.stats.streak || 0);
  const label = streak === 1 ? "day" : "days";

  toast(streak > 0 ? `🔥 Your current streak is ${streak} ${label}!` : "Start today to begin your streak!");
  haptic();
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
  toast("Saved");
}

async function ai(system, prompt, limit = 550) {
  if (!key()) {
    toast("Add an API key in AI settings");
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
    toast("Couldn't get a response from AI");
    return null;
  }
}

/* Telegram text file: try to load its content and cache it. */
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

    files = await Promise.all((data.files || []).map(async (file, index) => {
      const item = {
        ...file,
        internalId: `server_${file.id || index}`,
        id: file.id || `server_${index}`,
        type: file.type || file.file_type || "document",
        title: file.title || file.name || file.file_name || "File",
        text: file.text || file.caption || "",
        url: file.url || file.file_url || "",
        size: fileSize(file),
        aiCaption: file.ai_caption || file.blip_caption || file.caption_ai || ""
      };

      if (isTextFile(item)) {
        item.type = "text";
        item.text = await readTelegramText(item);
      }

      return item;
    }));
  } catch (_) {
    files = [];
  }

  updateStorage();
  updateStats();
  renderFiles();
}

/* Note */

function noteCounter() {
  const input = document.getElementById("smartNoteInput");
  document.getElementById("noteCharCounter").textContent = `${input.value.length} / ${input.maxLength}`;
}

async function createNote(text) {
  let title = text.slice(0, 60);
  let tags = [];

  if (key()) {
    const result = await ai(
      "Return only JSON: {\"title\":\"short title\",\"tags\":[\"tag\"]}. Up to 5 tags. Use the same language as the note.",
      text,
      180
    );

    try {
      const parsed = JSON.parse(result?.match(/\{[\s\S]*\}/)?.[0] || "{}");
      title = String(parsed.title || title).slice(0, 90);
      tags = Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5).map(String) : [];
    } catch (_) {}
  }

  const note = { id: Date.now(), title, text, tags, date: new Date().toISOString() };
  db.notes.unshift(note);
  db.stats.wordsWritten += words(text).length;
  saveDB();
  renderFiles();
  return note;
}

async function saveSmartNote() {
  const input = document.getElementById("smartNoteInput");
  const text = input.value.trim();
  if (!text) return toast("Write a thought first");

  input.value = "";
  noteCounter();

  await createNote(text);
  toast("Note saved");
}

/* Journal */

function setMood(value) {
  mood = value;
  document.querySelectorAll(".journal-mood-selector button").forEach((button) => {
    button.classList.toggle("selected", button.getAttribute("onclick")?.includes(`'${value}'`));
  });
}

function saveJournal() {
  const input = document.getElementById("journalInput");
  const text = input.value.trim();
  if (!text) return toast("Write something first");

  db.journal.unshift({ id: Date.now(), text, mood, date: new Date().toISOString() });
  db.stats.wordsWritten += words(text).length;
  input.value = "";
  saveDB();
  renderJournalEntries();
  toast("Entry saved");
}

function moodIcon(value) {
  return MOOD_ICONS[value] || MOOD_ICONS.calm;
}

function formatEntryDate(value) {
  return new Date(value).toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderJournalEntries() {
  const list = document.getElementById("journalEntriesList");
  if (!list) return;

  const entries = [...db.journal].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!entries.length) {
    list.innerHTML = '<div class="journal-entries-empty">No entries yet. Write your first one above.</div>';
    return;
  }

  list.innerHTML = "";

  entries.forEach((entry) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "journal-entry-card";
    card.innerHTML = `
      <span class="journal-entry-mood">${moodIcon(entry.mood)}</span>
      <span class="journal-entry-body">
        <span class="journal-entry-date">${esc(formatEntryDate(entry.date))}</span>
        <span class="journal-entry-text">${esc(clean(entry.text))}</span>
      </span>
    `;
    card.onclick = () => openDetails({ title: formatEntryDate(entry.date), text: entry.text, date: entry.date });
    list.appendChild(card);
  });
}

/* Folders and text files */

function renderFiles() {
  const grid = document.getElementById("folderGridView");
  const content = document.getElementById("folderContentsView");
  const topbar = document.getElementById("filesTopbar");

  if (!activeFolder) {
    grid.hidden = false;
    content.hidden = true;
    topbar.innerHTML = '<span class="files-topbar-title">Files</span>';

    document.getElementById("folderGrid").innerHTML = folders.map((folder) => {
      const count = allItems().filter((item) => folder.types.includes(item.type)).length;
      const colorClass = folder.color !== "blue" ? ` icon-${folder.color}` : "";

      return `
        <button class="folder-card" type="button" onclick="openFolder('${folder.id}')">
          <span class="folder-card-icon${colorClass}">${folder.svg}</span>
          <span class="folder-card-name">${esc(folder.name)}</span>
          <span class="folder-card-count">${count}</span>
        </button>
      `;
    }).join("");

    return;
  }

  grid.hidden = true;
  content.hidden = false;

  const folder = folders.find((item) => item.id === activeFolder);
  topbar.innerHTML = `
    <button class="icon-btn" type="button" onclick="closeFolder()" aria-label="Back">
      <svg class="svg-icon" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"></polyline></svg>
    </button>
    <span class="files-topbar-title">${esc(folder.name)}</span>
  `;

  const items = allItems().filter((item) => {
    const text = `${item.title} ${item.text} ${item.aiCaption || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
    return folder.types.includes(item.type) && (!searchQuery || text.includes(searchQuery));
  });

  const gallery = document.getElementById("folderGallery");
  gallery.innerHTML = "";

  if (!items.length) {
    gallery.innerHTML = '<div class="empty-files">Empty</div>';
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `grid-item ${item.type}`;

    if (item.type === "photo" && safeUrl(item.url)) {
      const caption = clean(item.aiCaption || "");
      card.innerHTML = `
        <img src="${safeUrl(item.url)}" alt="${esc(item.title)}">
        ${caption ? `<div class="grid-item-caption"><span class="cap-ai-tag">AI</span>${esc(caption)}</div>` : ""}
      `;
      card.onclick = () => openMedia(item);
    } else {
      card.innerHTML = `
        <div class="text-card-body">
          <strong>${esc(item.title)}</strong>
          <br><br>
          ${esc(clean(item.text).slice(0, 220) || "No text content received from server")}
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
}

function closeFolder() {
  activeFolder = null;
  renderFiles();
}

function handleSearch() {
  searchQuery = document.getElementById("searchInput").value.trim().toLowerCase();
  if (activeFolder) renderFiles();
}

/* Chat: recognizes a "save a note" command, otherwise chats as a full assistant
   using up to 5 relevant notes as optional context (not a hard restriction). */

const NOTE_COMMAND_RE =
  /^(?:save(?:\s+(?:a|this))?\s+note|remember\s+this|note\s+(?:this|it)\s+down|запиши(?:\s+(?:себе|мне))?(?:\s+заметку)?|сохрани(?:\s+(?:это|заметку))?)\s*[:\-–—]?\s*/i;

function extractNoteCommand(text) {
  if (!NOTE_COMMAND_RE.test(text)) return null;
  return text.replace(NOTE_COMMAND_RE, "").trim();
}

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
    .filter((note) => note.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function chatMessage(text, role, sources = [], extraClass = "") {
  const box = document.getElementById("chatContainer");
  const item = document.createElement("div");
  item.className = `chat-msg ${role}${extraClass ? ` ${extraClass}` : ""}`;
  item.textContent = text;

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
  return item;
}

function showTyping() {
  const box = document.getElementById("chatContainer");
  const item = document.createElement("div");
  item.className = "chat-typing";
  item.innerHTML = "<span></span><span></span><span></span>";
  box.appendChild(item);
  box.scrollTop = box.scrollHeight;
  return item;
}

async function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const question = input.value.trim();
  if (!question) return;

  input.value = "";
  chatMessage(question, "user");

  /* "Save a note" command — writes straight into Notes, visible in Files and synced to Telegram side. */
  const noteText = extractNoteCommand(question);
  if (noteText !== null) {
    if (!noteText) {
      chatMessage("Sure — what should I write down?", "ai");
      return;
    }

    const typing = showTyping();
    const note = await createNote(noteText);
    typing.remove();
    chatMessage(`Saved: "${note.title}"`, "ai", [], "note-confirm");
    return;
  }

  const notes = relevant(question);
  const context = notes
    .map((note, index) => `[${index + 1}] ${note.title}\n${note.text.slice(0, 1000)}`)
    .join("\n\n");

  const typing = showTyping();
  const answer = await ai(
    "You are Infinity AI, a friendly, capable assistant built into a personal notes app called Infinity Storage. " +
      "Chat naturally about anything the user brings up, the same way any full-featured AI assistant would. " +
      "If personal context (the user's own notes) is provided below, use it when relevant to answer questions about " +
      "their notes, thoughts, or journal — but do not restrict yourself to it, and don't mention that context was or " +
      "wasn't provided. Always reply in the same language the user is writing in. Keep answers clear and concise.",
    (context ? `CONTEXT FROM USER'S NOTES:\n${context}\n\n` : "") + `USER MESSAGE:\n${question}`,
    650
  );

  typing.remove();
  chatMessage(answer || "Couldn't get a response. Check your AI settings.", "ai", notes);
}

function handleChatKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
  }
}

/* Neural map */

function links(notes) {
  const result = [];
  const degree = {};

  notes.forEach((a, i) => notes.slice(i + 1).forEach((b) => {
    const tags = new Set((a.tags || []).map((tag) => tag.toLowerCase()));
    const common = (b.tags || []).filter((tag) => tags.has(tag.toLowerCase()));

    if (common.length) {
      result.push({
        source: `note_${a.id}`,
        target: `note_${b.id}`,
        strength: common.length
      });
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
    mount.innerHTML = '<p class="brain-empty-message">Add a few notes with tags first.</p>';
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

  /* Mobile controls: one finger to rotate, two fingers to zoom. */
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
}

function toggleBrainHelp() {
  const help = document.getElementById("brainHelp");
  help.hidden = !help.hidden;
}

function closeBrainMap() {
  brainGraph?._destructor?.();
  brainGraph = null;
  document.getElementById("brainMapModal").classList.remove("active");
}

/* Full note and media view */

function openDetails(item) {
  document.getElementById("details-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "details-overlay";
  overlay.className = "note-details-overlay";

  overlay.innerHTML = `
    <section class="note-details-card" role="dialog" aria-modal="true">
      <button class="note-details-close" type="button" aria-label="Close">
        <svg class="svg-icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
      <div class="note-details-date">${esc(new Date(item.date || Date.now()).toLocaleString("en-US"))}</div>
      <h2>${esc(item.title || "File")}</h2>
      <div class="note-details-text">${esc(item.text || "The server did not return file content.").replaceAll("\n", "<br>")}</div>
    </section>
  `;

  overlay.onclick = (event) => {
    if (event.target === overlay || event.target.closest(".note-details-close")) overlay.remove();
  };

  document.body.appendChild(overlay);
}

function openMedia(file) {
  const url = safeUrl(file.url);
  if (!url) return;

  document.getElementById("modalContent").innerHTML = `<img src="${url}" alt="${esc(file.title)}">`;
  document.getElementById("mediaModal").classList.add("active");
}

function closeModal() {
  document.getElementById("mediaModal").classList.remove("active");
  document.getElementById("modalContent").innerHTML = "";
}

/* Calendar and insight */

function openJournalCalendar() {
  const now = new Date();
  const saved = new Set(db.journal.map((entry) => dateKey(entry.date)));
  const start = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;
  const count = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  let days = "<span></span>".repeat(start);

  for (let day = 1; day <= count; day += 1) {
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const hasEntry = saved.has(key);
    days += `<span class="calendar-day ${hasEntry ? "has-entry" : "no-entry"}"${hasEntry ? ` data-date="${key}"` : ""}>${day}</span>`;
  }

  const overlay = document.createElement("div");
  overlay.className = "calendar-overlay";
  overlay.innerHTML = `
    <section class="calendar-card">
      <button class="calendar-close" type="button" aria-label="Close">
        <svg class="svg-icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
      <h2>${now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
      <div class="calendar-grid">${days}</div>
    </section>
  `;

  overlay.onclick = (event) => {
    if (event.target === overlay || event.target.closest(".calendar-close")) {
      overlay.remove();
      return;
    }

    const dayEl = event.target.closest(".calendar-day.has-entry");
    if (dayEl?.dataset.date) {
      overlay.remove();
      showEntriesForDate(dayEl.dataset.date);
    }
  };

  document.body.appendChild(overlay);
}

/* Opens every journal entry saved on a given date (fixes date lookup and viewing past entries). */
function showEntriesForDate(key) {
  const entries = db.journal
    .filter((entry) => dateKey(entry.date) === key)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!entries.length) return;

  const [year, month, day] = key.split("-").map(Number);
  const label = new Date(year, month - 1, day).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  const text = entries
    .map((entry) => {
      const time = new Date(entry.date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      return `${time} · ${entry.mood}\n${entry.text}`;
    })
    .join("\n\n———\n\n");

  openDetails({ title: label, text, date: entries[0].date });
}

function renderActivity() {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const key = dateKey(date);

    return {
      label: date.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2),
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
  const end = new Date();
  const start = new Date();

  if (insightPeriod === "week") start.setDate(end.getDate() - 6);

  const records = [
    ...db.notes,
    ...db.journal
  ]
    .filter((item) => new Date(item.date) >= start)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8)
    .map((item) => `${item.title || "Journal"}: ${String(item.text).slice(0, 550)}`)
    .join("\n---\n");

  const area = document.getElementById("dailyInsightContent");

  if (!records) {
    area.textContent = "No entries for the selected period.";
    return;
  }

  area.textContent = "Generating insight…";

  const result = await ai(
    "Write a gentle, brief portrait of a person based only on their entries. What they might be feeling, thinking about, and what could help them. Do not diagnose. Up to 5 sentences.",
    records,
    260
  );

  area.textContent = result || "Couldn't generate an insight.";
}

/* Export, import, navigation */

function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
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
      localStorage.setItem("infinityLocalDB", String(reader.result));
      location.reload();
    } catch (_) {
      toast("Import failed");
    }
  };
  reader.readAsText(file);
}

function switchTab(id, button) {
  document.querySelectorAll(".tab-content").forEach((item) => item.classList.remove("active"));
  document.getElementById(`tab-${id}`).classList.add("active");

  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");

  if (id === "profile") renderActivity();
  if (id === "journal") renderJournalEntries();
  haptic();
}

function toast(text) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = text;
  document.getElementById("toast-box").appendChild(item);
  setTimeout(() => item.remove(), 3000);
}

async function init() {
  const name = user?.first_name || "User";

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
    panel.hidden = !panel.hidden;
  };

  document.querySelectorAll("[data-insight-period]").forEach((button) => {
    button.onclick = () => {
      insightPeriod = button.dataset.insightPeriod;
      document.querySelectorAll("[data-insight-period]").forEach((item) => item.classList.toggle("active", item === button));
    };
  });

  loadSettings();
  noteCounter();
  updateStreak();
  setMood("calm");
  renderJournalEntries();
  await loadFiles();
  renderActivity();

  setTimeout(() => document.getElementById("app-loader").classList.add("hidden"), 300);
}

document.addEventListener("DOMContentLoaded", init);
