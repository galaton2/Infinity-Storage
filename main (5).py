import asyncio
import logging
import aiosqlite
from aiohttp import web
from aiogram import Bot, Dispatcher, F
from aiogram.enums import ParseMode
from aiogram.filters import CommandStart
from aiogram.types import (
    Message, CallbackQuery, InlineKeyboardMarkup,
    InlineKeyboardButton, WebAppInfo, ReactionTypeEmoji
)

# ================= SETTINGS =================
BOT_TOKEN = ""
WEB_APP_URL = "https://galaton2.github.io/Infinity-Storage/"
PORT = 8080
CHANNEL_URL = "https://t.me/your_channel_link"

# Инициализируем бота правильно через класс Bot
bot = Bot(token=BOT_TOKEN)
dp  = Dispatcher()

# ── Rate-limit guard: max 5 simultaneous get_file calls to Telegram ──
_tg_semaphore = asyncio.Semaphore(5)

# ── Album (media-group) buffer ────────────────────────────────────────
# Telegram fires one message per photo in an album, all within ~1 s.
# We buffer them, then flush as a single batch after a short pause.
_album_buf:   dict[str, list[Message]] = {}
_album_tasks: dict[str, asyncio.Task]  = {}


# ================= 1. DATABASE =================
async def init_db():
    async with aiosqlite.connect('storage.db') as db:
        # WAL mode = much better concurrent write performance
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute('''
            CREATE TABLE IF NOT EXISTS files (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER,
                message_id   INTEGER,
                file_id      TEXT,
                file_type    TEXT,
                text_content TEXT,
                timestamp    DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # Index speeds up the per-user paginated queries
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id, id DESC)"
        )
        await db.commit()


# ================= 2. HELPERS =================
def _extract(message: Message) -> tuple[str | None, str, str]:
    """Return (file_id, file_type, text_content) for any message."""
    file_id      = None
    file_type    = "text"
    text_content = message.text or message.caption or ""

    if message.photo:
        file_type = "photo";     file_id = message.photo[-1].file_id
    elif message.video:
        file_type = "video";     file_id = message.video.file_id
    elif message.document:
        file_type = "document";  file_id = message.document.file_id
    elif message.audio:
        file_type = "audio";     file_id = message.audio.file_id
    elif message.voice:
        file_type = "voice";     file_id = message.voice.file_id
    elif message.video_note:
        file_type = "video_note"; file_id = message.video_note.file_id
    elif message.animation:
        file_type = "animation"; file_id = message.animation.file_id

    return file_id, file_type, text_content


async def _save_messages(messages: list[Message]) -> int:
    """Persist a list of messages to SQLite in one transaction. Returns count saved."""
    rows = [_extract(m) + (m.from_user.id, m.message_id) for m in messages]
    count = 0
    try:
        async with aiosqlite.connect('storage.db', timeout=10) as db:
            await db.execute("PRAGMA journal_mode=WAL")
            for file_id, file_type, text_content, user_id, message_id in rows:
                await db.execute(
                    "INSERT INTO files (user_id, message_id, file_id, file_type, text_content) "
                    "VALUES (?,?,?,?,?)",
                    (user_id, message_id, file_id, file_type, text_content)
                )
                count += 1
            await db.commit()
    except Exception as e:
        logging.error(f"DB save error: {e}")
    return count


# ================= 3. ALBUM FLUSHER =================
async def _flush_album(media_group_id: str) -> None:
    """Called once per album after a 1.5-s quiet window."""
    await asyncio.sleep(1.5)

    messages = _album_buf.pop(media_group_id, [])
    _album_tasks.pop(media_group_id, None)
    if not messages:
        return

    count = await _save_messages(messages)
    if count == 0:
        return

    first = messages[0]
    try:
        await first.react([ReactionTypeEmoji(emoji="👍")])
    except Exception as e:
        logging.warning(f"React error (album): {e}")

    try:
        noun = "asset" if count == 1 else "assets"
        await first.answer(
            f"✅ <b>{count} {noun} saved!</b>\n"
            "Open <b>Infinity Data Base</b> to view them.",
            parse_mode=ParseMode.HTML
        )
    except Exception as e:
        logging.error(f"Answer error (album): {e}")


# ================= 4. TELEGRAM BOT =================
async def send_main_menu(chat_id: int) -> None:
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Open Archive", web_app=WebAppInfo(url=WEB_APP_URL))],
        [
            InlineKeyboardButton(text="Official Channel", url=CHANNEL_URL),
            InlineKeyboardButton(text="How it works",    callback_data="how_it_works")
        ]
    ])
    caption = (
        "<b>INFINITY STORAGE</b>\n\n"
        "<i>Your digital extension.</i>\n\n"
        "A secure environment to capture and index your assets.\n"
        "Forward any file, photo, video, or note to preserve it permanently."
    )
    try:
        await bot.send_message(chat_id, caption, reply_markup=keyboard, parse_mode=ParseMode.HTML)
    except Exception as e:
        logging.error(f"send_main_menu error: {e}")


@dp.message(CommandStart())
async def cmd_start(message: Message):
    await send_main_menu(message.chat.id)


@dp.callback_query(F.data == "how_it_works")
async def send_how_it_works(callback: CallbackQuery):
    await callback.answer()
    info_text = (
        "<b>HOW IT WORKS (test)</b>\n\n"
        "🔹 <b>User Data:</b> No personal info collected.\n"
        "🔹 <b>File Host:</b> Files stay securely on Telegram servers.\n"
        "🔹 <b>Privacy:</b> Anonymous file ID mapping ensures your privacy."
    )
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="← Back", callback_data="back_to_main")]
    ])
    await callback.message.delete()
    await callback.message.answer(info_text, reply_markup=keyboard, parse_mode=ParseMode.HTML)


@dp.callback_query(F.data == "back_to_main")
async def back_to_main(callback: CallbackQuery):
    await callback.answer()
    await callback.message.delete()
    await send_main_menu(callback.message.chat.id)


@dp.message(F.new_chat_members | F.left_chat_member | F.pinned_message)
async def delete_system_messages(message: Message):
    try:
        await message.delete()
    except Exception as e:
        logging.error(f"Failed to delete system msg: {e}")


@dp.message(F.photo | F.video | F.document | F.audio | F.voice | F.video_note | F.animation | F.text)
async def handle_incoming_data(message: Message):
    # Ignore commands
    if message.text and message.text.startswith('/'):
        return

    # ── Media group (album): buffer and batch-flush ──────────────────
    if message.media_group_id:
        mgid = message.media_group_id
        _album_buf.setdefault(mgid, []).append(message)

        # Reset the flush timer every time a new piece arrives
        existing = _album_tasks.get(mgid)
        if existing and not existing.done():
            existing.cancel()
        _album_tasks[mgid] = asyncio.create_task(_flush_album(mgid))
        return

    # ── Single file / text ───────────────────────────────────────────
    count = await _save_messages([message])
    if count == 0:
        return

    try:
        await message.react([ReactionTypeEmoji(emoji="👍")])
    except Exception as e:
        logging.warning(f"React error: {e}")

    try:
        await message.answer(
            "✅ <b>Asset saved!</b>\n"
            "Open <b>Infinity Data Base</b> to view it.",
            parse_mode=ParseMode.HTML
        )
    except Exception as e:
        logging.error(f"Answer error: {e}")


# ================= 5. API (FOR WEB APP) =================
PAGE_SIZE = 20  # files per page

async def _resolve_url(file_id: str | None) -> str | None:
    """Get a fresh Telegram CDN URL for a file_id with rate-limit protection."""
    if not file_id:
        return None
    async with _tg_semaphore:
        try:
            tg_file = await bot.get_file(file_id)
            # Small delay between calls to stay well under Telegram's limits
            await asyncio.sleep(0.07)
            return f"https://api.telegram.org/file/bot{BOT_TOKEN}/{tg_file.file_path}"
        except Exception as e:
            logging.error(f"get_file error ({file_id[:10]}…): {e}")
            return None


async def get_files_api(request: web.Request) -> web.Response:
    headers = {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Headers": "Content-Type",
    }

    user_id = request.rel_url.query.get('user_id')
    if not user_id:
        return web.json_response({"error": "user_id missing"}, status=400, headers=headers)

    try:
        offset = max(0, int(request.rel_url.query.get('offset', 0)))
        limit  = min(max(1, int(request.rel_url.query.get('limit', PAGE_SIZE))), 50)
    except ValueError:
        return web.json_response({"error": "bad params"}, status=400, headers=headers)

    async with aiosqlite.connect('storage.db') as db:
        # Total count for the client (so it knows when to stop scrolling)
        async with db.execute(
            "SELECT COUNT(*) FROM files WHERE user_id = ?", (int(user_id),)
        ) as cur:
            total_result = await cur.fetchone()
            total = total_result[0] if total_result else 0

        async with db.execute(
            "SELECT file_id, file_type, text_content FROM files "
            "WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?",
            (int(user_id), limit, offset)
        ) as cur:
            rows = await cur.fetchall()

    # Resolve Telegram CDN URLs — in parallel, but through the semaphore
    url_tasks = [_resolve_url(row[0]) for row in rows]
    urls      = await asyncio.gather(*url_tasks)

    files_data = []
    for (file_id, file_type, text_content), url in zip(rows, urls):
        entry: dict = {"type": file_type, "text": text_content or ""}
        if url:
            entry["url"] = url
        files_data.append(entry)

    return web.json_response({
        "status":   "success",
        "files":    files_data,
        "total":    total,
        "offset":   offset,
        "limit":    limit,
        "has_more": (offset + len(files_data)) < total,
    }, headers=headers)


async def options_handler(request: web.Request) -> web.Response:
    """Handle CORS pre-flight."""
    return web.Response(headers={
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    })


# ================= 6. MAIN =================
async def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )
    await init_db()

    app = web.Application()
    app.add_routes([
        web.get('/api/files',     get_files_api),
        web.options('/api/files', options_handler),
    ])

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', PORT)
    await site.start()

    logging.info(f"API server started on port {PORT}")
    logging.info("Telegram bot running…")

    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())