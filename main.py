"""
Infinity Storage — Telegram bot + API for the mini app.  (v3)

Запуск:   python main.py
Секреты и настройки: задаются непосредственно в этом файле main.py

Что внутри (коротко):
  * tenacity: экспоненциальный retry 1-2-4-8-16-32-60 с. для ВСЕХ обращений к Telegram и к AI API
  * getUpdates: тот же backoff (1→60 с., factor 2) + супервизор, который не даёт процессу упасть
  * безопасность: секреты из env, проверка Telegram initData (HMAC), подписанные ссылки на медиа
    (токен бота больше НЕ утекает в мини-апп), CORS только для мини-аппа, rate-limit
  * поиск (SQLite FTS5), теги, дедупликация, избранное, удаление/восстановление, экспорт
  * напоминания (RU/EN), статистика и streak, /ask по своим заметкам, AI-чат (Together/OpenAI/Anthropic/Gemini)
  * ежедневные бэкапы БД, graceful shutdown, /health
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import hmac
import html
import io
import json
import logging
import mimetypes
import os
import random
import re
import secrets
import sys
import time
from collections import OrderedDict, defaultdict, deque
from datetime import date, datetime, timedelta, timezone, tzinfo
from pathlib import Path
from urllib.parse import parse_qsl, urlparse

import aiohttp
import aiosqlite
from aiohttp import web
from aiogram import Bot, Dispatcher, F
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.client.session.middlewares.base import BaseRequestMiddleware
from aiogram.enums import ParseMode
from aiogram.exceptions import (
    TelegramBadRequest, TelegramForbiddenError, TelegramNetworkError, TelegramNotFound,
    TelegramRetryAfter, TelegramServerError, TelegramUnauthorizedError,
)
from aiogram.filters import Command, CommandStart
from aiogram.methods import GetUpdates
from aiogram.types import (
    BotCommand, BotCommandScopeDefault, BufferedInputFile, CallbackQuery, InlineKeyboardButton,
    InlineKeyboardMarkup, MenuButtonWebApp, Message, ReactionTypeEmoji, WebAppInfo,
)
from aiogram.utils.backoff import BackoffConfig
from tenacity import (
    AsyncRetrying, RetryCallState, retry, retry_if_exception, stop_after_attempt, stop_never,
    wait_exponential,
)


VERSION = "3.0"
START_TIME = time.time()
log = logging.getLogger("infinity")


BOT_TOKEN = "ВСТАВЬ_СЮДА_ТОКЕН_БОТА"
WEB_APP_URL = "https://galaton2.github.io/Infinity-Storage/"
CHANNEL_URL = "https://t.me/your_channel_link"
PORT = 8080
DB_PATH = "storage.db"
PUBLIC_BASE_URL = ""        # напр. https://bot.example.com (если за прокси)
DEFAULT_TZ = "UTC"

ALLOWED_USER_IDS = ""       # пусто = бот открыт для всех; например: "123456789,987654321"
ADMIN_IDS = ""              # например: "123456789"
# Пока app.js не шлёт initData — оставьте True. Потом можно поставить False.
ALLOW_LEGACY_USER_ID = True
INITDATA_MAX_AGE = 24 * 3600
MEDIA_URL_TTL = 6 * 3600

# Дополнительные разрешённые CORS-источники через запятую.
# Например: "https://example.com,https://another.example.com"
CORS_ORIGINS_EXTRA = ""
_origin = lambda u: f"{urlparse(u).scheme}://{urlparse(u).netloc}" if u else ""
CORS_ORIGINS = {_origin(WEB_APP_URL)}
CORS_ORIGINS.update(o.strip().rstrip("/") for o in CORS_ORIGINS_EXTRA.split(",") if o.strip())
CORS_ORIGINS.discard("")

# ── retry / backoff ──
RETRY_MAX_WAIT = 60
RETRY_JITTER = 0.25
TG_RETRY_ATTEMPTS = 6
AI_RETRY_ATTEMPTS = 4

# ── AI ──
AI_PROVIDER = "together"   # together | openai | anthropic | google
AI_MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo"
AI_API_KEY = ""            # ключ AI-провайдера; оставьте пустым, если AI не нужен
AI_BASE_URL = ""            # любой OpenAI-совместимый endpoint (необязательно)
AI_HISTORY_LIMIT = 12
AI_RATE_PER_MIN = 10
AI_AUTOTAG = True
AI_VISION_MODEL = ""
AI_SYSTEM_PROMPT = (
    "You are Infinity AI, a friendly and capable assistant built into a Telegram bot called "
    "Infinity Storage. Chat naturally about anything the user brings up. Always reply in the "
    "same language the user is writing in. Keep answers clear and reasonably concise."
)

# ── BLIP (тяжёлый, требует torch+transformers) — по умолчанию выключен ──
BLIP_MODEL_NAME = "Salesforce/blip-image-captioning-base"
BLIP_ENABLED = False

# ── бэкапы ──
BACKUP_DIR = Path("backups")
BACKUP_KEEP = 7

TG_DOWNLOAD_LIMIT = 20 * 1024 * 1024   # больше Bot API не отдаёт через getFile
PAGE_SIZE = 20
MAX_TEXT = 4096


# ════════════════════════════════════════════════════════════════════
# 1. LOGGING  (токены и ключи маскируются)
# ════════════════════════════════════════════════════════════════════
class _SecretFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True
        changed = False
        for secret in (BOT_TOKEN, AI_API_KEY):
            if secret and secret in msg:
                msg = msg.replace(secret, "***")
                changed = True
        if changed:
            record.msg, record.args = msg, ()
        return True


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    for handler in logging.getLogger().handlers:
        handler.addFilter(_SecretFilter())
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)   # не засоряем лог каждым GET


# ════════════════════════════════════════════════════════════════════
# 2. RETRY LAYER  (tenacity — экспоненциальная задержка 1, 2, 4, 8, 16, 32, 60 …)
# ════════════════════════════════════════════════════════════════════
class TransientHTTPError(Exception):
    """HTTP 429 / 5xx от внешнего API — имеет смысл повторить."""

    def __init__(self, status: int, retry_after: float | None = None, body: str = ""):
        super().__init__(f"HTTP {status}" + (f": {body[:200]}" if body else ""))
        self.status, self.retry_after = status, retry_after


class PermanentHTTPError(Exception):
    """HTTP 4xx (кроме 429) — повторять бессмысленно."""

    def __init__(self, status: int, body: str = ""):
        super().__init__(f"HTTP {status}: {body[:300]}")
        self.status = status


def is_transient(exc: BaseException) -> bool:
    # постоянные ошибки Telegram (bad request / forbidden / not found / bad token) — НЕ повторяем
    if isinstance(exc, (TelegramBadRequest, TelegramForbiddenError, TelegramNotFound, TelegramUnauthorizedError)):
        return False
    if isinstance(exc, (TelegramRetryAfter, TelegramNetworkError, TelegramServerError, TransientHTTPError)):
        return True
    return isinstance(exc, (aiohttp.ClientConnectionError, aiohttp.ServerTimeoutError, asyncio.TimeoutError, ConnectionError))


_exp_wait = wait_exponential(multiplier=1, min=1, max=RETRY_MAX_WAIT)   # 1, 2, 4, 8, 16, 32, 60, 60 …


def wait_strategy(rs: RetryCallState) -> float:
    exc = rs.outcome.exception() if rs.outcome else None
    if isinstance(exc, TelegramRetryAfter):                      # Telegram сам сказал, сколько ждать
        return float(exc.retry_after) + 0.5
    if isinstance(exc, TransientHTTPError) and exc.retry_after:  # заголовок Retry-After
        return min(float(exc.retry_after), RETRY_MAX_WAIT)
    return _exp_wait(rs) + random.uniform(0, RETRY_JITTER)


def _log_retry(rs: RetryCallState, label: str = "") -> None:
    exc = rs.outcome.exception() if rs.outcome else None
    what = label or getattr(rs.fn, "__qualname__", None) or "call"
    log.warning("retry #%d for %s in %.1fs — %s: %s", rs.attempt_number, what,
                rs.next_action.sleep if rs.next_action else 0, type(exc).__name__, str(exc)[:160])


def retry_policy(attempts: int | None = None, label: str = "") -> dict:
    """Общие настройки tenacity. attempts=None → повторять бесконечно."""
    return dict(
        retry=retry_if_exception(is_transient),
        wait=wait_strategy,
        stop=stop_after_attempt(attempts) if attempts else stop_never,
        before_sleep=lambda rs: _log_retry(rs, label),
        reraise=True,
    )


def backoff_delay(attempt: int) -> float:
    """Та же лесенка, но для ручных циклов (супервизор): 1, 2, 4, 8 … RETRY_MAX_WAIT."""
    return min(float(RETRY_MAX_WAIT), 2.0 ** max(0, attempt - 1))


class TelegramRetryMiddleware(BaseRequestMiddleware):
    """Оборачивает КАЖДЫЙ вызов Bot API (send_message, get_file, react, …) в tenacity-retry.
    getUpdates пропускаем: там свой backoff (BackoffConfig в start_polling)."""

    async def __call__(self, make_request, bot, method):
        if isinstance(method, GetUpdates):
            return await make_request(bot, method)
        async for attempt in AsyncRetrying(**retry_policy(TG_RETRY_ATTEMPTS, type(method).__name__)):
            with attempt:
                return await make_request(bot, method)
        raise RuntimeError("unreachable")


POLL_BACKOFF = BackoffConfig(min_delay=1.0, max_delay=float(RETRY_MAX_WAIT), factor=2.0, jitter=0.1)


# ════════════════════════════════════════════════════════════════════
# 3. I18N  (RU / EN)
# ════════════════════════════════════════════════════════════════════
S: dict[str, dict[str, str]] = {
    "en": {
        "start": "<b>INFINITY STORAGE</b>\n\n<i>Your digital extension.</i>\n\nForward any file, photo, video or note — it is saved permanently and searchable.\n\n"
                 "• <b>save a note: …</b> — quick note\n• <b>remind me in 2h to …</b> — reminder\n• /search, /recent, /random, /stats — find things\n• <b>AI Chat</b> — talk to an assistant; /ask — ask about your notes\n\n/help — all commands",
        "help": "<b>Commands</b>\n/search <i>text</i> — search everything (also #tags)\n/recent — latest items\n/notes — your notes\n/favs — favorites ⭐\n/random — resurface an old item\n"
                "/stats — statistics & streak\n/remind <i>2h call mom</i> — reminder (also: <i>tomorrow 9:00 …</i>, <i>18:30 …</i>, <i>25.12 10:00 …</i>)\n/reminders — your reminders\n"
                "/tz <i>Europe/Rome</i> — your timezone\n/ai · /stop · /reset — AI chat\n/ask <i>question</i> — AI answer based on your notes\n/export — download your data (JSON)\n/lang <i>ru|en</i> — language\n/wipe — delete ALL your data",
        "saved": "✅ <b>Saved!</b>", "saved_n": "✅ <b>{n} saved!</b>", "saved_hint": "Open <b>Infinity Data Base</b> to view.",
        "dup": "👌 Already saved — skipped.", "dup_n": "👌 {n} of {total} were already saved — skipped.",
        "note_saved": "✅ <b>Note saved!</b>", "note_prompt": "✏️ Sure — what should I note down?",
        "remind_usage": "⏰ Usage: <code>/remind 2h call mom</code>\nAlso: <code>in 30 min …</code>, <code>tomorrow 9:00 …</code>, <code>18:30 …</code>, <code>25.12 10:00 …</code>",
        "remind_set": "⏰ Reminder set for <b>{when}</b> ({tz}):\n{text}", "remind_fire": "⏰ <b>Reminder</b>\n{text}",
        "remind_cancelled": "Reminder cancelled.", "remind_none": "No active reminders.", "remind_list": "⏰ <b>Your reminders</b> ({tz})",
        "remind_limit": "Too many active reminders (max {n}).", "remind_past": "That time is in the past.",
        "ai_on": "🤖 AI Chat is on. Just type — /stop to turn it off.", "ai_off": "AI Chat is off. Back to saving mode.",
        "ai_nokey": "⚠️ AI chat isn't set up — set AI_API_KEY on the server.", "ai_fail": "Sorry, I couldn't get a response — please try again in a moment.",
        "ai_badkey": "⚠️ The AI provider rejected the API key. Check AI_API_KEY.", "ai_rate": "Slow down a little — AI limit is {n} messages per minute.",
        "ai_reset": "AI conversation history cleared.", "ask_usage": "Usage: <code>/ask what did I write about the trip?</code>",
        "ask_none": "I couldn't find anything relevant in your saved notes.", "search_usage": "Usage: <code>/search text</code> or <code>/search #tag</code>",
        "search_none": "Nothing found.", "expired": "This list expired — run the command again.", "empty": "Nothing here yet.",
        "t_search": "🔎 <b>Search:</b> {q}", "t_recent": "🕘 <b>Recent</b>", "t_notes": "📝 <b>Notes</b>", "t_favs": "⭐ <b>Favorites</b>", "page": "page {p}/{n}",
        "stats": "📊 <b>Your archive</b>\n\nItems: <b>{total}</b> · Favorites: <b>{favs}</b>\nThis week: <b>{week}</b> · Streak: <b>{streak}</b> 🔥\nStorage used: <b>{size}</b>\nSince: {since}\n\n{types}",
        "tz_set": "🕐 Timezone set: <b>{tz}</b>", "tz_bad": "Unknown timezone. Try <code>/tz Europe/Rome</code> or <code>/tz +3</code>", "tz_show": "🕐 Your timezone: <b>{tz}</b>\nChange: <code>/tz Europe/Rome</code>",
        "export_caption": "📦 Your data ({n} items)", "wipe_confirm": "⚠️ This permanently deletes <b>all</b> your saved items and reminders. Sure?",
        "wipe_done": "🧹 Everything deleted.", "cancelled": "Cancelled.", "deleted": "🗑 Deleted.", "restored": "↩️ Restored.", "gone": "Item not found.",
        "private": "🔒 This is a private bot.", "lang_set": "Language: English", "admin_only": "Admins only.", "backup_caption": "🗄 Database backup",
        "unknown_cmd": "Unknown command. /help", "save_fail": "⚠️ Couldn't save that — please try again.", "random_none": "Nothing saved yet.",
        "how": "<b>HOW IT WORKS</b>\n\n🔹 <b>Files</b> stay on Telegram servers; the bot stores only IDs.\n🔹 <b>Search</b> works on text, captions, names and #tags.\n"
               "🔹 <b>Reminders</b>: “remind me in 2h to …”.\n🔹 <b>Notes</b>: “save a note: …”.\n🔹 <b>Duplicates</b> are detected automatically.\n🔹 <b>Privacy</b>: /export and /wipe give you full control.",
        "b_open": "Open Archive", "b_ai_on": "🤖 AI Chat: ON — tap to exit", "b_ai_off": "🤖 Chat with AI", "b_channel": "Official Channel", "b_how": "How it works",
        "b_back": "← Back", "b_fav": "☆ Favorite", "b_unfav": "★ Favorited", "b_del": "🗑 Delete", "b_undo": "↩️ Undo", "b_cancel": "Cancel", "b_stats": "📊 Stats",
        "b_rem": "⏰ Reminders", "b_wipe": "Yes, delete everything", "b_search": "🔎 Search",
        "how_search": "Type <code>/search your words</code> (or <code>#tag</code>).",
    },
    "ru": {
        "start": "<b>INFINITY STORAGE</b>\n\n<i>Ваше цифровое продолжение.</i>\n\nПересылайте любые файлы, фото, видео или заметки — всё сохранится навсегда и будет искаться.\n\n"
                 "• <b>запиши: …</b> — быстрая заметка\n• <b>напомни через 2 часа …</b> — напоминание\n• /search, /recent, /random, /stats — найти и посмотреть\n• <b>AI-чат</b> — ассистент; /ask — вопрос по вашим заметкам\n\n/help — все команды",
        "help": "<b>Команды</b>\n/search <i>текст</i> — поиск по всему (и по #тегам)\n/recent — последние записи\n/notes — заметки\n/favs — избранное ⭐\n/random — случайная старая запись\n"
                "/stats — статистика и streak\n/remind <i>2h позвонить маме</i> — напоминание (или: <i>завтра 9:00 …</i>, <i>18:30 …</i>, <i>25.12 10:00 …</i>)\n/reminders — список напоминаний\n"
                "/tz <i>Europe/Moscow</i> — часовой пояс\n/ai · /stop · /reset — AI-чат\n/ask <i>вопрос</i> — ответ AI по вашим заметкам\n/export — выгрузка данных (JSON)\n/lang <i>ru|en</i> — язык\n/wipe — удалить ВСЕ данные",
        "saved": "✅ <b>Сохранено!</b>", "saved_n": "✅ <b>Сохранено: {n}!</b>", "saved_hint": "Откройте <b>Infinity Data Base</b>, чтобы посмотреть.",
        "dup": "👌 Уже сохранено — пропустил.", "dup_n": "👌 {n} из {total} уже были сохранены — пропустил.",
        "note_saved": "✅ <b>Заметка сохранена!</b>", "note_prompt": "✏️ Конечно — что записать?",
        "remind_usage": "⏰ Пример: <code>/remind 2h позвонить маме</code>\nТакже: <code>через 30 минут …</code>, <code>завтра 9:00 …</code>, <code>18:30 …</code>, <code>25.12 10:00 …</code>",
        "remind_set": "⏰ Напоминание на <b>{when}</b> ({tz}):\n{text}", "remind_fire": "⏰ <b>Напоминание</b>\n{text}",
        "remind_cancelled": "Напоминание отменено.", "remind_none": "Активных напоминаний нет.", "remind_list": "⏰ <b>Ваши напоминания</b> ({tz})",
        "remind_limit": "Слишком много активных напоминаний (максимум {n}).", "remind_past": "Это время уже прошло.",
        "ai_on": "🤖 AI-чат включён. Просто пишите — /stop чтобы выключить.", "ai_off": "AI-чат выключен. Снова режим сохранения.",
        "ai_nokey": "⚠️ AI-чат не настроен — задайте AI_API_KEY на сервере.", "ai_fail": "Не удалось получить ответ — попробуйте ещё раз через минуту.",
        "ai_badkey": "⚠️ AI-провайдер отклонил API-ключ. Проверьте AI_API_KEY.", "ai_rate": "Помедленнее — лимит AI: {n} сообщений в минуту.",
        "ai_reset": "История AI-диалога очищена.", "ask_usage": "Пример: <code>/ask что я писал про поездку?</code>",
        "ask_none": "В ваших заметках ничего подходящего не нашлось.", "search_usage": "Пример: <code>/search текст</code> или <code>/search #тег</code>",
        "search_none": "Ничего не найдено.", "expired": "Список устарел — вызовите команду ещё раз.", "empty": "Здесь пока пусто.",
        "t_search": "🔎 <b>Поиск:</b> {q}", "t_recent": "🕘 <b>Последние</b>", "t_notes": "📝 <b>Заметки</b>", "t_favs": "⭐ <b>Избранное</b>", "page": "стр. {p}/{n}",
        "stats": "📊 <b>Ваш архив</b>\n\nЗаписей: <b>{total}</b> · Избранных: <b>{favs}</b>\nЗа неделю: <b>{week}</b> · Streak: <b>{streak}</b> 🔥\nЗанято: <b>{size}</b>\nС нами с: {since}\n\n{types}",
        "tz_set": "🕐 Часовой пояс: <b>{tz}</b>", "tz_bad": "Неизвестный часовой пояс. Пример: <code>/tz Europe/Moscow</code> или <code>/tz +3</code>", "tz_show": "🕐 Ваш часовой пояс: <b>{tz}</b>\nИзменить: <code>/tz Europe/Moscow</code>",
        "export_caption": "📦 Ваши данные ({n} записей)", "wipe_confirm": "⚠️ Это навсегда удалит <b>все</b> ваши записи и напоминания. Уверены?",
        "wipe_done": "🧹 Всё удалено.", "cancelled": "Отменено.", "deleted": "🗑 Удалено.", "restored": "↩️ Восстановлено.", "gone": "Запись не найдена.",
        "private": "🔒 Это приватный бот.", "lang_set": "Язык: русский", "admin_only": "Только для админов.", "backup_caption": "🗄 Бэкап базы данных",
        "unknown_cmd": "Неизвестная команда. /help", "save_fail": "⚠️ Не удалось сохранить — попробуйте ещё раз.", "random_none": "Пока ничего не сохранено.",
        "how": "<b>КАК ЭТО РАБОТАЕТ</b>\n\n🔹 <b>Файлы</b> остаются на серверах Telegram; бот хранит только ID.\n🔹 <b>Поиск</b> работает по тексту, подписям, именам файлов и #тегам.\n"
               "🔹 <b>Напоминания</b>: «напомни через 2 часа …».\n🔹 <b>Заметки</b>: «запиши: …».\n🔹 <b>Дубликаты</b> определяются автоматически.\n🔹 <b>Приватность</b>: /export и /wipe — полный контроль.",
        "b_open": "Открыть архив", "b_ai_on": "🤖 AI-чат: ВКЛ — нажмите, чтобы выйти", "b_ai_off": "🤖 Чат с AI", "b_channel": "Официальный канал", "b_how": "Как это работает",
        "b_back": "← Назад", "b_fav": "☆ В избранное", "b_unfav": "★ В избранном", "b_del": "🗑 Удалить", "b_undo": "↩️ Вернуть", "b_cancel": "Отмена", "b_stats": "📊 Статистика",
        "b_rem": "⏰ Напоминания", "b_wipe": "Да, удалить всё", "b_search": "🔎 Поиск",
        "how_search": "Напишите <code>/search ваши слова</code> (или <code>#тег</code>).",
    },
}
TYPE_ICONS = {"text": "📝", "photo": "🖼", "video": "🎬", "document": "📄", "audio": "🎵",
              "voice": "🎙", "video_note": "⭕", "animation": "🎞"}
_lang_cache: dict[int, str] = {}


def tr(lang: str, key: str, **kw) -> str:
    text = S.get(lang, S["en"]).get(key) or S["en"][key]
    return text.format(**kw) if kw else text


def guess_lang(code: str | None) -> str:
    return "ru" if (code or "").lower()[:2] in ("ru", "uk", "be", "kk") else "en"


# ════════════════════════════════════════════════════════════════════
# 4. PURE HELPERS
# ════════════════════════════════════════════════════════════════════
esc = html.escape


def snippet(text: str | None, n: int = 70) -> str:
    t = re.sub(r"\s+", " ", text or "").strip()
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def chunk_text(text: str, size: int = 4000) -> list[str]:
    text = text or ""
    out: list[str] = []
    while len(text) > size:
        cut = text.rfind("\n", 0, size)
        cut = cut if cut > size // 2 else size
        out.append(text[:cut])
        text = text[cut:].lstrip("\n")
    out.append(text)
    return out


def human_size(n: int | float) -> str:
    n = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def extract_tags(text: str | None) -> str:
    found: list[str] = []
    for tag in re.findall(r"(?<!\w)#(\w{2,32})", (text or "").lower()):
        if tag not in found:
            found.append(tag)
    return " ".join(found[:10])


def _stem(w: str) -> str:
    """Дешёвая «морфология» для кириллицы: поездке/поездка → поезд*. Для латиницы оставляем как есть."""
    return w[: max(4, len(w) - 2)] if len(w) >= 5 and re.search(r"[а-яё]", w) else w


def fts_query(q: str, any_word: bool = False) -> str | None:
    words = re.findall(r"\w+", (q or "").lower())
    if any_word:
        words = [w for w in words if len(w) >= 3]
    terms = [f'"{_stem(w)}"*' for w in words[:8]]
    return (" OR " if any_word else " ").join(terms) if terms else None


def iso_utc(ts: str | None) -> str | None:
    """'2026-09-24 21:01:53' (SQLite, UTC) → '2026-09-24T21:01:53Z'."""
    return ts.replace(" ", "T") + "Z" if ts else None


def compute_streak(days: set[date], today: date) -> int:
    d = today if today in days else today - timedelta(days=1)
    n = 0
    while d in days:
        n += 1
        d -= timedelta(days=1)
    return n


class RateLimiter:
    """Скользящее окно: не более `limit` событий за `per` секунд на ключ."""

    def __init__(self, limit: int, per: float):
        self.limit, self.per = limit, per
        self.hits: dict = defaultdict(deque)

    def allow(self, key) -> bool:
        now = time.monotonic()
        dq = self.hits[key]
        while dq and dq[0] <= now - self.per:
            dq.popleft()
        if len(dq) >= self.limit:
            return False
        dq.append(now)
        if len(self.hits) > 20000:
            for k in [k for k, v in self.hits.items() if not v]:
                del self.hits[k]
        return True


class LRU(OrderedDict):
    def __init__(self, maxlen: int):
        super().__init__()
        self.maxlen = maxlen

    def put(self, key, value) -> None:
        self[key] = value
        self.move_to_end(key)
        while len(self) > self.maxlen:
            self.popitem(last=False)


# ── timezones ──
def parse_tz(s: str) -> tuple[tzinfo, str] | None:
    s = (s or "").strip()
    m = re.fullmatch(r"(?:utc|gmt)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?", s, re.I)
    if m:
        sign = 1 if m[1] == "+" else -1
        hh, mm = int(m[2]), int(m[3] or 0)
        if hh > 14 or mm > 59:
            return None
        name = f"UTC{m[1]}{hh:02d}:{mm:02d}"
        return timezone(sign * timedelta(hours=hh, minutes=mm), name), name
    if s.lower() in ("utc", "gmt", "z"):
        return timezone.utc, "UTC"
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(s), s
    except Exception:
        return None


def get_tz(name: str | None) -> tzinfo:
    for candidate in (name, DEFAULT_TZ):
        if candidate and (parsed := parse_tz(candidate)):
            return parsed[0]
    return timezone.utc


# ── "remind me …" time parser (RU/EN) ──
_UNIT = r"(?P<u>сек\w*|sec\w*|s|с|мин\w*|min\w*|m|м|час\w*|hour\w*|hr|h|ч|дн\w*|день|day\w*|d|д|нед\w*|week\w*|w)"
_REL = re.compile(rf"^\s*(?:in\s+|через\s+)?(?P<n>\d+(?:[.,]\d+)?)\s*{_UNIT}\b\.?\s*(?P<rest>.*)$", re.I | re.S)
_WORD = re.compile(r"^\s*(?P<w>today|tomorrow|сегодня|послезавтра|завтра)\b", re.I)
_ISO = re.compile(r"^\s*(?P<y>\d{4})-(?P<mo>\d{1,2})-(?P<d>\d{1,2})\b")
_DMY = re.compile(r"^\s*(?P<d>\d{1,2})\.(?P<mo>\d{1,2})(?:\.(?P<y>\d{2,4}))?(?!\d|:)")
_CLOCK = re.compile(r"^\s*(?P<pre>(?:at|в)\s+)?(?P<h>\d{1,2})(?::(?P<m>\d{2}))?\s*(?P<ap>am|pm)?(?![\w:])", re.I)
_LEAD = re.compile(r"^\s*(?:(?:to|that|что|чтобы)\b|[:\-–—,])\s*", re.I)


def _unit_delta(u: str, n: float) -> timedelta:
    u = u.lower()
    if u.startswith(("сек", "sec")) or u in ("s", "с"):
        return timedelta(seconds=n)
    if u.startswith(("мин", "min")) or u in ("m", "м"):
        return timedelta(minutes=n)
    if u.startswith(("час", "hour")) or u in ("h", "hr", "ч"):
        return timedelta(hours=n)
    if u.startswith(("дн", "ден", "day")) or u in ("d", "д"):
        return timedelta(days=n)
    return timedelta(weeks=n)


def _clean_rest(rest: str) -> str:
    return _LEAD.sub("", rest or "", count=1).strip()


def parse_when(text: str, tz: tzinfo, now: datetime | None = None) -> tuple[datetime, str] | None:
    """'in 2h call mom' / 'через 30 минут …' / 'tomorrow 9:00 …' / '18:30 …' / '25.12 10:00 …'
    → (момент в UTC, оставшийся текст) или None."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    text = (text or "").strip()

    if m := _REL.match(text):
        due = now + _unit_delta(m["u"], float(m["n"].replace(",", ".")))
        return due, _clean_rest(m["rest"])

    local_now = now.astimezone(tz)
    rest, base, had_date = text, None, False
    try:
        if m := _WORD.match(rest):
            offset = {"today": 0, "сегодня": 0, "tomorrow": 1, "завтра": 1, "послезавтра": 2}[m["w"].lower()]
            base, had_date, rest = local_now.date() + timedelta(days=offset), True, rest[m.end():]
        elif m := _ISO.match(rest):
            base, had_date, rest = date(int(m["y"]), int(m["mo"]), int(m["d"])), True, rest[m.end():]
        elif m := _DMY.match(rest):
            y = int(m["y"]) if m["y"] else local_now.year
            y += 2000 if y < 100 else 0
            base, had_date, rest = date(y, int(m["mo"]), int(m["d"])), True, rest[m.end():]
            if not m["y"] and base < local_now.date():
                base = date(y + 1, base.month, base.day)
    except ValueError:
        return None

    hour, minute = 9, 0
    cm = _CLOCK.match(rest)
    if cm and (cm["pre"] or cm["m"] or cm["ap"]):
        hour, minute = int(cm["h"]), int(cm["m"] or 0)
        if cm["ap"]:
            if not 1 <= hour <= 12:
                return None
            hour = hour % 12 + (12 if cm["ap"].lower() == "pm" else 0)
        if hour > 23 or minute > 59:
            return None
        rest, had_clock = rest[cm.end():], True
    else:
        had_clock = False
    if not had_date and not had_clock:
        return None

    if base is None:
        base = local_now.date()
    local_due = datetime(base.year, base.month, base.day, hour, minute, tzinfo=tz)
    if not had_date and local_due <= local_now:
        local_due += timedelta(days=1)
    return local_due.astimezone(timezone.utc), _clean_rest(rest)


