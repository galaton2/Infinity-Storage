// ВАЖНО: Обнови первую строку импортов Firebase вот так:
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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

const user = tg.initDataUnsafe?.user;
const userId = user?.id?.toString() || "test_user";

// ... (Тут код вставки имени и аватарки оставляем как был) ...
// ... (Функция renderMemoryItems(items) тоже остается ТОЧНО такой же, как в прошлом шаге) ...

// ================= НОВАЯ ЛОГИКА СВЯЗИ ЧЕРЕЗ FIREBASE =================
async function fetchCloudData() {
    const filesGrid = document.getElementById('filesGrid');
    if (!filesGrid) return;
    
    filesGrid.innerHTML = '<div style="text-align: center; color: #6e7787; padding: 40px 0;">Связь с ботом... 📡</div>';

    try {
        // 1. Бросаем "письмо" в ящик: создаем запрос к боту
        const requestRef = await addDoc(collection(db, 'bot_requests'), {
            user_id: userId,
            status: 'pending',
            timestamp: serverTimestamp()
        });

        // 2. Ждем ответа (слушаем изменения именно в этом документе)
        const unsubscribe = onSnapshot(doc(db, 'bot_requests', requestRef.id), (docSnap) => {
            const data = docSnap.data();
            
            // Если бот обработал запрос и изменил статус на 'completed'
            if (data && data.status === 'completed') {
                unsubscribe(); // Отписываемся, ответ получен
                renderMemoryItems(data.result); // Рисуем карточки!
            }
        });

        // 3. Защита от зависания (если бот выключен на ноуте)
        setTimeout(() => {
            unsubscribe();
            if (filesGrid.innerHTML.includes('Связь с ботом')) {
                filesGrid.innerHTML = `<div style="text-align: center; color: #ff4d4d; padding: 40px 0;">Бот спит. Запусти bot.py на компьютере.</div>`;
            }
        }, 15000); // Ждем максимум 15 секунд

    } catch (error) {
        console.error("Ошибка связи:", error);
        filesGrid.innerHTML = `<div style="text-align: center; color: #ff4d4d; padding: 40px 0;">Ошибка БД. Проверь правила Firestore.</div>`;
    }
}

fetchCloudData();
