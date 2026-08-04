# Repka — обзор приложения

## Назначение

Repka — MVP AI-native диаграммы Ганта. Пользователь:

1. Загружает план из Excel (`.xlsx` / `.xls`) или поднимает демо через `backend/seed.py`.
2. Видит задачи на диаграмме Ганта (день / неделя / месяц, навигация, приоритеты).
3. Меняет расписание через чат: LLM вызывает MCP-инструменты на бэкенде, изменения пишутся в БД и подтягиваются во фронтенд.

Проект — монорепозиторий: `/frontend` + `/backend`, общий корневой `.env`.

## Стек

| Слой | Технологии |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, shadcn/ui, TanStack Query, Zustand, axios, xlsx, zod, gantt-task-react |
| Backend | Python 3.10+, FastAPI, SQLAlchemy 2.0, Pydantic, openai (OpenRouter), mcp |
| БД (MVP) | SQLite (`DATABASE_URL=sqlite:///./repka.db`), переход на PostgreSQL — смена URL |

## Архитектура

```
┌─────────────────────┐         HTTP/JSON          ┌──────────────────────────┐
│  Frontend (Vite)    │ ─────────────────────────► │  Backend (FastAPI)       │
│                     │                            │                          │
│  Excel → zod → API  │  POST /tasks/bulk          │  SQLAlchemy → SQLite     │
│  GET /tasks → Gantt │  GET  /tasks               │  (+ seed.py для демо)    │
│  ChatPanel → Gantt  │  POST /chat                │  OpenRouter + MCP tools  │
└─────────────────────┘                            └──────────────────────────┘
```

### Ключевые ADR

1. **SQLite → PostgreSQL.** Модели через SQLAlchemy; для production достаточно сменить `DATABASE_URL`. На SQLite дополнительно работает `ensure_sqlite_columns` для эволюции схемы (`priority`).
2. **Парсинг Excel на клиенте.** `xlsx` + `zod` до сетевого запроса — быстрая обратная связь, меньше нагрузки на API.
3. **Серверное состояние в TanStack Query.** После мутаций (импорт, чат) — `invalidateQueries(['tasks'])`, Гантт обновляется без ручных `useEffect`.

## Основные потоки

### Импорт Excel

1. Пользователь выбирает файл в `ExcelUpload` (drag&drop или input).
2. `parseExcelFile` читает первый лист, нормализует заголовки, валидирует **построчно** через `excelTaskSchema` (форматы, priority, predecessors, дубликаты названий).
3. При любых ошибках или дубликатах — toast с деталями, импорт **не** выполняется.
4. `POST /tasks/bulk` **заменяет** все задачи в БД; ID назначаются последовательно с 1 (чтобы `predecessors` из Excel ссылались на порядок строк, 1-based).
5. Фронтенд инвалидирует `['tasks']` и перерисовывает Гантт.

### Демо без Excel / демо-файл

```bash
cd backend
python seed.py          # ~250 задач в SQLite

# или импорт из готового файла:
# samples/demo-tasks.xlsx  (~250 строк)
# перегенерация: node scripts/generate-demo-excel.mjs
```

### Отображение Ганта

1. `GET /tasks` → кеш TanStack Query.
2. `toGanttTasks` маппит задачи в формат `gantt-task-react` (start/end из `start_date` + `duration`, цвет бара по `priority`).
3. Масштаб День/Неделя/Месяц, навигация периода, кастомный task list (аватар, сроки, ресайз).
4. Клик по задаче → `selectedTaskId` в Zustand → модалка `TaskDetailsDialog` (react-hook-form).

### Чат с AI

1. `ChatPanel` шлёт `POST /chat` с `message` и `history` из Zustand.
2. Агент подставляет снимок задач (включая `priority`) в system prompt, вызывает OpenRouter с tool schemas из MCP.
3. LLM может вызвать `move_task`, `assign_task`, `add_dependency` (до 6 раундов). Смена приоритета через агента не поддерживается.
4. Ответ: `{ reply, tools_used }`. UI добавляет ответ в store и делает `invalidateQueries(['tasks'])`.

