import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Твоя конфигурация Firebase
const firebaseConfig = {
    apiKey: "AIzaSyBOeZ7TxoI1IHBUN78H18tv_twHtEoIrGA",
    authDomain: "infinity-storage-a3f47.firebaseapp.com",
    projectId: "infinity-storage-a3f47",
    storageBucket: "infinity-storage-a3f47.firebasestorage.app",
    messagingSenderId: "224300518868",
    appId: "1:224300518868:web:6472251977d194fc1eda41",
    measurementId: "G-SWVVC7JMGL"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

const userId = tg.initDataUnsafe?.user?.id?.toString() || "test_user";

let allFiles = [];
let currentFilter = 'all';
let searchQuery = '';
let displayedCount = 0;
const itemsPerPage = 15;

// Init Telegram Profile
function initProfile() {
    const user = tg.initDataUnsafe?.user;
    if (user) {
        document.getElementById('profileName').textContent = user.first_name + (user.last_name ? ` ${user.last_name}` : '');
        document.getElementById('profileUsername').textContent = user.username ? `@${user.username}` : '';
        document.getElementById('profileAvatar').src = user.photo_url || `https://ui-avatars.com/api/?name=${user.first_name}&background=random`;
    }
}

// Navigation Logic
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        
        const targetId = e.currentTarget.dataset.target;
        e.currentTarget.classList.add('active');
        document.getElementById(targetId).classList.add('active');
        
        tg.HapticFeedback.selectionChanged();
        if (targetId === 'profileView') document.getElementById('statFilesCount').textContent = allFiles.length;
    });
});

// Cache Check
const cachedData = localStorage.getItem('my_files_cache');
if (cachedData) {
    allFiles = JSON.parse(cachedData);
    applyFiltersAndRender(true);
}

// Fetch from Firebase via Bot
async function fetchCloudData() {
    try {
        const requestRef = await addDoc(collection(db, 'bot_requests'), {
            action: 'get_files', user_id: userId, status: 'pending', timestamp: serverTimestamp()
        });

        const unsubscribe = onSnapshot(doc(db, 'bot_requests', requestRef.id), (docSnap) => {
            const data = docSnap.data();
            if (data && data.status === 'completed') {
                unsubscribe();
                allFiles = data.result;
                localStorage.setItem('my_files_cache', JSON.stringify(data.result));
                applyFiltersAndRender(true);
            }
        });
    } catch (error) {
        console.error("Network Error:", error);
    }
}

// Filters & Search
function applyFiltersAndRender(reset = false) {
    if (reset) {
        displayedCount = 0;
        document.getElementById('filesGrid').innerHTML = '';
    }

    const filteredFiles = allFiles.filter(item => {
        const matchFilter = currentFilter === 'all' || item.type === currentFilter;
        const contentStr = (item.content || "").toLowerCase();
        const matchSearch = contentStr.includes(searchQuery.toLowerCase());
        return matchFilter && matchSearch;
    });

    const itemsToRender = filteredFiles.slice(displayedCount, displayedCount + itemsPerPage);
    renderItemsToDOM(itemsToRender);
    displayedCount += itemsToRender.length;

    document.getElementById('loadMoreTrigger').style.display = displayedCount >= filteredFiles.length ? 'none' : 'block';
}

document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    applyFiltersAndRender(true);
});

document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.dataset.filter;
        applyFiltersAndRender(true);
    });
});

// Render
function renderItemsToDOM(items) {
    const filesGrid = document.getElementById('filesGrid');

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'file-card';
        const deleteBtn = `<button class="delete-btn" onclick="event.stopPropagation(); deleteFile('${item.id}')"><i class="ph ph-trash"></i></button>`;

        let contentHtml = '';
        if (item.type === 'photo' && item.url) {
            contentHtml = `${deleteBtn}<img src="${item.url}" onerror="this.onerror=null; this.src='https://via.placeholder.com/150?text=Expired'; clearCacheAndRefresh();" style="width:100%; border-radius:8px;">`;
            if (item.content) contentHtml += `<div class="card-title" style="margin-top:8px;">${item.content}</div>`;
        } else {
            contentHtml = `${deleteBtn}<div class="note-card card-title">${item.content || 'Note'}</div>`;
        }

        card.innerHTML = contentHtml;
        card.onclick = async () => {
            tg.HapticFeedback.impactOccurred('medium');
            await addDoc(collection(db, 'bot_requests'), {
                action: 'send_file_to_chat', user_id: userId, file_id: item.file_id, type: item.type, content: item.content, status: 'pending', timestamp: serverTimestamp()
            });
            tg.close();
        };
        filesGrid.appendChild(card);
    });
}

// Delete Logic
window.deleteFile = async function(docId) {
    tg.showConfirm("Are you sure you want to delete this file forever?", async (agreed) => {
        if (agreed) {
            allFiles = allFiles.filter(f => f.id !== docId);
            applyFiltersAndRender(true);
            await addDoc(collection(db, 'bot_requests'), {
                action: 'delete_file', user_id: userId, doc_id: docId, status: 'pending', timestamp: serverTimestamp()
            });
            tg.HapticFeedback.notificationOccurred('success');
        }
    });
};

// Utils
window.clearCacheAndRefresh = function() {
    localStorage.removeItem('my_files_cache');
    fetchCloudData();
};

const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) applyFiltersAndRender(false);
}, { threshold: 1.0 });
observer.observe(document.getElementById('loadMoreTrigger'));

initProfile();
fetchCloudData();
