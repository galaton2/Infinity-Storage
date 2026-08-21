/* ── Telegram init ── */
const tg = window.Telegram?.WebApp || {};
if (tg.expand) tg.expand();
if (tg.ready) tg.ready();

try { 
  if (tg.setHeaderColor) tg.setHeaderColor('#020204'); 
  if (tg.setBackgroundColor) tg.setBackgroundColor('#020204'); 
  if (tg.setBottomBarColor) tg.setBottomBarColor('#020204'); 
} catch(e) {
  console.warn("Telegram API styles error:", e);
}

const user = tg.initDataUnsafe?.user;

/* ── Constants & State ── */
const API_URL  = 'https://galaxylab.i234.me:8443/api/files';
const PAGE_SIZE = 20;

let globalFiles   = []; // Файлы с сервера
let activeFolder  = null;
let searchQuery   = '';

/* ── Local Database Wrapper (Исключительно Frontend) ── */
let localDB = JSON.parse(localStorage.getItem('infinityLocalDB')) || {
  notes: [],       // Умные заметки: { id, text, tags, title, date }
  journal: [],     // Дневник: { id, text, mood, aiComment, date }
  stats: { streak: 0, lastLogin: null, wordsWritten: 0 },
  settings: { togetherApiKey: '' }
};

function saveLocalDB() {
  localStorage.setItem('infinityLocalDB', JSON.stringify(localDB));
  updateStatsUI();
}

/* ── AI Helper (Together AI) ── */
async function callTogetherAI(systemPrompt, userPrompt) {
  const apiKey = localDB.settings.togetherApiKey;
  if (!apiKey) {
    showToast("⚠️ Введите API ключ Together AI в настройках!");
    return null;
  }
  
  try {
    const res = await fetch("https://api.together.xyz/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "meta-llama/Llama-3-8b-chat-hf", // Бесплатная, быстрая модель
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.5
      })
    });
    
    if (!res.ok) throw new Error(`API Error: ${res.status}`);
    const data = await res.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("AI Error:", error);
    showToast("Ошибка ИИ. Проверьте API ключ или подключение.");
    return null;
  }
}

/* ── Папки (добавлена папка Smart Notes) ── */
let folders = [
  { id:'smart_notes', name:'Smart Notes', emoji:'🧠', accent:'#ff9800', bg:'rgba(255,152,0,.1)', protected:true, autoTypes:['smart_note'] },
  { id:'texts',     name:'Texts',     emoji:'📝', accent:'#a078ff', bg:'rgba(160,120,255,.1)',  protected:true,  autoTypes:['text'] },
  { id:'documents', name:'Documents', emoji:'📄', accent:'#5b8cff', bg:'rgba(91,140,255,.1)',   protected:true,  autoTypes:['document','audio','voice'] },
  { id:'media',     name:'Media',     emoji:'🖼️', accent:'#00d98a', bg:'rgba(0,217,138,.1)',    protected:true,  autoTypes:['photo','video','animation','video_note'] }
];

const esc = s => (s || '').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/* ══════════════════════════════════════════════════════════
   INIT & DATA LOADING
══════════════════════════════════════════════════════════ */
async function initApp() {
  // Установка данных пользователя
  const userNameEl = document.getElementById('userName');
  const userAvatarEl = document.getElementById('userAvatar');
  if (userNameEl) userNameEl.innerText = user?.first_name || 'Bekhruz';
  if (userAvatarEl) userAvatarEl.innerText = (user?.first_name || 'B').charAt(0);

  // Настройки
  const apiKeyInput = document.getElementById('togetherApiKey');
  if (apiKeyInput) apiKeyInput.value = localDB.settings.togetherApiKey || '';
  
  // Геймификация стриков
  const today = new Date().toDateString();
  if (localDB.stats.lastLogin !== today) {
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (localDB.stats.lastLogin === yesterday) {
      localDB.stats.streak += 1;
    } else {
      localDB.stats.streak = 1;
    }
    localDB.stats.lastLogin = today;
    saveLocalDB();
  }
  updateStatsUI();
  
  // Загрузка
  await fetchServerFiles();
  renderFilesView();
  renderJournalFeed();
  
  const loader = document.getElementById('app-loader');
  if (loader) {
    setTimeout(() => loader.classList.add('hidden'), 400);
  }
}

