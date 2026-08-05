# Repka — обзор приложения

## Назначение

Repka — MVP AI-native диаграммы Ганта. Пользователь:

1. Открывает план (демо через `seed.py` / данные на сервере) или загружает Excel (`.xlsx` / `.xls`).
2. Видит задачи на диаграмме Ганта (день / неделя / месяц, навигация, приоритеты, поиск и сортировка).
3. Редактирует задачи вручную (модалка CRUD) или через чат: LLM вызывает MCP-инструменты; изменения пишутся в БД и подтягиваются во фронтенд.
4. Экспортирует план обратно в Excel.

Проект — монорепозиторий: `/frontend` + `/backend`, общий корневой `.env`.

## Демо (продакшен)

UI на **Vercel**, API на **Render**. Конкретные URL — в сопроводительном сообщении к сдаче (в репо не дублируем).

## Стек

| Слой | Технологии |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, shadcn/ui, TanStack Query, Zustand, axios, xlsx, zod, gantt-task-react |
| Backend | Python 3.10+, FastAPI, SQLAlchemy 2.0, Pydantic, openai (OpenRouter), mcp |
| БД (MVP) | SQLite (`DATABASE_URL=sqlite:///./repka.db`), переход на PostgreSQL — смена URL |
| Хостинг | Frontend → Vercel; Backend → Render |

## Архитектура

```
┌─────────────────────┐         HTTP/JSON          ┌──────────────────────────┐
│  Frontend (Vite)    │ ─────────────────────────► │  Backend (FastAPI)       │
│                     │                            │                          │
│  Excel → zod → API  │  POST /tasks/import        │  SQLAlchemy → SQLite/PG  │
│  GET /tasks → Gantt │  POST/PATCH/DELETE /tasks  │  (+ seed.py для демо)    │
│  ChatPanel → Gantt  │  POST /chat                │  OpenRouter + MCP tools  │
└─────────────────────┘                            └──────────────────────────┘
```

### Ключевые ADR

1. **SQLite → PostgreSQL.** Модели через SQLAlchemy; для production достаточно сменить `DATABASE_URL`. На SQLite дополнительно работает `ensure_sqlite_columns` для эволюции схемы (`priority`).
2. **Парсинг Excel на клиенте.** `xlsx` + `zod` до сетевого запроса — быстрая обратная связь. Порядок колонок не важен: маппинг по заголовкам.
3. **Серверное состояние в TanStack Query.** После мутаций (CRUD, импорт, чат) — `invalidateQueries(['tasks'])`, без optimistic updates.
4. **Импорт = append уникальных `title`.** Полная замена плана (`/tasks/bulk`) снята. Ручной CRUD допускает одинаковые названия.
5. **Зависимости — слой A.** Существование / self-ref / циклы; cleanup при delete. Автосдвиг дат (FS) — позже.
6. **Агент без полного snapshot.** Задачи ищутся через `search_tasks` / `get_project_summary`; grounding перед мутациями; tool stripping в истории.

## Основные потоки

### Импорт Excel

1. Пользователь выбирает файл в `ExcelUpload` (drag&drop или input).
2. `parseExcelFile` читает первый лист, нормализует заголовки, валидирует **построчно** через `excelTaskSchema`.
3. При ошибках или дубликатах **внутри файла** — toast с деталями, импорт **не** выполняется.
4. `POST /tasks/import` **добавляет** задачи с уникальным `title` (относительно БД); дубликаты → `skipped`. Predecessors: 1-based индекс строки файла и/или существующий id.
5. Фронтенд инвалидирует `['tasks']` и перерисовывает Гантт.

### Демо без Excel / демо-файл

```bash
cd backend
python seed.py          # ~250 задач в SQLite

# или импорт:
# samples/demo-tasks.xlsx
# перегенерация: node scripts/generate-demo-excel.mjs
```

### Отображение Ганта

1. `GET /tasks` → кеш TanStack Query.
2. `toGanttTasks` маппит задачи в `gantt-task-react` (цвет бара по `priority`).
3. Масштаб День/Неделя/Месяц, навигация, task list (аватар, сроки, ресайз), поиск/сортировка.
4. Клик → модалка CRUD; кнопка **+** → создание.

### Чат с AI

1. `ChatPanel` → `POST /chat` с `message` и `history` (Zustand).
2. `agent.run_chat`: system prompt с МСК-датой **без** таблицы всех задач; OpenRouter + MCP tools (до 6 раундов).
3. Read-only: `get_project_summary`, `search_tasks`. Мутации: move/assign/create/delete, duration/priority, dependencies, bulk_*.
4. Ответ `{ reply, tools_used }`. UI инвалидирует `['tasks']`. Toast «План обновлён» — **только** если были мутирующие tools (не search/summary).

## Формат Excel

| Колонка | Обязательная | Описание |
| --- | --- | --- |
| `Задача` | да | Название |
| `Описание` | нет | Описание |
| `Исполнитель` | нет | Исполнитель |
| `Дата начала` | да | ISO / Excel serial / парсируемая строка |
| `Длительность` | да | Дни (≥ 1) |
| `Предшественники` | нет | Индексы строк файла и/или id в БД |
| `Приоритет` | нет | Канон RU; default `Средний` |

Заголовки нормализуются (trim, lower, пробелы → `_`). EN-алиасы принимаются. Порядок столбцов не важен.

## Переменные окружения

| Переменная | Назначение | По умолчанию |
| --- | --- | --- |
| `DATABASE_URL` | SQLAlchemy URL | `sqlite:///./repka.db` |
| `OPENROUTER_API_KEY` | Ключ OpenRouter | — (нужен для `/chat`) |
| `OPENROUTER_BASE_URL` | Base URL API | `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | Модель | `openai/gpt-4o-mini` |
| `CORS_ORIGINS` | Origins фронта | localhost:5173 (dev). На Render — **JSON-массив** |
| `VITE_API_URL` | URL API для фронта | `http://127.0.0.1:8000` |

## Локальный запуск

См. [README](../README.md). Проверка API: `GET /health` → `{"status":"ok"}`.

## Структура репозитория

```
Repka/
├── backend/
│   ├── app/                 # FastAPI, agent, mcp_tools, routers
│   ├── Dockerfile
│   ├── seed.py
│   └── requirements.txt
├── frontend/src/            # React SPA
├── samples/demo-tasks.xlsx
├── docs/                    # app, backend, frontend, agent-mcp, plan, Roadmap
├── README.md
└── .env.example
```

## Статус MVP (по docs/plan.md)

| Этап | Статус |
| --- | --- |
| 1–7 | готово (слой B — опционально) |
| 8 Enterprise UI | частично |
| 9 Агент P1+P2 | готово; P3 — нет |
| 10 Деплой + доки сдачи | задеплоено; README / Roadmap обновлены |

## Связанные документы

- [README](../README.md)
- [Backend](./backend.md) · [Frontend](./frontend.md) · [AI-агент](./agent-mcp.md)
- [plan.md](./plan.md) · [Roadmap to production](./Roadmap-to-production.md)
