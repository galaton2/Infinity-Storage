// Импорт Firebase (убедись, что эти функции импортированы у тебя в начале файла)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- Твоя конфигурация Firebase ---
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

// Инициализация Telegram WebApp
const tg = window.Telegram.WebApp;
tg.expand();
const userId = tg.initDataUnsafe?.user?.id?.toString() || "test_user";

// --- Логика приложения ---

// 1. Пытаемся сразу показать кэш
const cachedData = localStorage.getItem('my_files_cache');
if (cachedData) {
    renderMemoryItems(JSON.parse(cachedData));
}

// 2. Основная функция получения данных
async function fetchCloudData() {
    console.log("📡 Запрос к боту...");
    
    try {
        // Создаем запрос
        const requestRef = await addDoc(collection(db, 'bot_requests'), {
            action: 'get_files',
            user_id: userId,
            status: 'pending',
            timestamp: serverTimestamp()
        });

        // Слушаем ответ
        const unsubscribe = onSnapshot(doc(db, 'bot_requests', requestRef.id), (docSnap) => {
            const data = docSnap.data();
            
            if (data && data.status === 'completed') {
                unsubscribe(); // Перестаем слушать
                
                // Сохраняем в кэш и рисуем
                localStorage.setItem('my_files_cache', JSON.stringify(data.result));
                renderMemoryItems(data.result);
            }
        });

        // Таймер: если через 8 секунд ответа нет и кэша тоже нет — показываем ошибку
        setTimeout(() => {
            if (!localStorage.getItem('my_files_cache')) {
                const grid = document.getElementById('filesGrid');
                grid.innerHTML = '<div style="color:red; text-align:center;">Бот спит или нет сети. Запусти bot.py</div>';
            }
        }, 8000);

    } catch (error) {
        console.error("Ошибка сети:", error);
    }
}

// 3. Функция отрисовки
function renderMemoryItems(items) {
    const filesGrid = document.getElementById('filesGrid');
    if (!filesGrid) return;
    
    filesGrid.innerHTML = ''; 

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'file-card';
        
        let contentHtml = '';
        if (item.type === 'photo' && item.url) {
            // При ошибке загрузки (протухла ссылка) вызываем функцию очистки кэша
            contentHtml = `<img src="${item.url}" 
                onerror="this.onerror=null; this.src='https://via.placeholder.com/150?text=Expired'; clearCacheAndRefresh();" 
                style="width:100%; border-radius:8px;">`;
        } else {
            contentHtml = `<div class="note-card">${item.content || 'Заметка'}</div>`;
        }

        card.innerHTML = contentHtml;
        
        // Клик для отправки файла в чат
        card.onclick = async () => {
            tg.HapticFeedback.impactOccurred('medium');
            await addDoc(collection(db, 'bot_requests'), {
                action: 'send_file_to_chat',
                user_id: userId,
                file_id: item.file_id,
                type: item.type,
                content: item.content,
                status: 'pending',
                timestamp: serverTimestamp()
            });
            tg.close();
        };
        
        filesGrid.appendChild(card);
    });
}

// 4. Очистка кэша при сбоях
window.clearCacheAndRefresh = function() {
    console.log("Ссылочки протухли, чистим кэш...");
    localStorage.removeItem('my_files_cache');
};

// Запуск
fetchCloudData();