function updateStatsUI() {
  const streakEl = document.getElementById('streakCounter');
  const wordsEl = document.getElementById('wordsCount');
  if (streakEl) streakEl.innerText = `🔥 ${localDB.stats.streak}`;
  if (wordsEl) wordsEl.innerText = localDB.stats.wordsWritten;
}

function saveSettings() {
  const apiKeyInput = document.getElementById('togetherApiKey');
  if (apiKeyInput) {
    localDB.settings.togetherApiKey = apiKeyInput.value.trim();
    saveLocalDB();
    showToast("Настройки сохранены");
  }
}

/* ── Получение файлов с сервера ── */
async function fetchServerFiles() {
  const uid = user?.id || '123456789';
  try {
    const resp = await fetch(`${API_URL}?user_id=${uid}&limit=100`);
    if (resp.ok) {
      const data = await resp.json();
      globalFiles = (data.files || []).map((f, i) => ({ ...f, internalId: `s_${i}` }));
      
      const totalCountEl = document.getElementById('totalFilesCount');
      if (totalCountEl) totalCountEl.innerText = globalFiles.length + localDB.notes.length;
    }
  } catch(e) { 
    console.error('Server fetch error:', e); 
  }
}

/* ── Получение ВСЕХ элементов (Сервер + LocalDB) ── */
function getAllItems() {
  const localNotes = localDB.notes.map(n => ({
    internalId: `l_${n.id}`, type: 'smart_note', text: n.text, title: n.title, tags: n.tags, date: n.date
  }));
  return [...globalFiles, ...localNotes];
}

/* ══════════════════════════════════════════════════════════
   УМНЫЕ ЗАМЕТКИ (SMART NOTES)
══════════════════════════════════════════════════════════ */
async function saveSmartNote() {
  const input = document.getElementById('smartNoteInput');
  const text = input?.value.trim();
  if (!text) return;
  
  if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
  input.value = '';
  showToast("Анализируем мысль...");
  
  // Обновляем статистику
  localDB.stats.wordsWritten += text.split(/\s+/).length;

  let title = "Заметка";
  let tags = [];
  
  if (localDB.settings.togetherApiKey) {
    const aiResp = await callTogetherAI(
      "Ты AI-ассистент. Проанализируй текст. Верни JSON строго в формате: {\"title\": \"Краткий заголовок\", \"tags\": [\"тег1\", \"тег2\"]}. Не пиши ничего кроме JSON.",
      text
    );
    try {
      if (aiResp) {
        const jsonMatch = aiResp.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          title = parsed.title || title;
          tags = parsed.tags || [];
        }
      }
    } catch(e) { 
      console.error("AI Parse error", e); 
    }
  }

  localDB.notes.unshift({ id: Date.now(), text, title, tags, date: new Date().toISOString() });
  saveLocalDB();
  
  const totalCountEl = document.getElementById('totalFilesCount');
  if (totalCountEl) totalCountEl.innerText = getAllItems().length;
  
  showToast("Заметка сохранена!");
  if (activeFolder === 'smart_notes') renderFolderContents();
}

