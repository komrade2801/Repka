# Backend — документация

API-сервис Repka на FastAPI: хранение задач, CRUD, append-импорт, сидинг демо-данных и AI-чат с MCP-инструментами для изменения плана.

## Стек

- **Python 3.10+**, **FastAPI**, **Uvicorn**
- **SQLAlchemy 2.0** (ORM), **Pydantic** / **pydantic-settings**
- **openai** SDK → OpenRouter
- **mcp** — регистрация и in-process вызов tools

Зависимости: `backend/requirements.txt`.

## Точка входа

`backend/app/main.py`:

- Создаёт таблицы (`Base.metadata.create_all`)
- Вызывает `ensure_sqlite_columns()` (добавление/миграция колонки `priority` на уже существующих SQLite)
- `RateLimitMiddleware` — лимиты на mutate `/tasks*` и `/chat`
- CORS из `settings.cors_origins` (dev: Vite на 5173)
- Роутеры: `tasks`, `chat`
- `GET /health` → `{"status": "ok"}`

Интерактивная схема: `http://127.0.0.1:8000/docs`.

## Конфигурация

`app/config.py` — класс `Settings` читает корневой и локальный `.env`:

| Поле | Env | Описание |
| --- | --- | --- |
| `database_url` | `DATABASE_URL` | По умолчанию `sqlite:///./repka.db` |
| `cors_origins` | — | Список origin (в коде: localhost/127.0.0.1:5173) |
| `openrouter_api_key` | `OPENROUTER_API_KEY` | Без ключа `/chat` отвечает 503 |
| `openrouter_base_url` | `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` |
| `openrouter_model` | `OPENROUTER_MODEL` | `anthropic/claude-sonnet-4.6` |

## База данных

`app/database.py`:

- `create_engine` + `SessionLocal`
- для SQLite: `check_same_thread=False`
- `get_db()` — dependency FastAPI (yield session, close в `finally`)
- `ensure_sqlite_columns()` — для SQLite: `ALTER TABLE` с `priority`, если колонки нет; миграция старых EN-лейблов (`Low`/`Medium`/…) → русские канонические значения

Переход на PostgreSQL: выставить, например,  
`DATABASE_URL=postgresql+psycopg://user:pass@host/db` — модели менять не нужно.

### Модель `Task`

Таблица `tasks` (`app/models.py`):

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | int PK | Идентификатор |
| `title` | String(255) | Название |
| `description` | Text, nullable | Описание |
| `assignee` | String(255), nullable | Исполнитель |
| `start_date` | Date | Дата начала |
| `duration` | int | Длительность (дни) |
| `predecessors` | String(255), nullable | ID предшественников через запятую (`"1,2"`) |
| `priority` | String(32) | Приоритет (см. enum ниже); default `Средний` |

`TaskPriority` (`str` Enum): `Критический`, `Высокий`, `Средний`, `Низкий`, `Опционально`.

## Pydantic-схемы

`app/schemas.py`:

- `TaskCreate` / `TaskRead` — CRUD-поля задачи, включая `priority`
- `TaskUpdate` — частичное обновление (все поля Optional)
- `TaskImportRequest` / `TaskImportResult` — append-импорт (`created` + `skipped`)
- `normalize_priority` — алиасы (ru/en: `high` → `Высокий`, `critical` → `Критический`, …); пустое/неизвестное → `Средний`
- `ChatRequest` — `{ message, history?: { role, content }[] }`
- `ChatResponse` — `{ reply, tools_used: string[] }`

## Валидация зависимостей (слой A)

`app/task_graph.py`:

- parse/format `predecessors` (`"1,2"`), схлопывание дубликатов;
- существование predecessor id;
- запрет self-ref;
- проверка ацикличности;
- при `DELETE` — очистка ссылок на удалённый id у остальных задач.

Автосдвиг `start_date` (FS) **не** выполняется.
## HTTP API

### Задачи — `app/routers/tasks.py`

Префикс `/tasks`. ID — `int` PK + autoincrement (после MVP планируется UUID).

#### `GET /tasks`

Список задач, сортировка по `id`.  
Ответ: `TaskRead[]`.

#### `POST /tasks`

Создание одной задачи. Ответ: `TaskRead` (201).  
Валидация predecessors (слой A). Поле `id` назначает БД.

#### `PATCH /tasks/{id}`

Частичное обновление. 404 если нет задачи; 422 при ошибке графа зависимостей.

#### `DELETE /tasks/{id}`

Удаление + cleanup ссылок у зависимых. 204.

#### `POST /tasks/import`

Append уникальных по `title` (без учёта регистра):

1. Дубликаты относительно БД и внутри файла → `skipped`
2. Новые строки → insert с autoincrement id
3. `predecessors` в файле: сначала как **1-based индекс строки файла** (remap на новые/существующие id), иначе как уже существующий id в БД
4. Валидация графа; при ошибке — rollback + 422

