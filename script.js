// Инициализация Telegram Web App
const tg = window.Telegram.WebApp;
tg.expand(); // Открываем на весь экран

const galleryContainer = document.getElementById('gallery-container');
const loader = document.getElementById('loader');
const statusText = document.getElementById('status-text');

// Модальное окно
const modal = document.getElementById('photo-modal');
const modalImage = document.getElementById('modal-image');
const deleteBtn = document.getElementById('delete-btn');

let currentActivePhotoUrl = null; // Запоминаем, какое фото открыто

async function fetchFiles() {
    // Получаем ID пользователя из Telegram. Если тестируем в браузере - ставим заглушку.
    const userId = tg.initDataUnsafe?.user?.id || '8597789604'; 
    
    // Твоя боевая ссылка на Synology API
    const apiUrl = `https://galaxylab.i234.me:8443/api/files?user_id=${userId}`;

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.status === 'success' && data.files.length > 0) {
            renderGallery(data.files);
        } else {
            showEmptyState();
        }
    } catch (error) {
        statusText.innerText = "❌ Ошибка подключения к серверу";
        console.error("Ошибка:", error);
    }
}

function renderGallery(files) {
    // Прячем скелетную загрузку, показываем галерею
    loader.style.display = 'none';
    galleryContainer.style.display = 'block';
    galleryContainer.innerHTML = ''; // Очищаем контейнер
    statusText.innerText = `Найдено файлов: ${files.length}`;

    files.forEach(file => {
        if (file.type === 'photo') {
            const item = document.createElement('div');
            item.className = 'gallery-item';
            
            const img = document.createElement('img');
            img.src = file.url;
            img.loading = "lazy"; // Оптимизация: загружаем фото только когда докрутили до них
            
            // Клик по картинке открывает модальное окно
            img.onclick = () => openModal(file.url);
            
            item.appendChild(img);
            galleryContainer.appendChild(item);
        }
    });
}

function showEmptyState() {
    loader.style.display = 'none';
    statusText.innerText = "Архив пока пуст. Отправь фото боту!";
}

// === ЛОГИКА МОДАЛЬНОГО ОКНА ===

function openModal(imageUrl) {
    currentActivePhotoUrl = imageUrl;
    modalImage.src = imageUrl;
    modal.style.display = 'block';
    
    // Включаем тактильный отклик Telegram (вибрацию) при открытии фото
    tg.HapticFeedback.impactOccurred('light');
}

function closeModal() {
    modal.style.display = 'none';
    modalImage.src = "";
    currentActivePhotoUrl = null;
}

// Клик по кнопке "Удалить" внутри модального окна
deleteBtn.onclick = () => {
    // Вибрация Телеграма для подтверждения действия
    tg.HapticFeedback.notificationOccurred('warning');
    
    // ⚠️ ВАЖНО: Сейчас это удаляет фото только визуально из галереи. 
    // Чтобы фото удалилось из базы Synology, нам потом нужно будет 
    // дописать DELETE-запрос в Python.
    
    // Ищем картинку в DOM и удаляем её
    const images = document.querySelectorAll('.gallery-item img');
    images.forEach(img => {
        if (img.src === currentActivePhotoUrl) {
            img.parentElement.remove(); 
        }
    });

    closeModal();
    tg.showAlert("Фото удалено из интерфейса! (Для полного удаления с сервера скоро добавим функцию в Python)");
};

// Закрываем окно при клике мимо картинки
window.onclick = function(event) {
    if (event.target == modal) {
        closeModal();
    }
}

// Запускаем загрузку файлов при старте
fetchFiles();