/* ══════════════════════════════════════════════════════════
   ДНЕВНИК И РЕФЛЕКСИЯ
══════════════════════════════════════════════════════════ */
let currentMood = '😐';
function setMood(m) {
  currentMood = m;
  document.querySelectorAll('.journal-mood-selector button').forEach(b => {
    b.classList.toggle('selected', b.innerText.trim() === m);
  });
  if (tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
}

async function saveJournal() {
  const input = document.getElementById('journalInput');
  const text = input?.value.trim();
  if (!text) return;
  
  if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
  input.value = '';
  showToast("Генерируем рефлексию...");
  
  localDB.stats.wordsWritten += text.split(/\s+/).length;

  let aiComment = "Продолжайте вести записи, чтобы я мог лучше вас понимать.";
  
  if (localDB.settings.togetherApiKey) {
    const prompt = `Пользователь написал в дневник: "${text}". Настроение: ${currentMood}. Дай ОЧЕНЬ КРАТКИЙ (1-2 предложения) поддерживающий и психологичный комментарий, помоги подвести итог.`;
    const resp = await callTogetherAI("Ты эмпатичный психолог-коуч.", prompt);
    if (resp) aiComment = resp;
  }

  localDB.journal.unshift({ id: Date.now(), text, mood: currentMood, aiComment, date: new Date().toISOString() });
  saveLocalDB();
  renderJournalFeed();
  showToast("Запись сохранена!");
}

function renderJournalFeed() {
  const feed = document.getElementById('journalFeed');
  if (!feed) return;
  
  feed.innerHTML = localDB.journal.map(j => `
    <div class="journal-entry">
      <div class="journal-entry-header">
        <span>${new Date(j.date).toLocaleDateString()} ${new Date(j.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
        <span style="font-size:16px;">${j.mood}</span>
      </div>
      <div style="font-size: 14px; line-height: 1.5; color: #fff;">${esc(j.text)}</div>
      ${j.aiComment ? `<div class="journal-ai-comment">✨ ${esc(j.aiComment)}</div>` : ''}
    </div>
  `).join('');
}

/* ══════════════════════════════════════════════════════════
   ЧАТ СО ВТОРЫМ МОЗГОМ (RAG)
══════════════════════════════════════════════════════════ */
async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const q = input?.value.trim();
  if (!q) return;
  input.value = '';
  
  appendChatMsg(q, 'user');
  
  if (!localDB.settings.togetherApiKey) {
    appendChatMsg("Для работы чата укажите API ключ в настройках профиля.", 'ai');
    return;
  }

  const contextData = [
    ...localDB.notes.slice(0, 10).map(n => `ЗАМЕТКА: ${n.title} - ${n.text}`),
    ...localDB.journal.slice(0, 5).map(j => `ДНЕВНИК: ${j.text}`)
  ].join('\n\n');

  const system = `Ты AI-клон пользователя (Second Brain). Отвечай на вопросы пользователя ОПИРАЯСЬ ИСКЛЮЧИТЕЛЬНО на предоставленный ниже контекст из его заметок и дневника. Если информации нет - так и скажи. Отвечай кратко и емко. \n\nКОНТЕКСТ:\n${contextData}`;
  
  appendChatMsg("⏳ <i>Думаю...</i>", 'ai', 'temp-loader');
  
  const resp = await callTogetherAI(system, q);
  
  const loader = document.getElementById('temp-loader');
  if (loader) loader.remove();
  
  appendChatMsg(resp ? esc(resp) : "Произошла ошибка генерации ответа.", 'ai');
}

function appendChatMsg(text, sender, id = '') {
  const c = document.getElementById('chatContainer');
  if (!c) return;
  const div = document.createElement('div');
  div.className = `chat-msg ${sender}`;
  if (id) div.id = id;
  // Используем innerHTML для поддержки курсива загрузки, но для ответов ИИ экранируем текст
  div.innerHTML = text; 
  c.appendChild(div);
  c.scrollTop = c.scrollHeight;
}

function handleChatKey(e) { 
  if(e.key === 'Enter') sendChatMessage(); 
}