Ответ:

```json
{
  "created": [ /* TaskRead[] */ ],
  "skipped": [{ "title": "...", "reason": "duplicate_title" }]
}
```

`POST /tasks/bulk` (полная замена плана) **удалён**.

### Чат — `app/routers/chat.py`

#### `POST /chat`

Асинхронный эндпоинт. Требует `OPENROUTER_API_KEY`.

| Код | Когда |
| --- | --- |
| 200 | Успех: `ChatResponse` |
| 503 | Нет API-ключа / RuntimeError конфигурации |
| 502 | Ошибка запроса к LLM |

Тело:

```json
{
  "message": "Перенеси задачу «Аналитика» на 2026-08-10",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

## AI-агент

Подробная архитектура: [AI-агент и MCP Tools](./agent-mcp.md).

`app/agent.py` — `run_chat(message, history, db, settings)`:

1. Читает все задачи, вставляет markdown-таблицу в **system prompt** (`format_tasks_for_prompt`, колонки включают `priority`).
2. Собирает messages: system + history + текущее user-сообщение.
3. Берёт схемы tools из MCP (`mcp.list_tools()`), маппит в OpenAI function tools.
4. Биндит DB-сессию через `set_tool_db` (ContextVar) на время цикла.
5. До **6** раундов (`MAX_TOOL_ROUNDS`): completion → при tool_calls вызывает `mcp.call_tool` → результат в role `tool` → снова LLM.
6. Возвращает `(reply_text, tools_used)`.

Системный промпт: роль «Repka», резолв по ID/title, ответ на языке пользователя. Tools: аналитика/поиск + move/assign/create/delete, duration/priority, add/remove dependency.

Клиент: `AsyncOpenAI` → OpenRouter (`HTTP-Referer` / `X-Title`).

## MCP Tools

`app/mcp_tools.py` — in-process `MCPServer("Repka")` (та же сессия, что `/chat`).

| Tool | Аргументы | Действие |
| --- | --- | --- |
| `get_project_summary` | `assignee?`, `priority?` | Агрегаты COUNT / GROUP BY |
| `search_tasks` | `query?`, `assignee?`, `priority?`, `start_from/to?`, `finish_from/to?`, `limit=10` | SQL-поиск/фильтр (finish = start + duration) |
| `move_task` | `task_id`, `new_start_date` | `start_date` |
| `assign_task` | `task_id`, `assignee` | Исполнитель (`` → сброс) |
| `add_dependency` / `remove_dependency` | `task_id`, `predecessor_id` | FS / снятие (слой A) |
| `create_task` | `title`, `start_date`, … | Создание |
| `delete_task` | `task_id` | Удаление + cleanup |
| `update_task_duration` / `update_task_priority` | id + значение | Длительность / приоритет |

Валидация графа — `task_graph` (слой A). Лимиты полей как у HTTP CRUD. Мутации: `commit`/`refresh`; ошибки → `rollback` + текст в LLM.

## Демо-сидинг

`backend/seed.py` — скрипт заполнения БД демо-планом (~250 задач, 10 исполнителей, горизонт ~3 месяца, FS-зависимости, приоритеты).

```bash
cd backend
python seed.py
```

Перезаписывает все строки в `tasks`. Удобно для локальной демо без Excel-импорта.

Готовый Excel для проверки импорта: `samples/demo-tasks.xlsx` (~250 строк; перегенерация: `node scripts/generate-demo-excel.mjs`).

## Запуск

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# .env в корне проекта:
# DATABASE_URL=sqlite:///./repka.db
# OPENROUTER_API_KEY=sk-or-...

uvicorn app.main:app --reload --port 8000
```

Файл SQLite по умолчанию создаётся относительно cwd процесса (часто `backend/repka.db`).

## Структура модулей

```
backend/
├── app/
│   ├── main.py         # app, middleware, /health, ensure_sqlite_columns
│   ├── config.py       # Settings
│   ├── database.py     # engine, get_db, SQLite column migrate
│   ├── models.py       # Task ORM + TaskPriority
│   ├── schemas.py      # request/response DTO + normalize_priority
│   ├── agent.py        # LLM loop + tools
│   ├── mcp_tools.py    # analytics / search / mutations
│   ├── task_graph.py   # predecessors validation (layer A)
│   ├── rate_limit.py   # mutate/chat rate limits
│   └── routers/
│       ├── tasks.py    # GET /, POST /, PATCH /{id}, DELETE /{id}, POST /import
│       └── chat.py     # POST /chat
├── seed.py             # демо-данные (~250 задач)
└── requirements.txt
```

## Связанные документы

- [Обзор приложения](./app.md)
- [AI-агент и MCP Tools](./agent-mcp.md)
- [Frontend](./frontend.md)