## Формат Excel

| Колонка | Обязательная | Описание |
| --- | --- | --- |
| `Задача` | да | Название задачи |
| `Описание` | нет | Описание |
| `Исполнитель` | нет | Исполнитель |
| `Дата начала` | да | Дата начала (ISO, Excel serial или парсируемая строка) |
| `Длительность` | да | Длительность в днях (≥ 1) |
| `Предшественники` | нет | ID предшественников через запятую (по порядку строк после импорта) |
| `Приоритет` | нет | `Критический` / `Высокий` / `Средний` / `Низкий` / `Опционально`; default `Средний` |

Заголовки нормализуются: trim, lower case, пробелы → `_`. Английские алиасы (`title`, `start_date`, …) по-прежнему принимаются при импорте. Экспорт пишет русские заголовки (с заглавной буквы), жирный крупный header-ряд и ширину колонок по контенту.

## Переменные окружения

Корневой `.env` (см. `.env.example`):

| Переменная | Назначение | По умолчанию |
| --- | --- | --- |
| `DATABASE_URL` | SQLAlchemy URL | `sqlite:///./repka.db` |
| `OPENROUTER_API_KEY` | Ключ OpenRouter | — (обязателен для `/chat`) |
| `OPENROUTER_BASE_URL` | Base URL API | `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | Модель | `anthropic/claude-sonnet-4.6` |

Фронтенд:

| Переменная | Назначение | По умолчанию |
| --- | --- | --- |
| `VITE_API_URL` | Базовый URL API | `http://127.0.0.1:8000` |

## Локальный запуск

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# опционально: python seed.py
```

Проверка: `GET http://127.0.0.1:8000/health` → `{"status":"ok"}`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Откройте `http://localhost:5173`. CORS на бэкенде разрешает `localhost:5173` и `127.0.0.1:5173`.

## Структура репозитория

```
Repka/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app, CORS, /health
│   │   ├── config.py        # Settings из .env
│   │   ├── database.py      # Engine, Session, Base, ensure_sqlite_columns
│   │   ├── models.py        # ORM Task + TaskPriority
│   │   ├── schemas.py       # Pydantic DTO
│   │   ├── agent.py         # OpenRouter + tool calling
│   │   ├── mcp_tools.py     # MCP tools (мутации задач)
│   │   └── routers/
│   │       ├── tasks.py
│   │       └── chat.py
│   ├── seed.py              # демо ~250 задач
│   ├── requirements.txt
│   └── repka.db             # локальная SQLite (не коммитить секреты)
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── api/             # HTTP к /tasks и /chat
│       ├── components/      # ExcelUpload, GanttChart, ChatPanel, TaskDetailsDialog, ui/
│       ├── lib/             # api, parse-excel, export-excel, zod, gantt-mapper
│       ├── stores/          # Zustand UI + сообщения чата
│       └── types/
├── samples/
│   └── demo-tasks.xlsx      # демо Excel (~250 задач)
├── scripts/
│   └── generate-demo-excel.mjs
├── docs/                    # эта документация
├── plan.md                  # roadmap MVP
└── .env / .env.example
```

## Статус MVP (по plan.md)

| Этап | Статус |
| --- | --- |
| 1. Инициализация и БД | готово (+ поле `priority`, SQLite-migrate) |
| 2. Excel + Гантт | готово (+ масштаб, навигация, цвета priority) |
| 3. AI + MCP + `POST /chat` | готово |
| 4. UI чата и модалка задачи | готово |
| 5. Экспорт Excel, UX-полировка | готово (экспорт, sonner, скелетон, валидация импорта, `samples/demo-tasks.xlsx`) |
| 6. Деплой (Render / Vercel), README, демо | частично: базовый README; деплой, Roadmap-to-production, видео — нет |

## Связанные документы

- [README](../README.md) — быстрый старт
- [Backend](./backend.md)
- [Frontend](./frontend.md)
- [plan.md](../plan.md) — стек, ADR, roadmap