/* ══════════════════════════════════════════════════════════
   3D BRAIN MAP (Карта мыслей)
══════════════════════════════════════════════════════════ */
function openBrainMap() {
  const modal = document.getElementById('brainMapModal');
  const container = document.getElementById('3d-graph');
  if (!modal || !container) return;
  
  modal.classList.add('active');
  container.innerHTML = '';
  
  if (localDB.notes.length === 0) {
    container.innerHTML = "<div style='color:white; text-align:center; padding-top: 50vh;'>Добавьте пару умных заметок для создания связей.</div>";
    return;
  }

  const nodes = [];
  const links = [];
  
  localDB.notes.forEach(n => {
    nodes.push({ id: n.id, name: n.title || 'Заметка', val: 2, color: '#5b8cff' });
    (n.tags || []).forEach(tag => {
      let tNode = nodes.find(x => x.id === `tag_${tag}`);
      if (!tNode) {
        tNode = { id: `tag_${tag}`, name: `#${tag}`, val: 1, color: '#00d98a' };
        nodes.push(tNode);
      }
      links.push({ source: n.id, target: tNode.id });
    });
  });

  if (typeof ForceGraph3D === 'function') {
    ForceGraph3D()(container)
      .graphData({ nodes, links })
      .nodeLabel('name')
      .nodeColor('color')
      .nodeVal('val')
      .backgroundColor('#020204')
      .linkColor(() => 'rgba(255,255,255,0.2)');
  } else {
    container.innerHTML = "<div style='color:white; text-align:center; padding-top: 50vh;'>Библиотека 3D Graph не загружена.</div>";
  }
}

function closeBrainMap() {
  const modal = document.getElementById('brainMapModal');
  if (modal) modal.classList.remove('active');
}

/* ══════════════════════════════════════════════════════════
   ЭКСПОРТ / ИМПОРТ
══════════════════════════════════════════════════════════ */
function exportData() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(localDB));
  const dl = document.createElement('a');
  dl.setAttribute("href", dataStr);
  dl.setAttribute("download", "infinity_backup.json");
  dl.click();
  showToast("Бэкап скачан");
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (imported.notes) {
        localDB = { ...localDB, ...imported }; // Сохраняем структуру
        saveLocalDB();
        showToast("База данных восстановлена!");
        setTimeout(() => location.reload(), 1000);
      } else {
        showToast("Неверный формат файла");
      }
    } catch (err) {
      showToast("Ошибка импорта файла");
    }
  };
  reader.readAsText(file);
}

/* ══════════════════════════════════════════════════════════
   UI FILES & FOLDERS
══════════════════════════════════════════════════════════ */
function renderFilesView() {
  updateTopbar();
  const gridView = document.getElementById('folderGridView');
  const contentsView = document.getElementById('folderContentsView');
  
  if (!gridView || !contentsView) return;

  if (activeFolder === null) {
    gridView.style.display = '';
    contentsView.style.display = 'none';
    renderFolderGrid();
  } else {
    gridView.style.display = 'none';
    contentsView.style.display = '';
    renderFolderContents();
  }
}

function updateTopbar() {
  const bar = document.getElementById('filesTopbar');
  if (!bar) return;
  
  if (activeFolder === null) {
    bar.innerHTML = `<span class="files-topbar-title">Folders</span>`;
  } else {
    const fd = folders.find(f => f.id === activeFolder);
    bar.innerHTML = `
      <button class="icon-btn" style="width:34px;height:34px;" onclick="closeFolder()">
        <svg class="svg-icon" viewBox="0 0 24 24" style="width:18px;"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="files-topbar-title">${esc(fd?.name || 'Folder')}</span>`;
  }
}

function renderFolderGrid() {
  const grid = document.getElementById('folderGrid');
  if (!grid) return;
  
  const items = getAllItems();
  grid.innerHTML = folders.map(fd => {
    const count = items.filter(i => fd.autoTypes.includes(i.type)).length;
    return `
    <div class="folder-card" onclick="openFolder('${fd.id}')">
      <div class="folder-card-icon" style="background:${fd.bg}">${fd.emoji}</div>
      <div class="folder-card-name" style="margin-top:auto;">${esc(fd.name)}</div>
      <div class="folder-card-count">${count} items</div>
    </div>`;
  }).join('');
}

