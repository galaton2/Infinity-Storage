// =============================================================================
// app.js — INFINITY BRAIN
// Объединенный скрипт: серверная медиа-галерея (Synology) + Второй Мозг (без задач)
// =============================================================================

(function () {
  'use strict';

  // ===========================================================================
  // ICONS & SVG
  // ===========================================================================
  const ICONS = {
    pin: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-7.2 7-12a7 7 0 10-14 0c0 4.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.4"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M12 2l1.8 5.4L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.6L12 2z"/></svg>',
    flame: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none"><path d="M12 2c1.2 3.6-3 5-3 8.6a3 3 0 006 0c0-1.4-.6-2-.6-2s1.6.8 1.6 3.4A4.6 4.6 0 0111.4 16 4.6 4.6 0 016.8 11.4c0-4 3.4-4.8 3.6-7.4.1-1 .7-1.6 1.6-2z"/></svg>',
  };

  // ===========================================================================
  // STORAGE (Локальное хранилище данных без задач)
  // ===========================================================================
  const KEYS = {
    notes: 'sb_notes',
    journal: 'sb_journal',
    chat: 'sb_chat',
    settings: 'sb_settings',
    meta: 'sb_meta',
  };

  const DEFAULT_CATEGORIES = [
    { id: 'idea', label: 'Идея', color: '#F2B84B' },
    { id: 'learning', label: 'Обучение', color: '#6FA8FF' },
    { id: 'journal', label: 'Дневник', color: '#FF8A3D' },
    { id: 'work', label: 'Работа', color: '#B18CFF' },
    { id: 'media', label: 'Медиа', color: '#00D98A' },
    { id: 'other', label: 'Другое', color: '#9B9BA1' },
  ];

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.error('storage read error', key, e);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('storage write error', key, e);
      return false;
    }
  }

  function getMeta() { return readJSON(KEYS.meta, { noteCounter: 0, streak: 0, lastActiveDate: null }); }
  function saveMeta(meta) { return writeJSON(KEYS.meta, meta); }
  function nextNoteNumber() {
    const meta = getMeta();
    meta.noteCounter = (meta.noteCounter || 0) + 1;
    saveMeta(meta);
    return meta.noteCounter;
  }

  function touchActivity() {
    const meta = getMeta();
    const today = new Date().toISOString().slice(0, 10);
    if (meta.lastActiveDate === today) return meta.streak || 0;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (meta.lastActiveDate === yesterday) {
      meta.streak = (meta.streak || 0) + 1;
    } else {
      meta.streak = 1;
    }
    meta.lastActiveDate = today;
    saveMeta(meta);
    return meta.streak;
  }
  function getStreak() { return getMeta().streak || 0; }

  function getSettings() {
    return readJSON(KEYS.settings, {
      apiKey: '',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      userName: '',
    });
  }
  function saveSettings(patch) {
    const current = getSettings();
    const updated = { ...current, ...patch };
    writeJSON(KEYS.settings, updated);
    return updated;
  }

  function getCategories() { return readJSON('sb_categories', DEFAULT_CATEGORIES); }
  function categoryById(id) {
    return getCategories().find((c) => c.id === id) || getCategories()[getCategories().length - 1];
  }

  function getNotes() { return readJSON(KEYS.notes, []); }
  function saveNotes(list) { writeJSON(KEYS.notes, list); }
  function addNote({ title = '', body, category = 'idea', tags = [] }) {
    const notes = getNotes();
    const note = {
      id: uid(),
      number: nextNoteNumber(),
      title: title.trim(),
      body: body.trim(),
      category,
      tags,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    notes.unshift(note);
    saveNotes(notes);
    touchActivity();
    return note;
  }
  function updateNote(id, patch) {
    const notes = getNotes();
    const idx = notes.findIndex((n) => n.id === id);
    if (idx === -1) return null;
    notes[idx] = { ...notes[idx], ...patch, updatedAt: Date.now() };
    saveNotes(notes);
    return notes[idx];
  }
  function deleteNote(id) { saveNotes(getNotes().filter((n) => n.id !== id)); }
  function getNote(id) { return getNotes().find((n) => n.id === id) || null; }
  function togglePinNote(id) {
    const notes = getNotes();
    const idx = notes.findIndex((n) => n.id === id);
    if (idx === -1) return null;
    notes[idx].pinned = !notes[idx].pinned;
    saveNotes(notes);
    return notes[idx];
  }

  function getJournal() { return readJSON(KEYS.journal, []); }
  function saveJournal(list) { writeJSON(KEYS.journal, list); }
  function todayKey() { return new Date().toISOString().slice(0, 10); }
  function getEntryByDate(dateKey) { return getJournal().find((e) => e.date === dateKey) || null; }
  function upsertJournalEntry({ date = todayKey(), text, mood = null }) {
    const list = getJournal();
    const idx = list.findIndex((e) => e.date === date);
    if (idx === -1) {
      const entry = { id: uid(), date, text, mood, aiSummary: null, createdAt: Date.now(), updatedAt: Date.now() };
      list.unshift(entry);
      saveJournal(list);
      touchActivity();
      return entry;
    }
    list[idx] = { ...list[idx], text, mood: mood ?? list[idx].mood, updatedAt: Date.now() };
    saveJournal(list);
    touchActivity();
    return list[idx];
  }
  function setJournalAISummary(date, summary) {
    const list = getJournal();
    const idx = list.findIndex((e) => e.date === date);
    if (idx === -1) return;
    list[idx].aiSummary = summary;
    saveJournal(list);
  }

  function getChat() { return readJSON(KEYS.chat, []); }
  function saveChat(list) { writeJSON(KEYS.chat, list); }
  function addChatMessage({ role, content, sources = [] }) {
    const list = getChat();
    const msg = { id: uid(), role, content, sources, ts: Date.now() };
    list.push(msg);
    saveChat(list);
    return msg;
  }
  function clearChat() { saveChat([]); }

  function countWords(str = '') {
    const t = str.trim();
    return t ? t.split(/\s+/).length : 0;
  }
  function getWordsWritten() {
    const notes = getNotes().reduce((sum, n) => sum + countWords(n.body) + countWords(n.title), 0);
    const journal = getJournal().reduce((sum, e) => sum + countWords(e.text), 0);
    return notes + journal;
  }
  function getStats(mediaCount = 0) {
    const notes = getNotes();
    const journal = getJournal();
    return {
      notesCount: notes.length,
      mediaCount: mediaCount,
      journalDays: journal.length,
      streak: getStreak(),
      wordsWritten: getWordsWritten(),
    };
  }

  function getMonthlyNoteCounts(year) {
    const counts = new Array(12).fill(0);
    getNotes().forEach((n) => {
      const d = new Date(n.createdAt);
      if (d.getFullYear() === year) counts[d.getMonth()] += 1;
    });
    return counts;
  }
  function getAvailableYears() {
    const years = new Set(getNotes().map((n) => new Date(n.createdAt).getFullYear()));
    years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }

  function isOnboarded() { return localStorage.getItem('sb_onboarded') === '1'; }
  function setOnboarded(val) {
    if (val) localStorage.setItem('sb_onboarded', '1');
    else localStorage.removeItem('sb_onboarded');
  }

  function exportAll() {
    return {
      exportedAt: new Date().toISOString(),
      notes: getNotes(),
      journal: getJournal(),
      chat: getChat(),
      settings: { ...getSettings(), apiKey: '' },
      meta: getMeta(),
    };
  }
  function importAll(data) {
    if (!data || typeof data !== 'object') throw new Error('Некорректный файл');
    if (Array.isArray(data.notes)) saveNotes(data.notes);
    if (Array.isArray(data.journal)) saveJournal(data.journal);
    if (Array.isArray(data.chat)) saveChat(data.chat);
    if (data.meta) saveMeta(data.meta);
    return true;
  }
  function clearAllData() {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem('sb_categories');
    localStorage.removeItem('sb_onboarded');
  }

  const Storage = {
    uid,
    getSettings, saveSettings,
    getCategories, categoryById,
    getNotes, addNote, updateNote, deleteNote, getNote, togglePinNote,
    getJournal, getEntryByDate, upsertJournalEntry, setJournalAISummary, todayKey,
    getChat, addChatMessage, clearChat,
    getStats, getStreak, touchActivity, getWordsWritten,
    getMonthlyNoteCounts, getAvailableYears,
    isOnboarded, setOnboarded,
    exportAll, importAll, clearAllData,
  };

  // ===========================================================================
  // TG & NATIVE APIS
  // ===========================================================================
  function tg() { return window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null; }
  function isTelegram() { return !!tg(); }

  function tgInit() {
    const app = tg();
    if (!app) return;
    app.ready();
    app.expand();
    try { app.enableClosingConfirmation?.(); } catch {}
  }

  function haptic(type = 'light') {
    const app = tg();
    if (!app?.HapticFeedback) return;
    try {
      if (type === 'success' || type === 'error' || type === 'warning') {
        app.HapticFeedback.notificationOccurred(type);
      } else if (type === 'selection') {
        app.HapticFeedback.selectionChanged();
      } else {
        app.HapticFeedback.impactOccurred(type);
      }
    } catch {}
  }

  function showConfirm(message) {
    return new Promise((resolve) => {
      const app = tg();
      if (app?.showConfirm) app.showConfirm(message, (confirmed) => resolve(!!confirmed));
      else resolve(window.confirm(message));
    });
  }

  const TG = { init: tgInit, isTelegram, haptic, showConfirm };

  // ===========================================================================
  // TOGETHER AI (ИИ Без поиска задач)
  // ===========================================================================
  const API_URL = 'https://api.together.xyz/v1/chat/completions';
  class TogetherError extends Error {}

  async function rawChat(messages, { temperature = 0.6, maxTokens = 900, model } = {}) {
    const settings = Storage.getSettings();
    const apiKey = settings.apiKey;
    if (!apiKey) throw new TogetherError('Не задан API-ключ Together в Профиле.');

    let response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model || settings.model || 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
          messages, temperature, max_tokens: maxTokens,
        }),
      });
    } catch (networkErr) {
      throw new TogetherError('Сеть недоступна или запрос заблокирован.');
    }

    if (!response.ok) {
      let detail = '';
      try {
        const errJson = await response.json();
        detail = errJson?.error?.message || JSON.stringify(errJson);
      } catch { detail = await response.text(); }
      if (response.status === 401) throw new TogetherError('Неверный API-ключ (401).');
      if (response.status === 429) throw new TogetherError('Лимит запросов (429).');
      throw new TogetherError(`Ошибка ${response.status}: ${detail}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new TogetherError('Пустой ответ модели.');
    return content;
  }

  function extractJSON(text) {
    const cleaned = text.replace(/```json|```/g, '').trim();
    try { return JSON.parse(cleaned); } catch {
      const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (match) { try { return JSON.parse(match[0]); } catch {} }
      throw new TogetherError('Не удалось разобрать ответ модели.');
    }
  }

  const STOPWORDS = new Set(['и','в','во','не','что','он','на','я','с','со','как','а','то','все','она','так','его','но','да','ты','к','у','же','вы','за','бы','по','только','ее','мне','было','вот','от','меня','еще','нет','о','из']);

  function tokenize(text) {
    return (text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  }

  function scoreNote(queryTokens, note) {
    const noteTokens = tokenize(`${note.title} ${note.body} ${(note.tags || []).join(' ')}`);
    if (!noteTokens.length) return 0;
    const freq = {};
    noteTokens.forEach((t) => (freq[t] = (freq[t] || 0) + 1));
    let score = 0;
    queryTokens.forEach((q) => { if (freq[q]) score += freq[q]; });
    return score;
  }

  function findRelevantNotes(query, notes, limit = 6) {
    const qTokens = tokenize(query);
    if (!qTokens.length) return notes.slice(0, Math.min(limit, notes.length));
    return notes
      .map((n) => ({ note: n, score: scoreNote(qTokens, n) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.note);
  }

  function noteToContextBlock(note) {
    const cat = Storage.categoryById(note.category);
    const date = new Date(note.createdAt).toLocaleDateString('ru-RU');
    return `[#${String(note.number).padStart(4, '0')} · ${cat.label} · ${date}] ${note.title ? note.title + ' — ' : ''}${note.body}`;
  }

  async function testConnection() {
    await rawChat([{ role: 'user', content: 'Привет' }], { maxTokens: 10, temperature: 0 });
    return true;
  }

  async function ragChat(userMessage, history = []) {
    const notes = Storage.getNotes();
    const relevant = findRelevantNotes(userMessage, notes, 6);
    const contextBlock = relevant.length
      ? relevant.map(noteToContextBlock).join('\n---\n')
      : '(в базе пока нет заметок, отвечай на основе общих знаний)';

    const systemPrompt =
      'Ты — личный ассистент пользователя «Infinity Brain». Отвечай по-русски, кратко, опираясь на базу знаний:\n\n' +
      `КОНТЕКСТ:\n${contextBlock}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10).map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
      { role: 'user', content: userMessage },
    ];

    const reply = await rawChat(messages, { temperature: 0.6, maxTokens: 700 });
    return { reply, sources: relevant.map((n) => ({ id: n.id, number: n.number, title: n.title || n.body.slice(0, 30) })) };
  }

  async function categorizeNote(text) {
    const categories = Storage.getCategories();
    const catList = categories.map((c) => `${c.id} (${c.label})`).join(', ');
    const messages = [
      {
        role: 'system',
        content:
          'Разложи текст по полочкам. Верни СТРОГО JSON без markdown: ' +
          `{"title": "короткий заголовок (до 6 слов)", "category": "один из: ${catList}", "tags": ["тег1", "тег2"]}.`,
      },
      { role: 'user', content: text },
    ];
    const raw = await rawChat(messages, { temperature: 0.3, maxTokens: 300 });
    const parsed = extractJSON(raw);
    const validCategory = categories.some((c) => c.id === parsed.category) ? parsed.category : 'other';
    return {
      title: typeof parsed.title === 'string' ? parsed.title.slice(0, 80) : '',
      category: validCategory,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6).map(String) : [],
    };
  }

  async function summarizeText(text) {
    const messages = [
      { role: 'system', content: 'Сожми текст до 2-3 предложений на русском. Без лишних вводных фраз.' },
      { role: 'user', content: text },
    ];
    return rawChat(messages, { temperature: 0.4, maxTokens: 250 });
  }

  async function summarizeDay(entryText, mood) {
    const messages = [
      {
        role: 'system',
        content:
          'Ты — ассистент дневника. По записи дай короткую (2-3 предложения) рефлексию: подметь настроение и сделай мягкий вывод.',
      },
      { role: 'user', content: `Настроение: ${mood || 'не указано'}\nЗапись: ${entryText}` },
    ];
    return rawChat(messages, { temperature: 0.7, maxTokens: 250 });
  }

  async function weeklyInsight(entries) {
    const block = entries.map((e) => `${e.date} (настроение: ${e.mood || '—'}): ${e.text}`).join('\n');
    const messages = [
      {
        role: 'system',
        content:
          'На основе записей найди темы и эмоциональную динамику недели. Ответ на русском, 3-4 предложения.',
      },
      { role: 'user', content: block },
    ];
    return rawChat(messages, { temperature: 0.6, maxTokens: 350 });
  }

  const Together = {
    testConnection, ragChat, categorizeNote, summarizeText, summarizeDay, weeklyInsight,
  };

  // ===========================================================================
  // STATE & UTILS
  // ===========================================================================
  const state = {
    view: 'home',
    recordsFilter: 'notes', // notes | journal
    recordsView: 'list', // list | map
    recordsQuery: '',
    searchOpen: false,
    editingNoteId: null,
    journalMood: null,
    chatSending: false,
    profileRange: 'week',
    serverFilesCount: 0,
  };

  let currentActivePhotoUrl = null;

  const MOODS = [
    { id: 'bad', emoji: '😔', label: 'Тяжело' },
    { id: 'meh', emoji: '😕', label: 'Так себе' },
    { id: 'ok', emoji: '😐', label: 'Нормально' },
    { id: 'good', emoji: '🙂', label: 'Хорошо' },
    { id: 'great', emoji: '😄', label: 'Отлично' },
  ];

  const MONTHS_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const WEEKDAYS_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function escapeHtml(str = '') {
    return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return 'сегодня, ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  function emptyStateHTML(msg = 'Пока пусто.') { return `<div class="empty-state">${escapeHtml(msg)}</div>`; }

  let toastTimer = null;
  function toast(msg, ms = 2600) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
  }

  async function withBusy(button, fn, busyLabel = '…') {
    if (!button) return fn();
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span>${busyLabel}</span>`;
    try { return await fn(); } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  function handleError(err) {
    console.error(err);
    toast(err && err.message ? err.message : 'Произошла ошибка', 3600);
    TG.haptic('error');
  }

  function hash01(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
    return (h % 1000) / 1000;
  }

  // ===========================================================================
  // SYNOLOGY MEDIA LOADER (Серверная часть для фоток и видосов)
  // ===========================================================================
  async function fetchFiles() {
    const userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id || '8597789604';
    const apiUrl = `https://galaxylab.i234.me:8443/api/files?user_id=${userId}`;
    const loader = $('#loader');
    const statusText = $('#status-text');

    try {
      const response = await fetch(apiUrl);
      const data = await response.json();

      if (data.status === 'success' && data.files && data.files.length > 0) {
        state.serverFilesCount = data.files.length;
        renderGallery(data.files);
      } else {
        if (loader) loader.style.display = 'none';
        if (statusText) statusText.innerText = "Хранилище пусто";
      }
    } catch (error) {
      if (statusText) statusText.innerText = "Ошибка синхронизации NAS";
      if (loader) loader.style.display = 'none';
      console.error("Ошибка загрузки медиа:", error);
    }
  }

  function renderGallery(files) {
    const galleryContainer = $('#gallery-container');
    const loader = $('#loader');
    const statusText = $('#status-text');

    if (loader) loader.style.display = 'none';
    if (galleryContainer) {
      galleryContainer.style.display = 'grid';
      galleryContainer.innerHTML = '';
    }
    if (statusText) statusText.innerText = `Файлов в облаке: ${files.length}`;

    files.forEach((file) => {
      if (file.type === 'photo' || file.url) {
        const item = document.createElement('div');
        item.className = 'gallery-item';

        const img = document.createElement('img');
        img.src = file.url;
        img.loading = "lazy";
        img.onclick = () => openPhotoModal(file.url);

        item.appendChild(img);
        galleryContainer.appendChild(item);
      }
    });
  }

  function openPhotoModal(imageUrl) {
    currentActivePhotoUrl = imageUrl;
    const modal = $('#photo-modal');
    const modalImage = $('#modal-image');
    if (modal && modalImage) {
      modalImage.src = imageUrl;
      modal.hidden = false;
      TG.haptic('light');
    }
  }

  function closePhotoModal() {
    const modal = $('#photo-modal');
    const modalImage = $('#modal-image');
    if (modal) modal.hidden = true;
    if (modalImage) modalImage.src = "";
    currentActivePhotoUrl = null;
  }

  function bindMediaModal() {
    const closeBtn = $('#photo-modal-close');
    const deleteBtn = $('#delete-btn');
    const modal = $('#photo-modal');

    if (closeBtn) closeBtn.onclick = closePhotoModal;

    if (deleteBtn) {
      deleteBtn.onclick = () => {
        TG.haptic('warning');
        const images = document.querySelectorAll('.gallery-item img');
        images.forEach(img => {
          if (img.src === currentActivePhotoUrl) {
            img.parentElement.remove();
          }
        });
        closePhotoModal();
        toast('Файл удален из вида');
      };
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closePhotoModal();
      });
    }
  }

  // ===========================================================================
  // NAVIGATION
  // ===========================================================================
  function switchView(view) {
    state.view = view;
    $all('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
    $all('.tabbar__item').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === view));

    const subtitles = {
      home: 'хранилище и медиафайлы',
      records: 'заметки, дневник, карта',
      chat: 'разговор с базой знаний',
      profile: 'статистика и настройки',
    };
    $('#topbarSubtitle').textContent = subtitles[view] || '';

    if (view === 'records') renderRecordsScreen();
    if (view === 'chat') renderChat();
    if (view === 'profile') renderProfile();
  }

  function bindNav() {
    document.body.addEventListener('click', (e) => {
      const navBtn = e.target.closest('[data-nav]');
      if (navBtn) {
        TG.haptic('selection');
        switchView(navBtn.dataset.nav);
      }
    });
  }

  // ===========================================================================
  // RECORDS SCREEN (Заметки и Дневник)
  // ===========================================================================
  function fillCategorySelects() {
    const cats = Storage.getCategories();
    const options = cats.map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
    const noteCat = $('#noteCategory');
    if (noteCat) noteCat.innerHTML = options;
  }

  function renderNoteCardHTML(note) {
    const cat = Storage.categoryById(note.category);
    const title = note.title || (note.body.length > 46 ? note.body.slice(0, 46).trim() + '…' : note.body);
    const bodyPreview = note.title ? note.body : '';
    return `
      <article class="note-card${note.pinned ? ' is-pinned' : ''}" style="--cat-color:${cat.color}" data-note-id="${note.id}">
        <button class="note-card__pin${note.pinned ? ' is-active' : ''}" data-pin-toggle="${note.id}" type="button" aria-label="Закрепить">${ICONS.pin}</button>
        <span class="note-card__cat">${escapeHtml(cat.label)}</span>
        <h3 class="note-card__title">${escapeHtml(title)}</h3>
        ${bodyPreview ? `<p class="note-card__body">${escapeHtml(bodyPreview)}</p>` : ''}
      </article>`;
  }

  function setRecordsFilter(filter) {
    state.recordsFilter = filter;
    $all('#recordsTypeSeg [data-rtype]').forEach((b) => b.classList.toggle('is-active', b.dataset.rtype === filter));
    $('#btnNewNote').hidden = filter !== 'notes';
    $('#btnToggleSearch').hidden = filter === 'journal';
    if (filter === 'journal' && state.searchOpen) closeSearch();
    renderRecordsScreen();
  }

  function setRecordsView(view) {
    state.recordsView = view;
    $('#recordsListWrap').hidden = view === 'map';
    $('#recordsMapWrap').hidden = view !== 'map';
    $('#btnToggleMapView').classList.toggle('is-active', view === 'map');
    if (view === 'map') renderBrainMap();
  }

  function openSearch() {
    state.searchOpen = true;
    $('#searchBarWrap').hidden = false;
    $('#btnToggleSearch').classList.add('is-active');
    $('#recordsSearch').focus();
  }

  function closeSearch() {
    state.searchOpen = false;
    $('#searchBarWrap').hidden = true;
    $('#btnToggleSearch').classList.remove('is-active');
    if (state.recordsQuery) {
      state.recordsQuery = '';
      $('#recordsSearch').value = '';
      renderRecordsScreen();
    }
  }

  function renderRecordsScreen() {
    const filter = state.recordsFilter;
    $('#recordsList').hidden = filter !== 'notes';
    $('#journalPanel').hidden = filter !== 'journal';

    if (filter === 'journal') {
      renderJournalPanel();
    } else {
      renderNotesList();
    }
  }

  function renderNotesList() {
    const q = state.recordsQuery.trim().toLowerCase();
    let notes = Storage.getNotes();
    if (q) {
      notes = notes.filter(n => (n.title + ' ' + n.body + ' ' + (n.tags || []).join(' ')).toLowerCase().includes(q));
    }
    notes.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
    $('#recordsList').innerHTML = notes.length
      ? notes.map(renderNoteCardHTML).join('')
      : emptyStateHTML(q ? 'Ничего не найдено.' : 'Заметок пока нет. Добавьте первую кнопкой «+».');
  }

  // ===========================================================================
  // JOURNAL
  // ===========================================================================
  function renderJournalPanel() {
    renderJournalWeekStrip();
    renderJournalComposer();
    renderJournalHistoryList();
  }

  function renderJournalWeekStrip() {
    const byDate = {};
    Storage.getJournal().forEach((e) => { byDate[e.date] = e; });
    const today = new Date();
    let html = '';
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const entry = byDate[key];
      const mood = entry && MOODS.find((m) => m.id === entry.mood);
      html += `
        <div class="journal-week__day${i === 0 ? ' is-today' : ''}${entry ? ' has-entry' : ''}" data-week-date="${key}">
          <span class="journal-week__wd">${WEEKDAYS_SHORT[d.getDay()]}</span>
          <span class="journal-week__num">${d.getDate()}</span>
          <span class="journal-week__dot">${mood ? mood.emoji : ''}</span>
        </div>`;
    }
    $('#journalWeek').innerHTML = html;
    const streak = Storage.getStreak();
    $('#journalStreak').innerHTML = streak > 0 ? `${ICONS.flame}<span>${streak}</span>` : '';
  }

  function renderJournalComposer() {
    const today = Storage.todayKey();
    const entry = Storage.getEntryByDate(today);
    $('#journalDateSub').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#journalInput').value = entry ? entry.text : '';
    state.journalMood = entry ? entry.mood : null;
    renderMoodRow();

    $('#insightCard').hidden = true;
    if (entry && entry.aiSummary) {
      $('#insightCard').hidden = false;
      $('#insightText').textContent = entry.aiSummary;
    }
  }

  function renderJournalHistoryList() {
    const today = Storage.todayKey();
    let list = Storage.getJournal().filter((e) => e.date !== today);
    $('#journalHistoryList').innerHTML = list.length
      ? list.map(renderJournalEntryHTML).join('')
      : emptyStateHTML('Записей пока нет — заполните сегодняшнюю выше.');
  }

  function renderJournalEntryHTML(entry) {
    const d = new Date(entry.date);
    const mood = MOODS.find((m) => m.id === entry.mood);
    const day = d.getDate();
    const month = d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
    return `
      <div class="journal-entry" data-journal-entry="${entry.date}">
        <div class="journal-entry__date-badge"><span>${day}</span><small>${escapeHtml(month)}</small></div>
        <div class="journal-entry__body">
          <div class="journal-entry__head">
            <span class="journal-entry__weekday">${d.toLocaleDateString('ru-RU', { weekday: 'long' })}</span>
            <span class="journal-entry__mood">${mood ? mood.emoji : ''}</span>
          </div>
          <div class="journal-entry__text">${escapeHtml(entry.text)}</div>
          ${entry.aiSummary ? `<div class="journal-entry__ai" style="margin-top:8px; color:var(--success); font-size:12.5px; display:flex; gap:6px;">${ICONS.sparkle}<span>${escapeHtml(entry.aiSummary)}</span></div>` : ''}
        </div>
      </div>`;
  }

  function renderMoodRow() {
    $('#moodRow').innerHTML = MOODS.map(
      (m) => `<button type="button" class="mood-btn${state.journalMood === m.id ? ' is-active' : ''}" data-mood="${m.id}" title="${m.label}">${m.emoji}</button>`
    ).join('');
  }

  function bindRecords() {
    $('#recordsTypeSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rtype]');
      if (!btn) return;
      TG.haptic('selection');
      setRecordsFilter(btn.dataset.rtype);
    });

    $('#btnToggleMapView').addEventListener('click', () => {
      TG.haptic('selection');
      setRecordsView(state.recordsView === 'map' ? 'list' : 'map');
    });

    $('#btnToggleSearch').addEventListener('click', () => {
      TG.haptic('selection');
      state.searchOpen ? closeSearch() : openSearch();
    });
    $('#btnCloseSearch').addEventListener('click', () => { TG.haptic('selection'); closeSearch(); });

    $('#recordsSearch').addEventListener('input', (e) => {
      state.recordsQuery = e.target.value;
      renderRecordsScreen();
    });

    $('#btnNewNote').addEventListener('click', () => openNoteModal(null));

    $('#recordsList').addEventListener('click', (e) => {
      const pinBtn = e.target.closest('[data-pin-toggle]');
      if (pinBtn) {
        e.stopPropagation();
        Storage.togglePinNote(pinBtn.dataset.pinToggle);
        TG.haptic('selection');
        renderRecordsScreen();
        return;
      }
      const card = e.target.closest('.note-card');
      if (card && card.dataset.noteId) openNoteModal(card.dataset.noteId);
    });

    $('#moodRow').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mood]');
      if (!btn) return;
      state.journalMood = state.journalMood === btn.dataset.mood ? null : btn.dataset.mood;
      renderMoodRow();
      TG.haptic('selection');
    });

    $('#btnJournalSave').addEventListener('click', () => {
      const text = $('#journalInput').value.trim();
      if (!text) { toast('Запись пуста'); return; }
      Storage.upsertJournalEntry({ text, mood: state.journalMood });
      TG.haptic('success');
      toast('Запись сохранена');
      renderJournalPanel();
    });

    $('#btnJournalAI').addEventListener('click', async (e) => {
      const text = $('#journalInput').value.trim();
      if (!text) { toast('Сначала напишите пару строк'); return; }
      await withBusy(e.currentTarget, async () => {
        try {
          const summary = await Together.summarizeDay(text, state.journalMood);
          Storage.upsertJournalEntry({ text, mood: state.journalMood });
          Storage.setJournalAISummary(Storage.todayKey(), summary);
          toast('Готово ✨');
          renderJournalPanel();
        } catch (err) { handleError(err); }
      }, '✨ Анализ…');
    });

    $('#btnWeeklyInsight').addEventListener('click', async (e) => {
      const entries = Storage.getJournal().slice(0, 7);
      if (!entries.length) { toast('Недостаточно записей'); return; }
      await withBusy(e.currentTarget, async () => {
        try {
          const insight = await Together.weeklyInsight(entries);
          const list = $('#journalHistoryList');
          const card = document.createElement('div');
          card.className = 'insight-card';
          card.innerHTML = `<div class="insight-card__label">Итог недели</div><div class="insight-card__text">${escapeHtml(insight)}</div>`;
          list.prepend(card);
        } catch (err) { handleError(err); }
      }, '✨ Анализирую…');
    });
  }

  // ===========================================================================
  // NOTE MODAL (Без задач)
  // ===========================================================================
  function openNoteModal(noteId) {
    state.editingNoteId = noteId;
    const modal = $('#noteModal');
    $('#noteAiOutput').hidden = true;
    $('#noteAiOutput').innerHTML = '';

    if (noteId) {
      const note = Storage.getNote(noteId);
      if (!note) return;
      $('#noteModalId').textContent = `#${String(note.number).padStart(4, '0')}`;
      $('#noteModalDate').textContent = fmtDate(note.updatedAt);
      $('#noteTitle').value = note.title || '';
      $('#noteBody').value = note.body || '';
      $('#noteCategory').value = note.category || 'idea';
      $('#noteTags').value = (note.tags || []).join(', ');
      $('#btnDeleteNote').hidden = false;
      $('#btnPinNote').classList.toggle('is-active', !!note.pinned);
    } else {
      $('#noteModalId').textContent = 'новая';
      $('#noteModalDate').textContent = '';
      $('#noteTitle').value = '';
      $('#noteBody').value = '';
      $('#noteCategory').value = 'idea';
      $('#noteTags').value = '';
      $('#btnDeleteNote').hidden = true;
      $('#btnPinNote').classList.remove('is-active');
    }
    modal.hidden = false;
  }

  function closeNoteModal() { $('#noteModal').hidden = true; state.editingNoteId = null; }

  function bindNoteModal() {
    $('#noteModalClose').addEventListener('click', closeNoteModal);
    $('#noteModal').addEventListener('click', (e) => { if (e.target.id === 'noteModal') closeNoteModal(); });

    $('#btnPinNote').addEventListener('click', () => {
      if (!state.editingNoteId) { toast('Сначала сохраните заметку'); return; }
      const note = Storage.togglePinNote(state.editingNoteId);
      if (note) {
        $('#btnPinNote').classList.toggle('is-active', note.pinned);
        TG.haptic('selection');
        renderRecordsScreen();
      }
    });

    $('#btnSaveNote').addEventListener('click', () => {
      if (!$('#noteBody').value.trim()) { toast('Текст заметки пуст'); return; }
      const tags = $('#noteTags').value.split(',').map((t) => t.trim()).filter(Boolean);
      const payload = {
        title: $('#noteTitle').value,
        body: $('#noteBody').value,
        category: $('#noteCategory').value,
        tags,
      };
      if (state.editingNoteId) {
        Storage.updateNote(state.editingNoteId, payload);
        toast('Изменения сохранены');
      } else {
        Storage.addNote(payload);
        toast('Заметка добавлена');
      }
      TG.haptic('success');
      closeNoteModal();
      renderRecordsScreen();
    });

    $('#btnDeleteNote').addEventListener('click', async () => {
      if (!state.editingNoteId) return;
      const ok = await TG.showConfirm('Удалить заметку?');
      if (!ok) return;
      Storage.deleteNote(state.editingNoteId);
      TG.haptic('warning');
      toast('Заметка удалена');
      closeNoteModal();
      renderRecordsScreen();
    });

    $('#btnAutoProcess').addEventListener('click', async (e) => {
      const text = $('#noteBody').value.trim();
      if (!text) { toast('Сначала напишите текст заметки'); return; }
      await withBusy(e.currentTarget, async () => {
        try {
          const cat = await Together.categorizeNote(text);
          if (!$('#noteTitle').value.trim() && cat.title) $('#noteTitle').value = cat.title;
          $('#noteCategory').value = cat.category;
          $('#noteTags').value = cat.tags.join(', ');

          const out = $('#noteAiOutput');
          out.innerHTML = `<div>✓ Категория <b>${cat.category}</b> и теги [${cat.tags.join(', ')}] применены.</div>`;
          out.hidden = false;
          TG.haptic('success');
        } catch (err) { handleError(err); }
      }, '✨ Обработка…');
    });

    $('#btnSummarizeNote').addEventListener('click', async (e) => {
      const text = $('#noteBody').value.trim();
      if (!text) { toast('Сначала напишите текст заметки'); return; }
      await withBusy(e.currentTarget, async () => {
        try {
          const summary = await Together.summarizeText(text);
          const out = $('#noteAiOutput');
          out.innerHTML = `
            <div style="margin-bottom:8px;font-weight:700">Кратко:</div>
            <div style="margin-bottom:10px">${escapeHtml(summary)}</div>
            <button class="btn btn--ghost btn--sm" id="btnUseSummary" type="button">Заменить текст заметки</button>`;
          out.dataset.summary = summary;
          out.hidden = false;
        } catch (err) { handleError(err); }
      }, '📝 Сжимаю…');
    });

    $('#noteAiOutput').addEventListener('click', (e) => {
      if (e.target.id === 'btnUseSummary') {
        $('#noteBody').value = $('#noteAiOutput').dataset.summary || $('#noteBody').value;
        $('#noteAiOutput').hidden = true;
        toast('Текст обновлен');
      }
    });
  }

  // ===========================================================================
  // CHAT (RAG)
  // ===========================================================================
  function renderChat() {
    const log = $('#chatLog');
    const messages = Storage.getChat();
    log.innerHTML = messages.length
      ? messages.map(renderChatMessageHTML).join('')
      : emptyStateHTML('Спросите что-нибудь о своих заметках или мыслях.');
    log.scrollTop = log.scrollHeight;
  }

  function renderChatMessageHTML(msg) {
    const sourcesHTML = msg.sources && msg.sources.length
      ? `<div class="msg__sources">${msg.sources.map((s) => `<span class="msg__source-chip" data-open-note="${s.id}">#${String(s.number).padStart(4, '0')} ${escapeHtml((s.title || '').slice(0, 18))}</span>`).join('')}</div>`
      : '';
    return `
      <div class="msg msg--${msg.role === 'ai' ? 'ai' : 'user'}">
        <div class="msg__bubble">${escapeHtml(msg.content)}</div>
        ${sourcesHTML}
      </div>`;
  }

  function bindChat() {
    const input = $('#chatInput');
    input.addEventListener('input', () => autoGrow(input));

    $('#chatForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.chatSending) return;
      const text = input.value.trim();
      if (!text) return;

      Storage.addChatMessage({ role: 'user', content: text });
      input.value = '';
      autoGrow(input);
      renderChat();

      state.chatSending = true;
      $('#chatSend').disabled = true;
      const log = $('#chatLog');
      log.insertAdjacentHTML('beforeend', `<div class="msg msg--ai msg--typing" id="typingIndicator"><div class="msg__bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div></div>`);
      log.scrollTop = log.scrollHeight;

      try {
        const history = Storage.getChat();
        const { reply, sources } = await Together.ragChat(text, history);
        Storage.addChatMessage({ role: 'ai', content: reply, sources });
        TG.haptic('light');
      } catch (err) {
        Storage.addChatMessage({ role: 'ai', content: '⚠️ ' + (err.message || 'Ошибка запроса к ИИ') });
        TG.haptic('error');
      } finally {
        state.chatSending = false;
        $('#chatSend').disabled = false;
        $('#typingIndicator')?.remove();
        renderChat();
      }
    });

    $('#chatLog').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-open-note]');
      if (chip) openNoteModal(chip.dataset.openNote);
    });

    $('#btnClearChat').addEventListener('click', async () => {
      const ok = await TG.showConfirm('Очистить историю чата?');
      if (!ok) return;
      Storage.clearChat();
      renderChat();
    });
  }

  // ===========================================================================
  // PROFILE & STATS
  // ===========================================================================
  function renderProfile() {
    const stats = Storage.getStats(state.serverFilesCount);
    $('#statsGrid').innerHTML = `
      <div class="stat-card"><span class="stat-card__label">Заметок</span><div class="stat-card__value">${stats.notesCount}</div></div>
      <div class="stat-card"><span class="stat-card__label">Медиа на NAS</span><div class="stat-card__value" style="color:var(--accent)">${stats.mediaCount}</div></div>
      <div class="stat-card"><span class="stat-card__label">Серия дней</span><div class="stat-card__value" style="display:flex;align-items:center;gap:6px;">${stats.streak}${ICONS.flame}</div></div>
      <div class="stat-card"><span class="stat-card__label">Слов написано</span><div class="stat-card__value">${stats.wordsWritten}</div></div>
    `;
    renderActivityChart();

    const s = Storage.getSettings();
    $('#settingsApiKey').value = s.apiKey || '';
    $('#settingsModel').value = s.model || '';
    $('#apiTestStatus').textContent = '';
    $('#apiTestStatus').className = 'settings-status';
  }

  function computeBuckets(range) {
    const notes = Storage.getNotes();
    const now = new Date();

    if (range === 'week') {
      const labels = []; const counts = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now); d.setDate(now.getDate() - i); d.setHours(0, 0, 0, 0);
        const next = new Date(d); next.setDate(d.getDate() + 1);
        labels.push(WEEKDAYS_SHORT[d.getDay()]);
        counts.push(notes.filter((n) => n.createdAt >= d.getTime() && n.createdAt < next.getTime()).length);
      }
      return { labels, counts };
    }

    if (range === 'month') {
      const labels = []; const counts = [];
      for (let b = 5; b >= 0; b--) {
        const end = new Date(now); end.setDate(now.getDate() - b * 5); end.setHours(23, 59, 59, 999);
        const start = new Date(end); start.setDate(end.getDate() - 4); start.setHours(0, 0, 0, 0);
        labels.push(`${start.getDate()}–${end.getDate()}`);
        counts.push(notes.filter((n) => n.createdAt >= start.getTime() && n.createdAt <= end.getTime()).length);
      }
      return { labels, counts };
    }

    if (range === 'all') {
      const years = Storage.getAvailableYears().sort((a, b) => a - b);
      const counts = years.map((y) => notes.filter((n) => new Date(n.createdAt).getFullYear() === y).length);
      return { labels: years.map(String), counts };
    }

    const year = now.getFullYear();
    const counts = Storage.getMonthlyNoteCounts(year);
    return { labels: MONTHS_SHORT, counts };
  }

  function buildChartSVG(labels, counts) {
    const W = 320, H = 148, padL = 4, padR = 4, padB = 20, padT = 18;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const n = counts.length;
    const maxCount = Math.max(1, ...counts);
    const slot = chartW / n;
    const barW = Math.max(6, Math.min(28, slot * 0.56));
    const showLabels = n <= 12;

    let bars = '';
    counts.forEach((c, i) => {
      const cx = padL + slot * i + slot / 2;
      const barH = c > 0 ? Math.max(4, (c / maxCount) * chartH) : 2;
      const y = padT + (chartH - barH);
      const isLast = i === n - 1;
      const color = c > 0 ? (isLast ? 'var(--accent)' : 'var(--surface-2)') : 'var(--elevated)';
      bars += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="${Math.min(6, barW / 2).toFixed(1)}" fill="${color}"></rect>`;
      if (c > 0) bars += `<text class="chart-bar-value" x="${cx.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${c}</text>`;
      if (showLabels) bars += `<text class="chart-bar-label" x="${cx.toFixed(1)}" y="${H - 5}" text-anchor="middle">${escapeHtml(String(labels[i]))}</text>`;
    });

    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
  }

  const RANGE_SUBLABELS = { week: 'за 7 дней', month: 'за 30 дней', year: `за ${new Date().getFullYear()} год`, all: 'по годам' };

  function renderActivityChart() {
    const { labels, counts } = computeBuckets(state.profileRange);
    const total = counts.reduce((a, b) => a + b, 0);
    $('#chartTotalLabel').innerHTML = `${total}<small>${total === 1 ? 'заметка' : 'заметок'}</small>`;
    $('#chartSubLabel').textContent = RANGE_SUBLABELS[state.profileRange] || '';
    $('#chartMount').innerHTML = total > 0
      ? buildChartSVG(labels, counts)
      : `<div class="chart-empty">Нет данных — добавьте заметки, и появится график 📝</div>`;
  }

  function bindSettings() {
    $('#profileRange').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      state.profileRange = btn.dataset.range;
      $all('#profileRange [data-range]').forEach((b) => b.classList.toggle('is-active', b === btn));
      TG.haptic('selection');
      renderActivityChart();
    });

    $('#btnToggleKey').addEventListener('click', () => {
      const input = $('#settingsApiKey');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    $('#btnSaveSettings').addEventListener('click', () => {
      Storage.saveSettings({
        apiKey: $('#settingsApiKey').value.trim(),
        model: $('#settingsModel').value.trim(),
      });
      TG.haptic('success');
      toast('Настройки сохранены');
    });

    $('#btnTestApi').addEventListener('click', async (e) => {
      Storage.saveSettings({
        apiKey: $('#settingsApiKey').value.trim(),
        model: $('#settingsModel').value.trim(),
      });
      const status = $('#apiTestStatus');
      await withBusy(e.currentTarget, async () => {
        try {
          await Together.testConnection();
          status.textContent = '✓ Подключение работает';
          status.className = 'settings-status is-ok';
          TG.haptic('success');
        } catch (err) {
          status.textContent = '✕ ' + (err.message || 'Ошибка подключения');
          status.className = 'settings-status is-err';
          TG.haptic('error');
        }
      }, 'Проверяю…');
    });

    $('#btnShowOnboarding').addEventListener('click', showOnboarding);

    $('#btnExport').addEventListener('click', () => {
      const data = Storage.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `infinity-brain-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Экспортировано');
    });

    $('#importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        Storage.importAll(data);
        toast('Данные импортированы');
        TG.haptic('success');
        renderRecordsScreen();
        renderProfile();
      } catch (err) {
        handleError(err);
      } finally {
        e.target.value = '';
      }
    });

    $('#btnClearAll').addEventListener('click', async () => {
      const ok = await TG.showConfirm('Очистить все локальные заметки и чаты? Медиа на сервере останутся нетронутыми.');
      if (!ok) return;
      Storage.clearAllData();
      TG.haptic('warning');
      location.reload();
    });
  }

  // ===========================================================================
  // BRAIN MAP
  // ===========================================================================
  function buildBrainLinks(notes) {
    const tagGroups = {};
    notes.forEach((n) => (n.tags || []).forEach((t) => {
      (tagGroups[t] = tagGroups[t] || []).push(n.id);
    }));
    const scoreMap = new Map();
    Object.values(tagGroups).forEach((ids) => {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = [ids[i], ids[j]].sort().join('|');
          scoreMap.set(key, (scoreMap.get(key) || 0) + 1);
        }
      }
    });
    const edges = Array.from(scoreMap.entries())
      .map(([key, score]) => ({ key, score }))
      .sort((a, b) => b.score - a.score);

    const degree = {};
    const chosen = [];
    edges.forEach(({ key, score }) => {
      const [a, b] = key.split('|');
      if ((degree[a] || 0) < 3 && (degree[b] || 0) < 3) {
        degree[a] = (degree[a] || 0) + 1;
        degree[b] = (degree[b] || 0) + 1;
        chosen.push({ key, score });
      }
    });
    return chosen;
  }

  function buildBrainSVG() {
    const notes = [...Storage.getNotes()].sort((a, b) => a.createdAt - b.createdAt);
    const W = 340, H = 480, padX = 28, padTop = 26, padBottom = 26;

    const usedCatIds = Array.from(new Set(notes.map((n) => n.category)));
    const bandH = (H - padTop - padBottom) / Math.max(1, usedCatIds.length);

    const minTs = notes[0]?.createdAt ?? Date.now();
    const maxTs = notes[notes.length - 1]?.createdAt ?? Date.now();
    const span = Math.max(1, maxTs - minTs);

    const pos = {};
    notes.forEach((n) => {
      const bandIdx = usedCatIds.indexOf(n.category);
      const x = padX + ((n.createdAt - minTs) / span) * (W - padX * 2);
      const jitter = hash01(n.id);
      const y = padTop + bandIdx * bandH + bandH * (0.22 + jitter * 0.56);
      pos[n.id] = { x, y, note: n };
    });

    const links = buildBrainLinks(notes);

    let linksHTML = '';
    links.forEach(({ key, score }) => {
      const [id1, id2] = key.split('|');
      const p1 = pos[id1], p2 = pos[id2];
      if (!p1 || !p2) return;
      const midX = (p1.x + p2.x) / 2;
      const curve = (hash01(key) - 0.5) * 44;
      const midY = Math.min(p1.y, p2.y) - 22 + curve;
      const width = (1 + Math.min(score, 3) * 0.6).toFixed(2);
      const opacity = (0.3 + Math.min(score, 3) * 0.16).toFixed(2);
      linksHTML += `<path class="brain-link" d="M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}" stroke-width="${width}" opacity="${opacity}"/>`;
    });

    let nodesHTML = '';
    notes.forEach((n) => {
      const p = pos[n.id];
      const cat = Storage.categoryById(n.category);
      const r = 5 + Math.min(3, (n.tags || []).length) + (n.pinned ? 2 : 0);
      const dur = (2.4 + hash01(n.id + 'd') * 2.2).toFixed(2);
      const delay = (hash01(n.id + 't') * 2).toFixed(2);
      const label = escapeHtml((n.title || n.body).slice(0, 24));
      nodesHTML += `
        <g class="brain-node" data-note-id="${n.id}" style="animation: nodePulse ${dur}s ease-in-out ${delay}s infinite;">
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(r + 6).toFixed(1)}" fill="${cat.color}" opacity="0.15"></circle>
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${cat.color}" stroke="#0B0B0D" stroke-width="1.4"></circle>
          <title>${label}</title>
        </g>`;
    });

    return {
      svg: `<svg class="brain-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><g class="brain-links">${linksHTML}</g><g class="brain-nodes">${nodesHTML}</g></svg>`,
      noteCount: notes.length,
      linkCount: links.length,
      usedCatIds,
    };
  }

  function renderBrainMap() {
    const wrap = $('#brainCanvasWrap');
    const notes = Storage.getNotes();
    if (!notes.length) {
      wrap.innerHTML = `<div class="brain-empty">Пока нет заметок для карты мыслей.<br>Добавьте несколько заметок с тегами 🧠</div>`;
      $('#brainLegend').innerHTML = '';
      $('#brainStats').textContent = '';
      return;
    }
    const { svg, noteCount, linkCount, usedCatIds } = buildBrainSVG();
    wrap.innerHTML = svg;

    const categories = Storage.getCategories();
    $('#brainLegend').innerHTML = usedCatIds
      .map((id) => {
        const c = categories.find((cat) => cat.id === id);
        if (!c) return '';
        return `<span class="brain-legend__item"><span class="brain-legend__dot" style="background:${c.color}"></span>${escapeHtml(c.label)}</span>`;
      })
      .join('');
    $('#brainStats').textContent = `${noteCount} заметок · ${linkCount} связей`;
  }

  function bindBrain() {
    $('#brainCanvasWrap').addEventListener('click', (e) => {
      const node = e.target.closest('.brain-node');
      if (!node) return;
      const noteId = node.dataset.noteId;
      setRecordsView('list');
      openNoteModal(noteId);
    });
  }

  // ===========================================================================
  // ONBOARDING
  // ===========================================================================
  const ONBOARDING_SLIDES = [
    { icon: '🌌', title: 'Добро пожаловать в Infinity Brain', text: 'Ваше безграничное хранилище медиафайлов и база знаний с искусственным интеллектом в одном приложении.' },
    { icon: '📸', title: 'Медиа с вашего сервера', text: 'На главном экране хранятся все ваши фото и видео с Synology NAS без сжатия и ограничений.' },
    { icon: '📝', title: 'Заметки и Дневник', text: 'Раздел «Записи» сохранит ваши мысли, идеи и рефлексию за каждый день. Переключайтесь в режим карты, чтобы видеть связи между темами.' },
    { icon: '🤖', title: 'Чат с вашей базой знаний', text: 'ИИ помнит все ваши заметки. Задавайте вопросы во вкладке «ИИ-чат» и находите нужную информацию мгновенно.' },
  ];

  let onboardingIndex = 0;

  function buildOnboardingSlides() {
    $('#onboardingTrack').innerHTML = ONBOARDING_SLIDES.map((s) => `
      <div class="onboarding__slide">
        <div class="onboarding__icon">${s.icon}</div>
        <h2 class="onboarding__title">${escapeHtml(s.title)}</h2>
        <p class="onboarding__text">${escapeHtml(s.text)}</p>
      </div>`).join('');
    $('#onboardingDots').innerHTML = ONBOARDING_SLIDES.map((_, i) => `<span class="onboarding__dot${i === 0 ? ' is-active' : ''}"></span>`).join('');
  }

  function updateOnboardingSlide() {
    const track = $('#onboardingTrack');
    track.style.transform = `translateX(-${onboardingIndex * 100}%)`;
    $all('.onboarding__dot').forEach((d, i) => d.classList.toggle('is-active', i === onboardingIndex));
    $('#onboardingNext').textContent = onboardingIndex === ONBOARDING_SLIDES.length - 1 ? 'Начать' : 'Далее';
  }

  function showOnboarding() {
    onboardingIndex = 0;
    buildOnboardingSlides();
    updateOnboardingSlide();
    $('#onboarding').hidden = false;
  }

  function finishOnboarding() { Storage.setOnboarded(true); $('#onboarding').hidden = true; }

  function bindOnboarding() {
    $('#onboardingNext').addEventListener('click', () => {
      if (onboardingIndex < ONBOARDING_SLIDES.length - 1) {
        onboardingIndex += 1;
        updateOnboardingSlide();
        TG.haptic('selection');
      } else {
        finishOnboarding();
        TG.haptic('success');
      }
    });
    $('#onboardingSkip').addEventListener('click', finishOnboarding);
  }

  // ===========================================================================
  // BOOTSTRAP
  // ===========================================================================
  function init() {
    TG.init();
    fillCategorySelects();
    bindNav();
    bindMediaModal();
    bindRecords();
    bindNoteModal();
    bindChat();
    bindSettings();
    bindBrain();
    bindOnboarding();

    switchView('home');
    fetchFiles(); // Загружаем медиа с Synology

    if (!Storage.isOnboarded()) showOnboarding();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