# ════════════════════════════════════════════════════════════════════
# 5. DATABASE  (одно соединение, WAL, миграции, FTS5)
# ════════════════════════════════════════════════════════════════════
_FTS_COLS = "text_content, ai_caption, file_name, title, tags"


class Database:
    def __init__(self, path: str):
        self.path = path
        self.conn: aiosqlite.Connection | None = None
        self.has_fts = False
        self._wlock = asyncio.Lock()

    async def open(self) -> None:
        self.conn = await aiosqlite.connect(self.path, timeout=15)
        self.conn.row_factory = aiosqlite.Row
        for pragma in ("journal_mode=WAL", "synchronous=NORMAL", "busy_timeout=8000", "temp_store=MEMORY"):
            await self.conn.execute(f"PRAGMA {pragma}")
        await self._migrate()

    async def close(self) -> None:
        if self.conn:
            await self.conn.close()
            self.conn = None

    # ── primitives ──
    async def exec(self, sql: str, params=()) -> tuple[int | None, int]:
        async with self._wlock:
            cur = await self.conn.execute(sql, params)
            await self.conn.commit()
            return cur.lastrowid, cur.rowcount

    async def all(self, sql: str, params=()) -> list[dict]:
        async with self.conn.execute(sql, params) as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def one(self, sql: str, params=()) -> dict | None:
        async with self.conn.execute(sql, params) as cur:
            r = await cur.fetchone()
            return dict(r) if r else None

    async def scalar(self, sql: str, params=()):
        async with self.conn.execute(sql, params) as cur:
            r = await cur.fetchone()
            return r[0] if r else None

    # ── schema ──
    async def _migrate(self) -> None:
        c = self.conn
        await c.execute("""CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, message_id INTEGER, file_id TEXT,
            file_type TEXT, text_content TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)""")
        async with c.execute("PRAGMA table_info(files)") as cur:
            have = {r["name"] for r in await cur.fetchall()}
        for name, ddl in {
            "ai_caption": "TEXT", "file_unique_id": "TEXT", "file_name": "TEXT", "mime_type": "TEXT",
            "file_size": "INTEGER", "title": "TEXT", "tags": "TEXT DEFAULT ''",
            "favorite": "INTEGER DEFAULT 0", "deleted_at": "DATETIME",
        }.items():
            if name not in have:
                await c.execute(f"ALTER TABLE files ADD COLUMN {name} {ddl}")
        await c.execute("CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id, deleted_at, id DESC)")
        await c.execute("CREATE INDEX IF NOT EXISTS idx_files_uniq ON files(user_id, file_unique_id)")
        await c.execute("""CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY, lang TEXT, tz TEXT, ai_mode INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_seen DATETIME)""")
        await c.execute("""CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, chat_id INTEGER NOT NULL,
            text TEXT NOT NULL, due_at INTEGER NOT NULL, fired INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")
        await c.execute("CREATE INDEX IF NOT EXISTS idx_rem_due ON reminders(fired, due_at)")
        await self._setup_fts()
        await c.commit()

    async def _setup_fts(self) -> None:
        c = self.conn
        existed = await self.scalar("SELECT 1 FROM sqlite_master WHERE name='files_fts'")
        try:
            await c.execute(f"""CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
                {_FTS_COLS}, content='files', content_rowid='id', tokenize='unicode61 remove_diacritics 2')""")
            new_vals = ", ".join(f"new.{col.strip()}" for col in _FTS_COLS.split(","))
            old_vals = ", ".join(f"old.{col.strip()}" for col in _FTS_COLS.split(","))
            await c.execute(f"""CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
                INSERT INTO files_fts(rowid, {_FTS_COLS}) VALUES (new.id, {new_vals}); END""")
            await c.execute(f"""CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
                INSERT INTO files_fts(files_fts, rowid, {_FTS_COLS}) VALUES ('delete', old.id, {old_vals}); END""")
            await c.execute(f"""CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE OF {_FTS_COLS} ON files BEGIN
                INSERT INTO files_fts(files_fts, rowid, {_FTS_COLS}) VALUES ('delete', old.id, {old_vals});
                INSERT INTO files_fts(rowid, {_FTS_COLS}) VALUES (new.id, {new_vals}); END""")
            if not existed:
                await c.execute("INSERT INTO files_fts(files_fts) VALUES('rebuild')")   # индексируем старые записи
            self.has_fts = True
        except aiosqlite.OperationalError as e:
            log.warning("FTS5 unavailable, falling back to LIKE search: %s", e)
            self.has_fts = False

    # ── users ──
    async def touch_user(self, user_id: int, code: str | None) -> dict:
        row = await self.one("SELECT * FROM users WHERE user_id=?", (user_id,))
        if row is None:
            lang = guess_lang(code)
            await self.exec("INSERT OR IGNORE INTO users(user_id, lang, tz, last_seen) VALUES (?,?,?,CURRENT_TIMESTAMP)",
                            (user_id, lang, None))
            row = await self.one("SELECT * FROM users WHERE user_id=?", (user_id,))
        _lang_cache[user_id] = row["lang"] or "en"
        return row

    async def set_user(self, user_id: int, **fields) -> None:
        sets = ", ".join(f"{k}=?" for k in fields)
        await self.exec(f"UPDATE users SET {sets} WHERE user_id=?", (*fields.values(), user_id))
        if "lang" in fields:
            _lang_cache[user_id] = fields["lang"]

    async def ai_users(self) -> set[int]:
        return {r["user_id"] for r in await self.all("SELECT user_id FROM users WHERE ai_mode=1")}

    # ── files ──
    async def save_items(self, user_id: int, metas: list[dict]) -> list[dict]:
        """Сохраняет пачку в одной транзакции. Дубликаты (тот же file_unique_id) пропускает."""
        out: list[dict] = []
        async with self._wlock:
            try:
                for m in metas:
                    if m.get("file_unique_id"):
                        dup = await self.one(
                            "SELECT id FROM files WHERE user_id=? AND file_unique_id=? AND deleted_at IS NULL LIMIT 1",
                            (user_id, m["file_unique_id"]))
                        if dup:
                            out.append({**m, "id": dup["id"], "dup": True})
                            continue
                    cur = await self.conn.execute(
                        "INSERT INTO files (user_id, message_id, file_id, file_unique_id, file_type, text_content,"
                        " file_name, mime_type, file_size, tags) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (user_id, m.get("message_id"), m.get("file_id"), m.get("file_unique_id"), m["file_type"],
                         m.get("text", ""), m.get("file_name"), m.get("mime_type"), m.get("file_size"),
                         extract_tags(m.get("text"))))
                    out.append({**m, "id": cur.lastrowid, "dup": False})
                await self.conn.commit()
            except Exception:
                await self.conn.rollback()
                raise
        return out

    async def get_item(self, user_id: int, item_id: int, include_deleted: bool = False) -> dict | None:
        sql = "SELECT * FROM files WHERE id=? AND user_id=?" + ("" if include_deleted else " AND deleted_at IS NULL")
        return await self.one(sql, (item_id, user_id))

    async def list_files(self, user_id: int, *, q: str | None = None, ftype: str | None = None,
                         fav: bool = False, limit: int = PAGE_SIZE, offset: int = 0,
                         any_word: bool = False) -> tuple[list[dict], int]:
        flt, fparams = " AND f.user_id=? AND f.deleted_at IS NULL", [user_id]
        if ftype:
            flt += " AND f.file_type=?"; fparams.append(ftype)
        if fav:
            flt += " AND f.favorite=1"
        match = fts_query(q, any_word) if q else None
        if q and match and self.has_fts:
            base, params, order = ("FROM files_fts JOIN files f ON f.id = files_fts.rowid WHERE files_fts MATCH ?",
                                   [match], "ORDER BY bm25(files_fts), f.id DESC")
        elif q:
            like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            base = ("FROM files f WHERE (f.text_content LIKE ? ESCAPE '\\' OR f.ai_caption LIKE ? ESCAPE '\\' OR "
                    "f.file_name LIKE ? ESCAPE '\\' OR f.title LIKE ? ESCAPE '\\' OR f.tags LIKE ? ESCAPE '\\')")
            params, order = [like] * 5, "ORDER BY f.id DESC"
        else:
            base, params, order = "FROM files f WHERE 1=1", [], "ORDER BY f.id DESC"
        total = await self.scalar(f"SELECT COUNT(*) {base}{flt}", params + fparams) or 0
        rows = await self.all(f"SELECT f.* {base}{flt} {order} LIMIT ? OFFSET ?", params + fparams + [limit, offset])
        return rows, total

    async def random_item(self, user_id: int) -> dict | None:
        return await self.one("SELECT * FROM files WHERE user_id=? AND deleted_at IS NULL ORDER BY RANDOM() LIMIT 1", (user_id,))

    async def set_favorite(self, user_id: int, item_id: int, value: bool | None = None) -> bool | None:
        row = await self.get_item(user_id, item_id)
        if not row:
            return None
        new = (not row["favorite"]) if value is None else value
        await self.exec("UPDATE files SET favorite=? WHERE id=? AND user_id=?", (int(new), item_id, user_id))
        return new

    async def soft_delete(self, user_id: int, item_id: int) -> bool:
        _, n = await self.exec("UPDATE files SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND deleted_at IS NULL",
                               (item_id, user_id))
        return n > 0

    async def restore(self, user_id: int, item_id: int) -> bool:
        _, n = await self.exec("UPDATE files SET deleted_at=NULL WHERE id=? AND user_id=? AND deleted_at IS NOT NULL",
                               (item_id, user_id))
        return n > 0

    async def update_text(self, user_id: int, message_id: int, text: str) -> None:
        await self.exec("UPDATE files SET text_content=?, tags=? WHERE user_id=? AND message_id=? AND deleted_at IS NULL",
                        (text, extract_tags(text), user_id, message_id))

    async def set_enrichment(self, item_id: int, *, title: str | None = None, tags: str | None = None,
                             caption: str | None = None) -> None:
        if caption is not None:
            await self.exec("UPDATE files SET ai_caption=? WHERE id=?", (caption, item_id))
        if title is not None or tags is not None:
            row = await self.one("SELECT tags FROM files WHERE id=?", (item_id,))
            merged = " ".join(dict.fromkeys(((row or {}).get("tags") or "").split() + (tags or "").split()))
            await self.exec("UPDATE files SET title=COALESCE(?, title), tags=? WHERE id=?", (title, merged, item_id))

    async def stats(self, user_id: int, tz: tzinfo) -> dict:
        by_type = await self.all(
            "SELECT file_type, COUNT(*) AS c, COALESCE(SUM(file_size),0) AS s FROM files "
            "WHERE user_id=? AND deleted_at IS NULL GROUP BY file_type ORDER BY c DESC", (user_id,))
        total = sum(r["c"] for r in by_type)
        favs = await self.scalar("SELECT COUNT(*) FROM files WHERE user_id=? AND deleted_at IS NULL AND favorite=1", (user_id,)) or 0
        week = await self.scalar("SELECT COUNT(*) FROM files WHERE user_id=? AND deleted_at IS NULL AND timestamp >= datetime('now','-7 days')", (user_id,)) or 0
        since = await self.scalar("SELECT MIN(timestamp) FROM files WHERE user_id=? AND deleted_at IS NULL", (user_id,))
        stamps = await self.all("SELECT timestamp FROM files WHERE user_id=? AND deleted_at IS NULL AND timestamp >= datetime('now','-400 days')", (user_id,))
        days = set()
        for r in stamps:
            with contextlib.suppress(Exception):
                dt = datetime.strptime(r["timestamp"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
                days.add(dt.astimezone(tz).date())
        return {"total": total, "by_type": by_type, "favs": favs, "week": week, "since": since,
                "size": sum(r["s"] for r in by_type), "streak": compute_streak(days, datetime.now(tz).date())}

    async def top_tags(self, user_id: int, limit: int = 30) -> list[dict]:
        counts: dict[str, int] = defaultdict(int)
        for r in await self.all("SELECT tags FROM files WHERE user_id=? AND deleted_at IS NULL AND tags != '' LIMIT 5000", (user_id,)):
            for t in r["tags"].split():
                counts[t] += 1
        return [{"tag": t, "count": c} for t, c in sorted(counts.items(), key=lambda kv: -kv[1])[:limit]]

    async def export_rows(self, user_id: int) -> list[dict]:
        return await self.all(
            "SELECT id, file_type AS type, text_content AS text, ai_caption, title, tags, favorite, file_name, mime_type, "
            "file_size, file_id, file_unique_id, timestamp FROM files WHERE user_id=? AND deleted_at IS NULL ORDER BY id", (user_id,))

    async def wipe_user(self, user_id: int) -> int:
        _, n = await self.exec("DELETE FROM files WHERE user_id=?", (user_id,))
        await self.exec("DELETE FROM reminders WHERE user_id=?", (user_id,))
        return n

    async def purge_deleted(self, days: int = 30) -> int:
        _, n = await self.exec("DELETE FROM files WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)", (f"-{days} days",))
        return n

    # ── reminders ──
    async def add_reminder(self, user_id: int, chat_id: int, text: str, due_ts: int) -> int:
        rid, _ = await self.exec("INSERT INTO reminders(user_id, chat_id, text, due_at) VALUES (?,?,?,?)", (user_id, chat_id, text, due_ts))
        return rid

    async def active_reminders(self, user_id: int) -> list[dict]:
        return await self.all("SELECT * FROM reminders WHERE user_id=? AND fired=0 ORDER BY due_at LIMIT 50", (user_id,))

    async def due_reminders(self, now_ts: int) -> list[dict]:
        return await self.all("SELECT * FROM reminders WHERE fired=0 AND due_at<=? ORDER BY due_at LIMIT 50", (now_ts,))

    async def finish_reminder(self, rid: int) -> None:
        await self.exec("UPDATE reminders SET fired=1 WHERE id=?", (rid,))

    async def cancel_reminder(self, user_id: int, rid: int) -> bool:
        _, n = await self.exec("UPDATE reminders SET fired=1 WHERE id=? AND user_id=? AND fired=0", (rid, user_id))
        return n > 0

    async def backup_to(self, target: Path) -> None:
        async with self._wlock:
            await self.conn.execute("VACUUM INTO ?", (str(target),))


db = Database(DB_PATH)


# ════════════════════════════════════════════════════════════════════
# 6. RUNTIME OBJECTS
# ════════════════════════════════════════════════════════════════════
# 1. Initialize the session with the supported 'limit' argument
session = AiohttpSession(limit=100)

# 2. Update the internal connector configuration with TCPConnector arguments
session._connector_init.update({
    "ttl_dns_cache": 300,
    "keepalive_timeout": 15
})

# 3. Pass the properly configured session to the Bot
bot = Bot(
    token=BOT_TOKEN or "0:missing",
    session=session
)  # DNS-кэш 5 мин: переживает кратковременные сбои резолвера
dp = Dispatcher()

_tg_semaphore = asyncio.Semaphore(8)            # не больше 8 одновременных getFile/скачиваний
_bg_tasks: set[asyncio.Task] = set()
_http_session: aiohttp.ClientSession | None = None
_ai_mode_users: set[int] = set()
_ai_history: LRU = LRU(500)
_ai_limiter = RateLimiter(AI_RATE_PER_MIN, 60)
_browse: LRU = LRU(1000)
_album_buf: dict[str, list[Message]] = {}
_album_tasks: dict[str, asyncio.Task] = {}
_deny_notice = RateLimiter(1, 60)

NOTE_COMMAND_RE = re.compile(
    r"^(?:save(?:\s+(?:a|this))?\s+note|remember\s+this|note\s+(?:this|it)\s+down|"
    r"запиши(?:\s+(?:себе|мне))?(?:\s+заметку)?|сохрани(?:\s+(?:это|заметку))?|заметка)"
    r"\s*[:\-–—]?\s*", re.IGNORECASE)
REMIND_RE = re.compile(r"^(?:remind\s+me|напомни(?:\s+мне)?)\b\s*[:,\-–—]?\s*", re.IGNORECASE)


def spawn(coro, name: str | None = None) -> asyncio.Task:
    """create_task, который держит ссылку (иначе GC может убить задачу) и логирует ошибки."""
    task = asyncio.create_task(coro, name=name)
    _bg_tasks.add(task)

    def _done(t: asyncio.Task) -> None:
        _bg_tasks.discard(t)
        if not t.cancelled() and t.exception():
            log.error("background task %s failed: %r", t.get_name(), t.exception())

    task.add_done_callback(_done)
    return task


async def http() -> aiohttp.ClientSession:
    global _http_session
    if _http_session is None or _http_session.closed:
        _http_session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=60, sock_connect=15),
            connector=aiohttp.TCPConnector(ttl_dns_cache=300, keepalive_timeout=15, limit=100))
    return _http_session


# ════════════════════════════════════════════════════════════════════
# 7. AI  (Together / OpenAI-compatible / Anthropic / Gemini) — все запросы под tenacity
# ════════════════════════════════════════════════════════════════════
@retry(**retry_policy(AI_RETRY_ATTEMPTS, "AI API"))
async def _post_json(url: str, headers: dict, body: dict) -> dict:
    session = await http()
    async with session.post(url, json=body, headers=headers) as resp:
        text = await resp.text()
        if resp.status == 429 or resp.status >= 500:
            ra = resp.headers.get("Retry-After", "")
            raise TransientHTTPError(resp.status, float(ra) if re.fullmatch(r"\d+(\.\d+)?", ra) else None, text)
        if resp.status >= 400:
            raise PermanentHTTPError(resp.status, text)
        try:
            return json.loads(text)
        except ValueError:
            raise TransientHTTPError(502, None, "provider returned invalid JSON")


async def ai_complete(messages: list[dict], system: str | None = None, max_tokens: int = 700,
                      model: str | None = None) -> str:
    """Один запрос к выбранному AI-провайдеру. Кидает PermanentHTTPError / исключение после исчерпания retry."""
    system = AI_SYSTEM_PROMPT if system is None else system
    model = model or AI_MODEL
    if AI_PROVIDER in ("together", "openai") or AI_BASE_URL:
        url = (AI_BASE_URL.rstrip("/") + "/chat/completions") if AI_BASE_URL else (
            "https://api.together.xyz/v1/chat/completions" if AI_PROVIDER == "together"
            else "https://api.openai.com/v1/chat/completions")
        data = await _post_json(url, {"Authorization": f"Bearer {AI_API_KEY}", "Content-Type": "application/json"},
                                {"model": model, "temperature": 0.4, "max_tokens": max_tokens,
                                 "messages": [{"role": "system", "content": system}, *messages]})
        return (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    if AI_PROVIDER == "anthropic":
        data = await _post_json("https://api.anthropic.com/v1/messages",
                                {"x-api-key": AI_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
                                {"model": model, "max_tokens": max_tokens, "system": system, "messages": messages})
        return "".join(b.get("text", "") for b in data.get("content", [])).strip()
    if AI_PROVIDER in ("google", "gemini"):
        contents = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]} for m in messages]
        data = await _post_json(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                                {"x-goog-api-key": AI_API_KEY, "Content-Type": "application/json"},
                                {"systemInstruction": {"parts": [{"text": system}]}, "contents": contents,
                                 "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.4}})
        parts = (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [])
        return "".join(p.get("text", "") for p in parts).strip()
    raise PermanentHTTPError(0, f"unknown AI_PROVIDER {AI_PROVIDER!r}")


async def call_ai(user_id: int, user_text: str, lang: str) -> str:
    if not AI_API_KEY:
        return tr(lang, "ai_nokey")
    history = list(_ai_history.get(user_id) or [])
    messages = [*history, {"role": "user", "content": user_text}]
    try:
        reply = await ai_complete(messages)
    except PermanentHTTPError as e:
        log.error("AI permanent error: %s", e)
        return tr(lang, "ai_badkey") if e.status in (401, 403) else tr(lang, "ai_fail")
    except Exception as e:
        log.error("AI chat error after retries: %s: %s", type(e).__name__, e)
        return tr(lang, "ai_fail")
    if not reply:
        return tr(lang, "ai_fail")
    new_hist = [*messages, {"role": "assistant", "content": reply}][-AI_HISTORY_LIMIT:]
    while new_hist and new_hist[0]["role"] != "user":
        new_hist.pop(0)
    _ai_history.put(user_id, new_hist)        # неудачные запросы в историю не попадают
    return reply


async def enrich_note(item_id: int, text: str) -> None:
    """Фоново: AI придумывает заголовок и теги для заметки (как обещает мини-апп)."""
    prompt = ('Return ONLY compact JSON: {"title": "<max 6 words, same language as the note>", '
              '"tags": ["up to 4 lowercase single-word tags"]}\n\nNote:\n' + text[:1500])
    raw = await ai_complete([{"role": "user", "content": prompt}], system="You output only valid JSON.", max_tokens=120)
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        return
    data = json.loads(m.group(0))
    title = snippet(str(data.get("title") or ""), 80) or None
    tags = " ".join(t for t in (re.sub(r"\W", "", str(x).lower())[:32] for x in (data.get("tags") or [])[:5]) if len(t) >= 2)
    await db.set_enrichment(item_id, title=title, tags=tags)


# ── photo captions: vision-модель (без torch) или BLIP (опционально) ──
_blip = {"proc": None, "model": None}
_blip_lock = asyncio.Lock()


async def _ensure_blip() -> bool:
    if not BLIP_ENABLED:
        return False
    if _blip["model"] is not None:
        return True
    async with _blip_lock:
        if _blip["model"] is not None:
            return True

        def _load():
            from transformers import BlipForConditionalGeneration, BlipProcessor
            proc = BlipProcessor.from_pretrained(BLIP_MODEL_NAME)
            model = BlipForConditionalGeneration.from_pretrained(BLIP_MODEL_NAME)
            model.eval()
            return proc, model

        try:
            _blip["proc"], _blip["model"] = await asyncio.get_running_loop().run_in_executor(None, _load)
            log.info("BLIP model loaded.")
            return True
        except Exception as e:
            log.error("BLIP unavailable (captions disabled): %s", e)
            return False


def _blip_infer(image_bytes: bytes) -> str | None:
    try:
        from PIL import Image
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        out = _blip["model"].generate(**_blip["proc"](image, return_tensors="pt"), max_new_tokens=30)
        cap = _blip["proc"].decode(out[0], skip_special_tokens=True).strip()
        return cap[:1].upper() + cap[1:] if cap else None
    except Exception as e:
        log.warning("BLIP inference error: %s", e)
        return None


@retry(**retry_policy(TG_RETRY_ATTEMPTS, "download"))
async def download_bytes(file_id: str) -> bytes:
    buf = io.BytesIO()
    async with _tg_semaphore:
        await bot.download(file_id, destination=buf)
    return buf.getvalue()


async def caption_photo(item_id: int, file_id: str) -> None:
    use_vision = bool(AI_VISION_MODEL and AI_API_KEY and (AI_PROVIDER in ("together", "openai") or AI_BASE_URL))
    if not use_vision and not BLIP_ENABLED:
        return
    try:
        data = await download_bytes(file_id)
        caption = None
        if use_vision:
            b64 = base64.b64encode(data).decode()
            caption = await ai_complete(
                [{"role": "user", "content": [
                    {"type": "text", "text": "Describe this image in one short sentence (max 15 words)."},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}]}],
                system="You caption images concisely.", max_tokens=60, model=AI_VISION_MODEL)
        elif await _ensure_blip():
            caption = await asyncio.get_running_loop().run_in_executor(None, _blip_infer, data)
        if caption:
            await db.set_enrichment(item_id, caption=snippet(caption, 200))
    except Exception as e:
        log.warning("caption failed for item %s: %s", item_id, e)


# ════════════════════════════════════════════════════════════════════
# 8. TELEGRAM HELPERS
# ════════════════════════════════════════════════════════════════════
@contextlib.asynccontextmanager
async def typing(chat_id: int):
    async def _loop():
        while True:
            with contextlib.suppress(Exception):
                await bot.send_chat_action(chat_id, "typing")
            await asyncio.sleep(4)

    task = asyncio.create_task(_loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task


async def safe_react(message: Message, emoji: str) -> None:
    try:
        await message.react([ReactionTypeEmoji(emoji=emoji)])
    except Exception as e:
        log.debug("react %s failed: %s", emoji, e)


async def send_long(chat_id: int, text: str, **kw) -> None:
    for part in chunk_text(text, 4000):
        await bot.send_message(chat_id, part, **kw)


def extract_meta(m: Message) -> dict:
    """Всё, что нужно сохранить о сообщении. GIF проверяем раньше document (Telegram кладёт GIF в оба поля)."""
    meta = {"message_id": m.message_id, "file_type": "text", "text": m.text or m.caption or ""}

    def take(obj, ftype: str, name: str | None = None) -> None:
        meta.update(file_id=obj.file_id, file_unique_id=obj.file_unique_id, file_type=ftype,
                    file_size=getattr(obj, "file_size", None), mime_type=getattr(obj, "mime_type", None),
                    file_name=name or getattr(obj, "file_name", None))

    if m.photo:
        take(m.photo[-1], "photo")
    elif m.video:
        take(m.video, "video")
    elif m.animation:
        take(m.animation, "animation")
    elif m.document:
        take(m.document, "document")
    elif m.audio:
        take(m.audio, "audio", m.audio.file_name or " - ".join(filter(None, [m.audio.performer, m.audio.title])) or None)
    elif m.voice:
        take(m.voice, "voice")
    elif m.video_note:
        take(m.video_note, "video_note")
    elif m.location:
        lat, lon = m.location.latitude, m.location.longitude
        meta["text"] = f"📍 {lat:.6f}, {lon:.6f}\nhttps://maps.google.com/?q={lat:.6f},{lon:.6f}"
    elif m.contact:
        c = m.contact
        meta["text"] = f"👤 {c.first_name} {c.last_name or ''}".strip() + f"\n📞 {c.phone_number}"
    return meta


def is_plain_text(m: Message) -> bool:
    return bool(m.text) and not any([m.photo, m.video, m.document, m.audio, m.voice, m.video_note, m.animation])


def item_label(r: dict) -> str:
    return snippet(r.get("title") or r.get("text_content") or r.get("file_name") or r.get("ai_caption")
                   or f"[{r['file_type']}]", 60)


def fmt_local(dt_utc: datetime, tz: tzinfo) -> str:
    return dt_utc.astimezone(tz).strftime("%d.%m.%Y %H:%M")


async def user_ctx(user_id: int, code: str | None = None) -> tuple[str, tzinfo, str]:
    row = await db.touch_user(user_id, code)
    tzname = row["tz"] or DEFAULT_TZ
    return row["lang"] or "en", get_tz(row["tz"]), tzname


SENDERS = {"photo": bot.send_photo, "video": bot.send_video, "document": bot.send_document, "audio": bot.send_audio,
           "voice": bot.send_voice, "animation": bot.send_animation}


async def send_item(chat_id: int, r: dict, kb: InlineKeyboardMarkup | None = None) -> None:
    """Отправляет сохранённую запись обратно в чат. По file_id — работает и для файлов >20 МБ."""
    ftype, fid, text = r["file_type"], r.get("file_id"), r.get("text_content") or ""
    if ftype == "text" or not fid:
        head = f"#{r['id']}" + (f" — {r['title']}" if r.get("title") else "")
        await send_long(chat_id, f"{head}\n\n{text}" if text else head, reply_markup=kb)
    elif ftype == "video_note":
        await bot.send_video_note(chat_id, fid, reply_markup=kb)
    else:
        await SENDERS.get(ftype, bot.send_document)(chat_id, fid, caption=text[:1000] or None, reply_markup=kb)


# ── keyboards ──
def item_kb(lang: str, item_id: int, fav: bool = False) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=tr(lang, "b_unfav" if fav else "b_fav"), callback_data=f"fav:{item_id}"),
        InlineKeyboardButton(text=tr(lang, "b_del"), callback_data=f"del:{item_id}")]])


def main_menu_kb(lang: str, ai_on: bool) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text=tr(lang, "b_open"), web_app=WebAppInfo(url=WEB_APP_URL))],
        [InlineKeyboardButton(text=tr(lang, "b_ai_on" if ai_on else "b_ai_off"), callback_data="toggle_ai")],
        [InlineKeyboardButton(text=tr(lang, "b_search"), callback_data="menu_search"),
         InlineKeyboardButton(text=tr(lang, "b_stats"), callback_data="menu_stats"),
         InlineKeyboardButton(text=tr(lang, "b_rem"), callback_data="menu_rem")],
    ]
    last = []
    if CHANNEL_URL and "your_channel_link" not in CHANNEL_URL:
        last.append(InlineKeyboardButton(text=tr(lang, "b_channel"), url=CHANNEL_URL))
    last.append(InlineKeyboardButton(text=tr(lang, "b_how"), callback_data="how_it_works"))
    return InlineKeyboardMarkup(inline_keyboard=[*rows, last])


async def send_main_menu(chat_id: int, user_id: int, lang: str) -> None:
    await bot.send_message(chat_id, tr(lang, "start"), reply_markup=main_menu_kb(lang, user_id in _ai_mode_users),
                           parse_mode=ParseMode.HTML)


# ════════════════════════════════════════════════════════════════════
# 9. MIDDLEWARE  (доступ + язык)
# ════════════════════════════════════════════════════════════════════
from aiogram import BaseMiddleware  # noqa: E402


class AccessMiddleware(BaseMiddleware):
    async def __call__(self, handler, event, data):
        user = data.get("event_from_user")
        if user is None or user.is_bot:
            return None
        lang = _lang_cache.get(user.id)
        if lang is None:
            lang = (await db.touch_user(user.id, user.language_code))["lang"] or "en"
        if ALLOWED_USER_IDS and user.id not in ALLOWED_USER_IDS and user.id not in ADMIN_IDS:
            if isinstance(event, Message) and _deny_notice.allow(user.id):
                with contextlib.suppress(Exception):
                    await event.answer(tr(lang, "private"))
            elif isinstance(event, CallbackQuery):
                with contextlib.suppress(Exception):
                    await event.answer(tr(lang, "private"), show_alert=True)
            return None
        data["lang"] = lang
        return await handler(event, data)


for _observer in (dp.message, dp.edited_message, dp.callback_query):
    _observer.outer_middleware(AccessMiddleware())


# ════════════════════════════════════════════════════════════════════
# 10. COMMANDS
# ════════════════════════════════════════════════════════════════════
from aiogram.filters import CommandObject  # noqa: E402

HTML = ParseMode.HTML
PER_PAGE = 8


@dp.message(CommandStart())
async def cmd_start(message: Message, lang: str):
    await send_main_menu(message.chat.id, message.from_user.id, lang)


@dp.message(Command("help"))
async def cmd_help(message: Message, lang: str):
    await message.answer(tr(lang, "help"), parse_mode=HTML)


# ── browse (search / recent / notes / favs) ──
async def render_browse(user_id: int, lang: str, kind: str, query: str, page: int):
    off = page * PER_PAGE
    if kind == "search":
        rows, total = await db.list_files(user_id, q=query, limit=PER_PAGE, offset=off)
        title = tr(lang, "t_search", q=esc(snippet(query, 40)))
    elif kind == "notes":
        rows, total = await db.list_files(user_id, ftype="text", limit=PER_PAGE, offset=off)
        title = tr(lang, "t_notes")
    elif kind == "favs":
        rows, total = await db.list_files(user_id, fav=True, limit=PER_PAGE, offset=off)
        title = tr(lang, "t_favs")
    else:
        rows, total = await db.list_files(user_id, limit=PER_PAGE, offset=off)
        title = tr(lang, "t_recent")
    if not rows:
        return f"{title}\n\n{tr(lang, 'search_none' if kind == 'search' else 'empty')}", None
    pages = max(1, -(-total // PER_PAGE))
    lines = [title, ""]
    for i, r in enumerate(rows, 1):
        star = "⭐ " if r["favorite"] else ""
        lines.append(f"<b>{i}.</b> {TYPE_ICONS.get(r['file_type'], '📎')} {star}{esc(item_label(r))} <i>· {r['timestamp'][:10]}</i>")
    lines += ["", f"<i>{tr(lang, 'page', p=page + 1, n=pages)} · {total}</i>"]
    return "\n".join(lines), rows, page, pages


def browse_kb(rows: list[dict], qid: str, page: int, pages: int) -> InlineKeyboardMarkup:
    nums = [InlineKeyboardButton(text=str(i), callback_data=f"g:{r['id']}") for i, r in enumerate(rows, 1)]
    kb = [nums[i:i + 4] for i in range(0, len(nums), 4)]
    if pages > 1:
        nav = []
        if page > 0:
            nav.append(InlineKeyboardButton(text="◀", callback_data=f"b:{qid}:{page - 1}"))
        nav.append(InlineKeyboardButton(text=f"{page + 1}/{pages}", callback_data="noop"))
        if page < pages - 1:
            nav.append(InlineKeyboardButton(text="▶", callback_data=f"b:{qid}:{page + 1}"))
        kb.append(nav)
    return InlineKeyboardMarkup(inline_keyboard=kb)


async def start_browse(message: Message, lang: str, kind: str, query: str = "") -> None:
    uid = message.from_user.id
    res = await render_browse(uid, lang, kind, query, 0)
    if len(res) == 2:
        await message.answer(res[0], parse_mode=HTML)
        return
    text, rows, page, pages = res
    qid = secrets.token_urlsafe(5)
    _browse.put(qid, (uid, kind, query))
    await message.answer(text, reply_markup=browse_kb(rows, qid, page, pages), parse_mode=HTML)


@dp.message(Command("search", "find"))
async def cmd_search(message: Message, command: CommandObject, lang: str):
    q = (command.args or "").strip()
    if not q:
        await message.answer(tr(lang, "search_usage"), parse_mode=HTML)
        return
    await start_browse(message, lang, "search", q)


@dp.message(Command("recent"))
async def cmd_recent(message: Message, lang: str):
    await start_browse(message, lang, "recent")


@dp.message(Command("notes"))
async def cmd_notes(message: Message, lang: str):
    await start_browse(message, lang, "notes")


@dp.message(Command("favs", "favorites"))
async def cmd_favs(message: Message, lang: str):
    await start_browse(message, lang, "favs")


@dp.message(Command("random"))
async def cmd_random(message: Message, lang: str):
    row = await db.random_item(message.from_user.id)
    if not row:
        await message.answer(tr(lang, "random_none"))
        return
    await send_item(message.chat.id, row, item_kb(lang, row["id"], bool(row["favorite"])))


@dp.message(Command("stats"))
async def cmd_stats(message: Message, lang: str):
    await message.answer(await build_stats(message.from_user.id, lang), parse_mode=HTML)


async def build_stats(user_id: int, lang: str) -> str:
    _, tz, _ = await user_ctx(user_id)
    st = await db.stats(user_id, tz)
    types = "\n".join(f"{TYPE_ICONS.get(r['file_type'], '📎')} {r['file_type']}: <b>{r['c']}</b>"
                      + (f" ({human_size(r['s'])})" if r["s"] else "") for r in st["by_type"]) or tr(lang, "empty")
    return tr(lang, "stats", total=st["total"], favs=st["favs"], week=st["week"], streak=st["streak"],
              size=human_size(st["size"]), since=(st["since"] or "—")[:10], types=types)


# ── reminders ──
async def create_reminder(message: Message, lang: str, when_text: str) -> bool:
    """True — напоминание создано; False — текст не разобрался как время (вызывающий решит, что делать)."""
    uid = message.from_user.id
    _, tz, tzname = await user_ctx(uid)
    parsed = parse_when(when_text, tz)
    if not parsed:
        return False
    due, text = parsed
    if due <= datetime.now(timezone.utc):
        await message.answer(tr(lang, "remind_past"))
        return True
    if len(await db.active_reminders(uid)) >= 50:
        await message.answer(tr(lang, "remind_limit", n=50))
        return True
    text = text or "⏰"
    rid = await db.add_reminder(uid, message.chat.id, text[:1000], int(due.timestamp()))
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=tr(lang, "b_cancel"), callback_data=f"rc:{rid}")]])
    await message.answer(tr(lang, "remind_set", when=fmt_local(due, tz), tz=esc(tzname), text=esc(text[:1000])),
                         reply_markup=kb, parse_mode=HTML)
    return True


@dp.message(Command("remind"))
async def cmd_remind(message: Message, command: CommandObject, lang: str):
    if not (command.args and await create_reminder(message, lang, command.args)):
        await message.answer(tr(lang, "remind_usage"), parse_mode=HTML)


async def send_reminders_list(chat_id: int, user_id: int, lang: str) -> None:
    _, tz, tzname = await user_ctx(user_id)
    rows = await db.active_reminders(user_id)
    if not rows:
        await bot.send_message(chat_id, tr(lang, "remind_none"))
        return
    lines = [tr(lang, "remind_list", tz=esc(tzname)), ""]
    kb = []
    for i, r in enumerate(rows, 1):
        lines.append(f"<b>{i}.</b> {fmt_local(datetime.fromtimestamp(r['due_at'], timezone.utc), tz)} — {esc(snippet(r['text'], 60))}")
        kb.append([InlineKeyboardButton(text=f"✖ {i}. {snippet(r['text'], 24)}", callback_data=f"rc:{r['id']}")])
    await bot.send_message(chat_id, "\n".join(lines), reply_markup=InlineKeyboardMarkup(inline_keyboard=kb), parse_mode=HTML)


@dp.message(Command("reminders"))
async def cmd_reminders(message: Message, lang: str):
    await send_reminders_list(message.chat.id, message.from_user.id, lang)


# ── settings ──
@dp.message(Command("tz", "timezone"))
async def cmd_tz(message: Message, command: CommandObject, lang: str):
    uid = message.from_user.id
    if not command.args:
        _, _, tzname = await user_ctx(uid)
        await message.answer(tr(lang, "tz_show", tz=esc(tzname)), parse_mode=HTML)
        return
    parsed = parse_tz(command.args)
    if not parsed:
        await message.answer(tr(lang, "tz_bad"), parse_mode=HTML)
        return
    await db.set_user(uid, tz=parsed[1])
    await message.answer(tr(lang, "tz_set", tz=esc(parsed[1])), parse_mode=HTML)


@dp.message(Command("lang", "language"))
async def cmd_lang(message: Message, command: CommandObject, lang: str):
    new = (command.args or "").strip().lower()[:2]
    if new not in ("ru", "en"):
        new = "en" if lang == "ru" else "ru"
    await db.set_user(message.from_user.id, lang=new)
    await message.answer(tr(new, "lang_set"))


# ── AI ──
async def set_ai_mode(user_id: int, on: bool) -> None:
    (_ai_mode_users.add if on else _ai_mode_users.discard)(user_id)
    if not on:
        _ai_history.pop(user_id, None)
    await db.set_user(user_id, ai_mode=int(on))


@dp.message(Command("ai"))
async def cmd_ai(message: Message, lang: str):
    await set_ai_mode(message.from_user.id, True)
    await message.answer(tr(lang, "ai_on") if AI_API_KEY else tr(lang, "ai_nokey"))


@dp.message(Command("stop"))
async def cmd_stop(message: Message, lang: str):
    await set_ai_mode(message.from_user.id, False)
    await message.answer(tr(lang, "ai_off"))


@dp.message(Command("reset"))
async def cmd_reset(message: Message, lang: str):
    _ai_history.pop(message.from_user.id, None)
    await message.answer(tr(lang, "ai_reset"))


@dp.message(Command("ask"))
async def cmd_ask(message: Message, command: CommandObject, lang: str):
    q = (command.args or "").strip()
    if not q:
        await message.answer(tr(lang, "ask_usage"), parse_mode=HTML)
        return
    if not AI_API_KEY:
        await message.answer(tr(lang, "ai_nokey"))
        return
    uid = message.from_user.id
    if not _ai_limiter.allow(uid):
        await message.answer(tr(lang, "ai_rate", n=AI_RATE_PER_MIN))
        return
    rows, _ = await db.list_files(uid, q=q, limit=6, any_word=True)
    if not rows:
        await message.answer(tr(lang, "ask_none"))
        return
    ctx = "\n\n".join(f"[{r['timestamp'][:10]}] " + snippet(r.get("title") and f"{r['title']}: {r['text_content']}" or
                       r.get("text_content") or r.get("ai_caption") or r.get("file_name") or "", 600) for r in rows)
    system = (AI_SYSTEM_PROMPT + "\n\nAnswer using the user's saved notes below when relevant. If they don't contain "
              "the answer, say so briefly. Never invent notes.\n\nSAVED NOTES:\n" + ctx)
    async with typing(message.chat.id):
        try:
            reply = await ai_complete([{"role": "user", "content": q}], system=system)
        except PermanentHTTPError as e:
            reply = tr(lang, "ai_badkey" if e.status in (401, 403) else "ai_fail")
        except Exception as e:
            log.error("ask failed: %s", e)
            reply = tr(lang, "ai_fail")
    await send_long(message.chat.id, reply or tr(lang, "ai_fail"))


# ── data control ──
@dp.message(Command("export"))
async def cmd_export(message: Message, lang: str):
    rows = await db.export_rows(message.from_user.id)
    payload = json.dumps({"exported_at": datetime.now(timezone.utc).isoformat(), "user_id": message.from_user.id,
                          "count": len(rows), "items": rows}, ensure_ascii=False, indent=2).encode("utf-8")
    name = f"infinity-export-{datetime.now(timezone.utc):%Y%m%d}.json"
    await message.answer_document(BufferedInputFile(payload, filename=name), caption=tr(lang, "export_caption", n=len(rows)))


@dp.message(Command("wipe"))
async def cmd_wipe(message: Message, lang: str):
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=tr(lang, "b_wipe"), callback_data="wipe_yes"),
        InlineKeyboardButton(text=tr(lang, "b_cancel"), callback_data="cancel")]])
    await message.answer(tr(lang, "wipe_confirm"), reply_markup=kb, parse_mode=HTML)


# ── admin ──
@dp.message(Command("admin"))
async def cmd_admin(message: Message, lang: str):
    if message.from_user.id not in ADMIN_IDS:
        await message.answer(tr(lang, "admin_only"))
        return
    users = await db.scalar("SELECT COUNT(*) FROM users") or 0
    items = await db.scalar("SELECT COUNT(*) FROM files WHERE deleted_at IS NULL") or 0
    pend = await db.scalar("SELECT COUNT(*) FROM reminders WHERE fired=0") or 0
    size = Path(DB_PATH).stat().st_size if Path(DB_PATH).exists() else 0
    up = timedelta(seconds=int(time.time() - START_TIME))
    await message.answer(f"<b>Infinity v{VERSION}</b>\nUptime: {up}\nUsers: {users} · Items: {items} · Reminders: {pend}\n"
                         f"DB: {human_size(size)} · FTS5: {'yes' if db.has_fts else 'no'}\n"
                         f"AI: {AI_PROVIDER}/{AI_MODEL if AI_API_KEY else 'off'}\nLegacy user_id API: {'ON ⚠️' if ALLOW_LEGACY_USER_ID else 'off'}",
                         parse_mode=HTML)


@dp.message(Command("backup"))
async def cmd_backup(message: Message, lang: str):
    if message.from_user.id not in ADMIN_IDS:
        await message.answer(tr(lang, "admin_only"))
        return
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    target = BACKUP_DIR / f"manual-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.db"
    await db.backup_to(target)
    if target.stat().st_size > 49 * 1024 * 1024:
        await message.answer(f"{tr(lang, 'backup_caption')}: {target} ({human_size(target.stat().st_size)}) — too big for Telegram.")
    else:
        await message.answer_document(BufferedInputFile(target.read_bytes(), filename=target.name), caption=tr(lang, "backup_caption"))


# ════════════════════════════════════════════════════════════════════
# 11. CALLBACKS
# ════════════════════════════════════════════════════════════════════
def _msg(cb: CallbackQuery) -> Message | None:
    return cb.message if isinstance(cb.message, Message) else None


@dp.callback_query(F.data == "noop")
async def cb_noop(cb: CallbackQuery):
    await cb.answer()


@dp.callback_query(F.data == "cancel")
async def cb_cancel(cb: CallbackQuery, lang: str):
    await cb.answer()
    if m := _msg(cb):
        with contextlib.suppress(Exception):
            await m.edit_text(tr(lang, "cancelled"))


@dp.callback_query(F.data == "toggle_ai")
async def cb_toggle_ai(cb: CallbackQuery, lang: str):
    uid = cb.from_user.id
    on = uid not in _ai_mode_users
    await set_ai_mode(uid, on)
    await cb.answer(tr(lang, "ai_on" if on else "ai_off")[:190])
    if m := _msg(cb):
        with contextlib.suppress(Exception):
            await m.edit_reply_markup(reply_markup=main_menu_kb(lang, on))


@dp.callback_query(F.data == "how_it_works")
async def cb_how(cb: CallbackQuery, lang: str):
    await cb.answer()
    if m := _msg(cb):
        kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=tr(lang, "b_back"), callback_data="back_to_main")]])
        with contextlib.suppress(Exception):
            await m.delete()
        await m.answer(tr(lang, "how"), reply_markup=kb, parse_mode=HTML)


@dp.callback_query(F.data == "back_to_main")
async def cb_back(cb: CallbackQuery, lang: str):
    await cb.answer()
    if m := _msg(cb):
        with contextlib.suppress(Exception):
            await m.delete()
        await send_main_menu(m.chat.id, cb.from_user.id, lang)


@dp.callback_query(F.data == "menu_search")
async def cb_menu_search(cb: CallbackQuery, lang: str):
    await cb.answer()
    if m := _msg(cb):
        await m.answer(tr(lang, "how_search"), parse_mode=HTML)


@dp.callback_query(F.data == "menu_stats")
async def cb_menu_stats(cb: CallbackQuery, lang: str):
    await cb.answer()
    if m := _msg(cb):
        await m.answer(await build_stats(cb.from_user.id, lang), parse_mode=HTML)


@dp.callback_query(F.data == "menu_rem")
async def cb_menu_rem(cb: CallbackQuery, lang: str):
    await cb.answer()
    if m := _msg(cb):
        await send_reminders_list(m.chat.id, cb.from_user.id, lang)


@dp.callback_query(F.data.startswith("b:"))
async def cb_browse(cb: CallbackQuery, lang: str):
    _, qid, page = cb.data.split(":")
    entry = _browse.get(qid)
    m = _msg(cb)
    if not entry or entry[0] != cb.from_user.id or not m:
        await cb.answer(tr(lang, "expired"), show_alert=True)
        return
    res = await render_browse(cb.from_user.id, lang, entry[1], entry[2], max(0, int(page)))
    await cb.answer()
    if len(res) == 2:
        return
    text, rows, pg, pages = res
    with contextlib.suppress(TelegramBadRequest):     # «message is not modified»
        await m.edit_text(text, reply_markup=browse_kb(rows, qid, pg, pages), parse_mode=HTML)


@dp.callback_query(F.data.startswith("g:"))
async def cb_get(cb: CallbackQuery, lang: str):
    row = await db.get_item(cb.from_user.id, int(cb.data[2:]))
    if not row or not (m := _msg(cb)):
        await cb.answer(tr(lang, "gone"), show_alert=True)
        return
    await cb.answer()
    await send_item(m.chat.id, row, item_kb(lang, row["id"], bool(row["favorite"])))


@dp.callback_query(F.data.startswith("fav:"))
async def cb_fav(cb: CallbackQuery, lang: str):
    item_id = int(cb.data[4:])
    new = await db.set_favorite(cb.from_user.id, item_id)
    if new is None:
        await cb.answer(tr(lang, "gone"), show_alert=True)
        return
    await cb.answer("⭐" if new else "☆")
    if m := _msg(cb):
        with contextlib.suppress(Exception):
            await m.edit_reply_markup(reply_markup=item_kb(lang, item_id, new))


@dp.callback_query(F.data.startswith("del:"))
async def cb_del(cb: CallbackQuery, lang: str):
    item_id = int(cb.data[4:])
    if not await db.soft_delete(cb.from_user.id, item_id):
        await cb.answer(tr(lang, "gone"), show_alert=True)
        return
    await cb.answer(tr(lang, "deleted"))
    if m := _msg(cb):
        kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=tr(lang, "b_undo"), callback_data=f"undo:{item_id}")]])
        try:
            await m.edit_text(tr(lang, "deleted"), reply_markup=kb)
        except TelegramBadRequest:       # у медиа-сообщений нет текста — меняем только клавиатуру
            with contextlib.suppress(Exception):
                await m.edit_reply_markup(reply_markup=kb)


@dp.callback_query(F.data.startswith("undo:"))
async def cb_undo(cb: CallbackQuery, lang: str):
    item_id = int(cb.data[5:])
    if not await db.restore(cb.from_user.id, item_id):
        await cb.answer(tr(lang, "gone"), show_alert=True)
        return
    await cb.answer(tr(lang, "restored"))
    if m := _msg(cb):
        row = await db.get_item(cb.from_user.id, item_id)
        try:
            await m.edit_text(tr(lang, "restored"), reply_markup=item_kb(lang, item_id, bool(row and row["favorite"])))
        except TelegramBadRequest:
            with contextlib.suppress(Exception):
                await m.edit_reply_markup(reply_markup=item_kb(lang, item_id, bool(row and row["favorite"])))


@dp.callback_query(F.data.startswith("rc:"))
async def cb_rem_cancel(cb: CallbackQuery, lang: str):
    ok = await db.cancel_reminder(cb.from_user.id, int(cb.data[3:]))
    await cb.answer(tr(lang, "remind_cancelled") if ok else tr(lang, "gone"))
    if ok and (m := _msg(cb)):
        with contextlib.suppress(Exception):
            await m.edit_text(tr(lang, "remind_cancelled"))


@dp.callback_query(F.data == "wipe_yes")
async def cb_wipe(cb: CallbackQuery, lang: str):
    await db.wipe_user(cb.from_user.id)
    _ai_history.pop(cb.from_user.id, None)
    await cb.answer()
    if m := _msg(cb):
        with contextlib.suppress(Exception):
            await m.edit_text(tr(lang, "wipe_done"))


# ════════════════════════════════════════════════════════════════════
# 12. INCOMING DATA  (сохранение, заметки, напоминания, AI-чат, альбомы)
# ════════════════════════════════════════════════════════════════════
@dp.message(F.new_chat_members | F.left_chat_member | F.pinned_message)
async def delete_system_messages(message: Message):
    with contextlib.suppress(Exception):
        await message.delete()


@dp.edited_message(F.text | F.caption)
async def on_edited(message: Message, lang: str):
    if message.from_user:
        await db.update_text(message.from_user.id, message.message_id, message.text or message.caption or "")


async def store_and_reply(messages: list[Message], lang: str, *, note: bool = False,
                          text_override: str | None = None) -> None:
    first, uid = messages[0], messages[0].from_user.id
    try:
        metas = [extract_meta(m) for m in messages]
        if text_override is not None:
            metas[0]["text"] = text_override
        saved = await db.save_items(uid, metas)
    except Exception as e:
        log.error("DB save error: %s", e)
        await first.answer(tr(lang, "save_fail"))
        return
    new = [s for s in saved if not s["dup"]]
    for s in new:
        if s["file_type"] == "photo" and s.get("file_id"):
            spawn(caption_photo(s["id"], s["file_id"]), "caption")
        elif note and AI_AUTOTAG and AI_API_KEY and len(s.get("text", "")) >= 20:
            spawn(_safe_enrich(s["id"], s["text"]), "enrich")

    await safe_react(first, ("✍" if note else "👍") if new else "👌")      # ✍ — из разрешённых Telegram (📝 даёт REACTION_INVALID)
    dups = len(saved) - len(new)
    if not new:
        text = tr(lang, "dup") if len(saved) == 1 else tr(lang, "dup_n", n=dups, total=len(saved))
        kb = None
    else:
        head = tr(lang, "note_saved") if note else (tr(lang, "saved") if len(new) == 1 else tr(lang, "saved_n", n=len(new)))
        text = f"{head}\n{tr(lang, 'saved_hint')}"
        if dups:
            text += "\n" + tr(lang, "dup_n", n=dups, total=len(saved))
        kb = item_kb(lang, new[0]["id"]) if len(new) == 1 else None
    try:
        await first.answer(text, reply_markup=kb, parse_mode=HTML)
    except Exception as e:
        log.error("Answer error: %s", e)


async def _safe_enrich(item_id: int, text: str) -> None:
    try:
        await enrich_note(item_id, text)
    except Exception as e:
        log.warning("note enrichment failed: %s", e)


async def _flush_album(mgid: str, lang: str) -> None:
    await asyncio.sleep(1.5)                       # тихое окно: новые части альбома перезапускают таймер
    messages = _album_buf.pop(mgid, [])
    _album_tasks.pop(mgid, None)
    if messages:
        # shield: если во время сохранения придёт ещё одна часть и отменит эту задачу — сохранение всё равно завершится
        await asyncio.shield(store_and_reply(messages, lang))


@dp.message(F.photo | F.video | F.document | F.audio | F.voice | F.video_note | F.animation | F.text | F.location | F.contact)
async def handle_incoming(message: Message, lang: str):
    if not message.from_user:
        return
    text = message.text or ""
    if text.startswith("/"):
        if message.chat.type == "private":
            await message.answer(tr(lang, "unknown_cmd"))
        return
    uid, plain = message.from_user.id, is_plain_text(message)

    if plain and (m := REMIND_RE.match(text)):                       # «напомни через 2 часа …» — работает в любом режиме
        if await create_reminder(message, lang, text[m.end():]):
            return                                                    # не распозналось как время → сохраняем как обычный текст

    if plain and NOTE_COMMAND_RE.match(text):                        # «запиши: …»
        note_text = NOTE_COMMAND_RE.sub("", text, count=1).strip()
        if not note_text:
            await message.answer(tr(lang, "note_prompt"))
            return
        await store_and_reply([message], lang, note=True, text_override=note_text)
        return

    if plain and uid in _ai_mode_users:                              # AI-режим: текст уходит ассистенту и НЕ сохраняется
        if not _ai_limiter.allow(uid):
            await message.answer(tr(lang, "ai_rate", n=AI_RATE_PER_MIN))
            return
        async with typing(message.chat.id):
            reply = await call_ai(uid, text, lang)
        try:
            await send_long(message.chat.id, reply)
        except Exception as e:
            log.error("AI reply error: %s", e)
        return

    if message.media_group_id:                                       # альбом: копим и сохраняем пачкой
        mgid = message.media_group_id
        _album_buf.setdefault(mgid, []).append(message)
        if (old := _album_tasks.get(mgid)) and not old.done():
            old.cancel()
        _album_tasks[mgid] = spawn(_flush_album(mgid, lang), "album")
        return

    await store_and_reply([message], lang)


# ════════════════════════════════════════════════════════════════════
# 13. API FOR THE MINI APP
# ════════════════════════════════════════════════════════════════════
class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


_SIGN_KEY = hashlib.sha256(b"infinity-media|" + BOT_TOKEN.encode()).digest()
_ip_limiter = RateLimiter(240, 60)
_media_limiter = RateLimiter(1200, 60)
_user_limiter = RateLimiter(120, 60)
_path_cache: dict[str, tuple[str, float]] = {}
_legacy_warned = False


def validate_init_data(init_data: str, token: str, max_age: int = INITDATA_MAX_AGE) -> dict | None:
    """Официальная проверка Telegram WebApp initData (HMAC-SHA256). Возвращает dict пользователя или None."""
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True))
        received = pairs.pop("hash", None)
        if not received:
            return None
        check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
        secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(hmac.new(secret, check.encode(), hashlib.sha256).hexdigest(), received):
            return None
        if max_age and time.time() - int(pairs.get("auth_date", "0")) > max_age:
            return None
        user = json.loads(pairs.get("user", "{}"))
        return user if isinstance(user, dict) and "id" in user else None
    except Exception:
        return None


def sign_media(item_id: int, user_id: int, exp: int) -> str:
    return hmac.new(_SIGN_KEY, f"{item_id}:{user_id}:{exp}".encode(), hashlib.sha256).hexdigest()[:32]


def base_url(request: web.Request) -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    proto = request.headers.get("X-Forwarded-Proto", "https").split(",")[0].strip() or "https"
    return f"{proto}://{request.headers.get('X-Forwarded-Host') or request.host}"


def media_url(request: web.Request, item_id: int, user_id: int) -> str:
    exp = (int(time.time() + MEDIA_URL_TTL) // 3600 + 1) * 3600      # округляем до часа → URL стабилен → браузер кэширует
    return f"{base_url(request)}/media/{item_id}?u={user_id}&e={exp}&s={sign_media(item_id, user_id, exp)}"


def client_ip(request: web.Request) -> str:
    return (request.headers.get("X-Forwarded-For", "").split(",")[0].strip()) or request.remote or "?"


def authenticate(request: web.Request) -> int:
    global _legacy_warned
    auth = request.headers.get("Authorization", "")
    init = auth[4:].strip() if auth[:4].lower() == "tma " else request.rel_url.query.get("init_data", "")
    if init:
        user = validate_init_data(init, BOT_TOKEN)
        if not user:
            raise ApiError(401, "invalid or expired init data")
        uid = int(user["id"])
    elif ALLOW_LEGACY_USER_ID and request.rel_url.query.get("user_id", "").isdigit():
        uid = int(request.rel_url.query["user_id"])
        if not _legacy_warned:
            _legacy_warned = True
            log.warning("API called with legacy ?user_id= (no signature). Update app.js, then set ALLOW_LEGACY_USER_ID=0.")
    else:
        raise ApiError(401, "authorization required (Authorization: tma <initData>)")
    if ALLOWED_USER_IDS and uid not in ALLOWED_USER_IDS and uid not in ADMIN_IDS:
        raise ApiError(403, "forbidden")
    if not _user_limiter.allow(uid):
        raise ApiError(429, "too many requests")
    return uid


def item_json(r: dict, request: web.Request, uid: int) -> dict:
    e: dict = {"id": r["id"], "type": r["file_type"], "text": r["text_content"] or "",
               "ts": iso_utc(r["timestamp"]), "favorite": bool(r["favorite"])}
    if r.get("ai_caption"): e["ai_caption"] = r["ai_caption"]
    if r.get("title"): e["title"] = r["title"]
    if r.get("tags"): e["tags"] = r["tags"].split()
    if r.get("file_name"): e["name"] = r["file_name"]
    if r.get("file_size"): e["size"] = r["file_size"]
    if r.get("mime_type"): e["mime"] = r["mime_type"]
    if r.get("file_id"):
        if (r.get("file_size") or 0) > TG_DOWNLOAD_LIMIT:
            e["too_big"] = True          # >20 МБ: по ссылке не отдать, но /api/files/{id}/send пришлёт файл в чат
        else:
            e["url"] = media_url(request, r["id"], uid)   # ссылка на НАШ прокси; токен бота наружу не уходит
    return e


async def read_json(request: web.Request) -> dict:
    try:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _int(v, default: int, lo: int, hi: int) -> int:
    try:
        return min(max(int(v), lo), hi)
    except (TypeError, ValueError):
        return default


async def api_files(request: web.Request) -> web.Response:
    uid = authenticate(request)
    q = request.rel_url.query
    limit, offset = _int(q.get("limit"), PAGE_SIZE, 1, 100), _int(q.get("offset"), 0, 0, 10**9)
    ftype = q.get("type") if q.get("type") in TYPE_ICONS else None
    rows, total = await db.list_files(uid, q=(q.get("q") or "").strip()[:200] or None, ftype=ftype,
                                      fav=q.get("fav") in ("1", "true"), limit=limit, offset=offset)
    files = [item_json(r, request, uid) for r in rows]     # никаких get_file на каждый элемент: список отдаётся мгновенно
    return web.json_response({"status": "success", "files": files, "total": total, "offset": offset,
                              "limit": limit, "has_more": offset + len(files) < total})


async def api_stats(request: web.Request) -> web.Response:
    uid = authenticate(request)
    _, tz, _ = await user_ctx(uid)
    st = await db.stats(uid, tz)
    return web.json_response({"status": "success", **st, "by_type": {r["file_type"]: r["c"] for r in st["by_type"]}})


async def api_tags(request: web.Request) -> web.Response:
    return web.json_response({"status": "success", "tags": await db.top_tags(authenticate(request))})


async def api_note(request: web.Request) -> web.Response:
    uid = authenticate(request)
    text = str((await read_json(request)).get("text") or "").strip()[:MAX_TEXT]
    if not text:
        raise ApiError(400, "text is empty")
    saved = await db.save_items(uid, [{"file_type": "text", "text": text}])
    if AI_AUTOTAG and AI_API_KEY and len(text) >= 20:
        spawn(_safe_enrich(saved[0]["id"], text), "enrich")
    return web.json_response({"status": "success", "id": saved[0]["id"]})


async def _item_or_404(request: web.Request, uid: int, include_deleted: bool = False) -> dict:
    try:
        item_id = int(request.match_info["id"])
    except ValueError:
        raise ApiError(400, "bad id")
    row = await db.get_item(uid, item_id, include_deleted)
    if not row:
        raise ApiError(404, "not found")
    return row


async def api_favorite(request: web.Request) -> web.Response:
    uid = authenticate(request)
    row = await _item_or_404(request, uid)
    body = await read_json(request)
    new = await db.set_favorite(uid, row["id"], bool(body["value"]) if "value" in body else None)
    return web.json_response({"status": "success", "favorite": new})


async def api_delete(request: web.Request) -> web.Response:
    uid = authenticate(request)
    row = await _item_or_404(request, uid)
    await db.soft_delete(uid, row["id"])
    return web.json_response({"status": "success"})


async def api_restore(request: web.Request) -> web.Response:
    uid = authenticate(request)
    row = await _item_or_404(request, uid, include_deleted=True)
    await db.restore(uid, row["id"])
    return web.json_response({"status": "success"})


async def api_send(request: web.Request) -> web.Response:
    """Прислать запись в чат с ботом — единственный способ получить файлы >20 МБ."""
    uid = authenticate(request)
    row = await _item_or_404(request, uid)
    try:
        await send_item(uid, row)
    except TelegramForbiddenError:
        raise ApiError(409, "open the bot chat and press /start first")
    return web.json_response({"status": "success"})


async def get_file_path(file_id: str) -> str:
    hit = _path_cache.get(file_id)
    if hit and hit[1] > time.monotonic():
        return hit[0]
    async with _tg_semaphore:
        f = await bot.get_file(file_id)          # сюда уже вшит tenacity через middleware
    if not f.file_path:
        raise TelegramBadRequest(method=None, message="no file_path")
    if len(_path_cache) > 5000:
        _path_cache.clear()
    _path_cache[file_id] = (f.file_path, time.monotonic() + 45 * 60)
    return f.file_path


@retry(**retry_policy(TG_RETRY_ATTEMPTS, "file proxy"))
async def open_upstream(url: str, headers: dict) -> aiohttp.ClientResponse:
    session = await http()
    resp = await session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=None, sock_connect=15, sock_read=60))
    if resp.status == 429 or resp.status >= 500:
        resp.release()
        raise TransientHTTPError(resp.status)
    return resp


_INLINE_TYPES = ("image/", "video/", "audio/")


async def api_media(request: web.Request) -> web.StreamResponse:
    try:
        item_id, uid, exp, sig = int(request.match_info["id"]), int(request.query["u"]), int(request.query["e"]), request.query["s"]
    except (KeyError, ValueError):
        raise ApiError(400, "bad request")
    if exp < time.time():
        raise ApiError(410, "link expired — reload the list")
    if not hmac.compare_digest(sign_media(item_id, uid, exp), sig):
        raise ApiError(403, "bad signature")
    row = await db.get_item(uid, item_id)
    if not row or not row.get("file_id"):
        raise ApiError(404, "not found")
    try:
        path = await get_file_path(row["file_id"])
    except TelegramBadRequest as e:
        if "too big" in str(e).lower():
            await db.exec("UPDATE files SET file_size=? WHERE id=?", (TG_DOWNLOAD_LIMIT + 1, item_id))   # запоминаем: дальше отдаём too_big
            raise ApiError(413, "file is larger than 20 MB — use /api/files/{id}/send")
        raise ApiError(404, "file unavailable")
    headers = {"Range": request.headers["Range"]} if "Range" in request.headers else {}
    upstream = await open_upstream(f"https://api.telegram.org/file/bot{BOT_TOKEN}/{path}", headers)
    try:
        if upstream.status >= 400:
            raise ApiError(404 if upstream.status == 404 else 502, "upstream error")
        ctype = upstream.headers.get("Content-Type", "application/octet-stream").split(";")[0].strip()
        if ctype in ("application/octet-stream", "binary/octet-stream", ""):
            ctype = row.get("mime_type") or mimetypes.guess_type(path)[0] or "application/octet-stream"
        inline = ctype.startswith(_INLINE_TYPES) or ctype == "application/pdf"      # html/svg и т.п. — только скачивание
        resp = web.StreamResponse(status=upstream.status)
        resp.headers["Content-Type"] = ctype if inline else "application/octet-stream"
        for h in ("Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"):
            if h in upstream.headers:
                resp.headers[h] = upstream.headers[h]
        name = (row.get("file_name") or path.rsplit("/", 1)[-1]).replace('"', "")
        resp.headers["Content-Disposition"] = f'{"inline" if inline else "attachment"}; filename="{name}"'
        resp.headers["Cache-Control"] = "private, max-age=86400"
        resp.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
        await resp.prepare(request)
        if request.method != "HEAD":
            try:
                async for chunk in upstream.content.iter_chunked(64 * 1024):
                    await resp.write(chunk)
            except (ConnectionResetError, asyncio.CancelledError):
                return resp                                    # клиент закрыл вкладку/перемотал видео
        await resp.write_eof()
        return resp
    finally:
        upstream.release()


async def api_health(request: web.Request) -> web.Response:
    ok = True
    try:
        await db.scalar("SELECT 1")
    except Exception:
        ok = False
    return web.json_response({"ok": ok, "version": VERSION, "uptime": int(time.time() - START_TIME)}, status=200 if ok else 503)


@web.middleware
async def cors_mw(request: web.Request, handler):
    if request.method == "OPTIONS":
        resp: web.StreamResponse = web.Response(status=204)
    else:
        try:
            resp = await handler(request)
        except web.HTTPException as e:
            resp = e
    origin = request.headers.get("Origin", "")
    if origin and (origin in CORS_ORIGINS or "*" in CORS_ORIGINS):
        resp.headers.update({"Access-Control-Allow-Origin": origin, "Vary": "Origin",
                             "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
                             "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400"})
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    return resp


@web.middleware
async def error_mw(request: web.Request, handler):
    try:
        return await handler(request)
    except ApiError as e:
        return web.json_response({"error": e.message}, status=e.status)
    except web.HTTPException as e:
        return web.json_response({"error": e.reason}, status=e.status) if e.status >= 400 else e
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("API error on %s %s", request.method, request.path)
        return web.json_response({"error": "internal error"}, status=500)


@web.middleware
async def limit_mw(request: web.Request, handler):
    limiter = _media_limiter if request.path.startswith("/media/") else _ip_limiter
    if request.path != "/health" and not limiter.allow(client_ip(request)):
        return web.json_response({"error": "too many requests"}, status=429, headers={"Retry-After": "30"})
    return await handler(request)


def build_app() -> web.Application:
    app = web.Application(middlewares=[cors_mw, error_mw, limit_mw], client_max_size=64 * 1024)
    app.add_routes([
        web.get("/health", api_health),
        web.get("/favicon.ico", lambda r: web.Response(status=204)),
        web.get("/api/files", api_files),
        web.get("/api/stats", api_stats),
        web.get("/api/tags", api_tags),
        web.post("/api/note", api_note),
        web.post("/api/files/{id}/favorite", api_favorite),
        web.post("/api/files/{id}/restore", api_restore),
        web.post("/api/files/{id}/send", api_send),
        web.delete("/api/files/{id}", api_delete),
        web.get("/media/{id}", api_media),
    ])
    return app


# ════════════════════════════════════════════════════════════════════
# 14. BACKGROUND JOBS
# ════════════════════════════════════════════════════════════════════
async def reminder_loop() -> None:
    while True:
        try:
            for r in await db.due_reminders(int(time.time())):
                lang = _lang_cache.get(r["user_id"], "en")
                try:
                    await bot.send_message(r["chat_id"], tr(lang, "remind_fire", text=esc(r["text"])), parse_mode=HTML)
                    await db.finish_reminder(r["id"])
                except (TelegramForbiddenError, TelegramBadRequest, TelegramNotFound):
                    await db.finish_reminder(r["id"])           # пользователь заблокировал бота / чат удалён — не долбим вечно
                except Exception as e:
                    log.warning("reminder %s not delivered, will retry next tick: %s", r["id"], e)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("reminder loop error")
        await asyncio.sleep(15)


async def maintenance_loop() -> None:
    """Раз в час: ежедневный бэкап БД (VACUUM INTO), ротация, чистка удалённых старше 30 дней."""
    while True:
        try:
            BACKUP_DIR.mkdir(parents=True, exist_ok=True)
            target = BACKUP_DIR / f"storage-{datetime.now(timezone.utc):%Y%m%d}.db"
            if not target.exists():
                await db.backup_to(target)
                log.info("DB backup written: %s", target)
                for old in sorted(BACKUP_DIR.glob("storage-*.db"))[:-BACKUP_KEEP]:
                    old.unlink(missing_ok=True)
            if (n := await db.purge_deleted(30)):
                log.info("purged %d deleted items older than 30 days", n)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("maintenance error")
        await asyncio.sleep(3600)


async def telegram_setup() -> None:
    """Меню команд, кнопка мини-аппа, уведомление админам. Идёт в фоне, чтобы не задерживать старт при проблемах с сетью."""
    try:
        en = [("start", "Menu"), ("search", "Search your archive"), ("recent", "Latest items"), ("notes", "Your notes"),
              ("favs", "Favorites"), ("random", "Random old item"), ("stats", "Statistics"), ("remind", "Set a reminder"),
              ("reminders", "Your reminders"), ("ask", "Ask AI about your notes"), ("ai", "AI chat on"), ("stop", "AI chat off"),
              ("tz", "Timezone"), ("export", "Export data"), ("help", "Help")]
        ru = [("start", "Меню"), ("search", "Поиск по архиву"), ("recent", "Последние записи"), ("notes", "Заметки"),
              ("favs", "Избранное"), ("random", "Случайная запись"), ("stats", "Статистика"), ("remind", "Поставить напоминание"),
              ("reminders", "Мои напоминания"), ("ask", "Вопрос AI по заметкам"), ("ai", "Включить AI-чат"), ("stop", "Выключить AI-чат"),
              ("tz", "Часовой пояс"), ("export", "Выгрузить данные"), ("help", "Помощь")]
        await bot.set_my_commands([BotCommand(command=c, description=d) for c, d in en], scope=BotCommandScopeDefault())
        await bot.set_my_commands([BotCommand(command=c, description=d) for c, d in ru], scope=BotCommandScopeDefault(), language_code="ru")
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Archive", web_app=WebAppInfo(url=WEB_APP_URL)))
        for admin in ADMIN_IDS:
            with contextlib.suppress(Exception):
                await bot.send_message(admin, f"✅ Infinity v{VERSION} started")
    except Exception as e:
        log.warning("telegram setup skipped: %s", e)


# ════════════════════════════════════════════════════════════════════
# 15. MAIN  (супервизор: процесс не падает от сетевых сбоев)
# ════════════════════════════════════════════════════════════════════
async def run_polling_forever() -> None:
    """getUpdates: внутри aiogram работает BackoffConfig (1→2→4→…→60 с.). Если что-то всё же вылетело
    наружу (в т.ч. delete_webhook при недоступном Telegram — из-за этого раньше падал весь процесс),
    ждём по той же лесенке и стартуем заново."""
    attempt = 0
    while True:
        started = time.monotonic()
        try:
            await bot.delete_webhook(drop_pending_updates=False)
            log.info("Telegram bot running…")
            await dp.start_polling(bot, polling_timeout=30, backoff_config=POLL_BACKOFF,
                                   allowed_updates=dp.resolve_used_update_types(), close_bot_session=False)
            return                                                    # штатная остановка (SIGTERM/Ctrl+C)
        except asyncio.CancelledError:
            raise
        except TelegramUnauthorizedError:
            log.critical("Telegram rejected BOT_TOKEN (revoked or wrong). Fix it and restart.")
            raise SystemExit(1)
        except Exception as e:
            attempt = 1 if time.monotonic() - started > 300 else attempt + 1
            delay = backoff_delay(attempt) + random.uniform(0, RETRY_JITTER)
            log.error("polling crashed (%s: %s) — restart in %.1fs (attempt %d)", type(e).__name__, e, delay, attempt)
            await asyncio.sleep(delay)


async def main() -> None:
    setup_logging()
    if not re.fullmatch(r"\d+:[\w-]+", BOT_TOKEN or ""):
        sys.exit("BOT_TOKEN is not set (or malformed). Put it into the environment or a .env file — see .env.example")
    await db.open()
    bot.session.middleware(TelegramRetryMiddleware())            # ← tenacity на КАЖДЫЙ вызов Bot API
    _ai_mode_users.update(await db.ai_users())
    if ALLOW_LEGACY_USER_ID:
        log.warning("ALLOW_LEGACY_USER_ID=1: API still accepts unsigned ?user_id=. Switch app.js to initData, then set it to 0.")

    runner = web.AppRunner(build_app(), access_log=None)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT).start()
    log.info("API server started on port %s (v%s, FTS5=%s, AI=%s)", PORT, VERSION, db.has_fts, "on" if AI_API_KEY else "off")

    jobs = [spawn(reminder_loop(), "reminders"), spawn(maintenance_loop(), "maintenance"), spawn(telegram_setup(), "setup")]
    try:
        await run_polling_forever()
    finally:
        for j in jobs:
            j.cancel()
        for t in list(_bg_tasks):
            t.cancel()
        await asyncio.gather(*jobs, *list(_bg_tasks), return_exceptions=True)
        await runner.cleanup()
        if _http_session and not _http_session.closed:
            await _http_session.close()
        await bot.session.close()
        await db.close()
        log.info("Bye.")


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(main())