function renderFolderContents() {
  const gallery = document.getElementById('folderGallery');
  if (!gallery) return;
  
  const fd = folders.find(x => x.id === activeFolder);
  if (!fd) return;
  
  const q = searchQuery.toLowerCase();
  
  const files = getAllItems().filter(f => {
    if (!fd.autoTypes.includes(f.type)) return false;
    if (q && !(f.text||'').toLowerCase().includes(q) && !(f.title||'').toLowerCase().includes(q)) return false;
    return true;
  });

  gallery.innerHTML = files.length ? '' : `<div style="grid-column:1/-1; color:var(--text-muted); text-align:center; padding:20px;">Пусто</div>`;
  
  files.forEach(f => {
    const card = document.createElement('div');
    card.className = `grid-item ${f.type}`;
    
    if (f.type === 'smart_note') {
      card.style.background = 'linear-gradient(145deg, #14121f, #09080f)';
      card.innerHTML = `<div class="text-card-body">
        <b style="color:var(--blue);font-family:'Outfit',sans-serif;">${esc(f.title)}</b><br><br>
        ${esc(f.text)}
      </div>`;
      card.onclick = () => { if (tg.showAlert) tg.showAlert(f.text); else alert(f.text); };
    } else if (f.type === 'photo' && f.url) {
      card.innerHTML = `<img src="${f.url}" loading="lazy">`;
      card.onclick = () => openModal(f);
    } else if (f.type === 'text') {
      card.innerHTML = `<div class="text-card-body">${esc(f.text)}</div>`;
    } else {
      card.innerHTML = `<div style="padding:15px;text-align:center;color:white;font-size:12px;display:flex;align-items:center;height:100%;justify-content:center;">${esc(f.type)}</div>`;
    }
    gallery.appendChild(card);
  });
}

function openFolder(fid) { 
  activeFolder = fid; 
  renderFilesView(); 
  if (tg.HapticFeedback) tg.HapticFeedback.selectionChanged(); 
}

function closeFolder() { 
  activeFolder = null; 
  renderFilesView(); 
  if (tg.HapticFeedback) tg.HapticFeedback.selectionChanged(); 
}

function handleSearch() { 
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchQuery = searchInput.value; 
  if (activeFolder !== null) renderFolderContents(); 
}

/* ── Навигация и утилиты ── */
function switchTab(tabId, navBtn) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  const tab = document.getElementById('tab-' + tabId);
  if (tab) tab.classList.add('active');
  
  if (navBtn) { 
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active')); 
    navBtn.classList.add('active'); 
  }
  window.scrollTo(0, 0);
  if (tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
}

function openModal(file) {
  const content = document.getElementById('modalContent');
  const modal = document.getElementById('mediaModal');
  if (!content || !modal) return;
  
  content.innerHTML = `<img src="${esc(file.url)}" style="max-width:100%; border-radius:14px;">`;
  modal.classList.add('active');
}

function closeModal() { 
  const modal = document.getElementById('mediaModal');
  if (modal) modal.classList.remove('active'); 
}

function showToast(msg) {
  const box = document.getElementById('toast-box');
  if (!box) return;
  const t = document.createElement('div'); 
  t.className = 'toast'; 
  t.textContent = msg;
  box.appendChild(t); 
  setTimeout(() => t.remove(), 3000);
}

/* ── Заглушки для UI-элементов из HTML, которые вызывали ошибки ── */
function msBatchMove() { showToast("Функция перемещения в разработке"); }
function msBatchDelete() { showToast("Функция удаления в разработке"); }
function exitMultiSelect() { 
  const ms = document.getElementById('multiselectBar');
  if(ms) ms.style.display = 'none'; 
}
function closeSheet() {
  const sheet = document.getElementById('actionSheet');
  const overlay = document.getElementById('sheetOverlay');
  if(sheet) sheet.classList.remove('active');
  if(overlay) overlay.classList.remove('active');
}

window.addEventListener('DOMContentLoaded', initApp);
