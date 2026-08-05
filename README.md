# Repka

AI-native планировщик с диаграммой Ганта: Excel-импорт/экспорт, ручной CRUD и чат с LLM (OpenRouter) через MCP-инструменты.

## Демо

Приложение задеплоено на **Vercel** (UI) и **Render** (API). Прямые URL — в сопроводительном сообщении к сдаче, в репозитории не публикуем.

| | |
| --- | --- |
| **Репозиторий** | [github.com/komrade2801/Repka](https://github.com/komrade2801/Repka) |
| **Sample Excel** | [`samples/demo-tasks.xlsx`](samples/demo-tasks.xlsx) (~250 задач) |

На Render Free первый запрос после простоя может занять ~30–60 с (cold start). Чат ждёт ответ LLM до ~120 с. Проверка API: `GET /health`, Swagger `/docs`.

## Архитектура

```
┌─────────────────────┐         HTTP/JSON          ┌──────────────────────────┐
│  Frontend (Vercel)  │ ─────────────────────────► │  Backend (Render)        │
│  React + Vite       │  /tasks, /tasks/import     │  FastAPI + SQLAlchemy    │
│  Gantt + Chat       │  /chat                     │  OpenRouter + MCP tools  │
└─────────────────────┘                            └──────────────────────────┘
```

**Ключевые решения (ADR):**

1. **SQLite → PostgreSQL** — смена `DATABASE_URL`; модели через SQLAlchemy.
2. **Excel на клиенте** — `xlsx` + `zod` до API; порядок колонок не важен (маппинг по заголовкам).
3. **Импорт = append** уникальных `title` (`POST /tasks/import`), не перетираем все задачи разом.
4. **TanStack Query** — после CRUD / импорта / чата `invalidateQueries(['tasks'])`, без optimistic UI.
5. **Зависимости — слой A** (существование, запрет self-ref и циклов); автосдвиг дат (FS), граф зависимостей — после MVP.
6. **Агент без снимка плана** — поиск/агрегаты через MCP (`search_tasks`, `get_project_summary`), grounding перед мутациями .

Подробнее: [docs/app.md](docs/app.md) · [docs/backend.md](docs/backend.md) · [docs/frontend.md](docs/frontend.md) · [docs/agent-mcp.md](docs/agent-mcp.md).

## Быстрый старт (локально)

```bash
# Backend (из /backend)
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
# Корневой .env — см. .env.example (OPENROUTER_API_KEY обязателен для чата)
uvicorn app.main:app --reload --port 8000
# опционально: python seed.py

# Frontend (из /frontend)
npm install
npm run dev
```

UI: `http://localhost:5173` · API: `http://127.0.0.1:8000/docs`

## Переменные окружения

**Backend** (корневой `.env` / Render):

| Переменная | Описание |
| --- | --- |
| `DATABASE_URL` | По умолчанию `sqlite:///./repka.db` |
| `OPENROUTER_API_KEY` | Ключ OpenRouter (без него `/chat` → 503) |
| `OPENROUTER_MODEL` | По умолчанию `openai/gpt-4o-mini` |
| `CORS_ORIGINS` | **JSON-массив** origins, напр. `["https://<your-app>.vercel.app","http://localhost:5173"]` (для `list[str]` pydantic-settings ждёт JSON, не CSV) |

**Frontend** (Vercel / `frontend/.env`):

| Переменная | Описание |
| --- | --- |
| `VITE_API_URL` | Базовый URL API, напр. `https://<your-service>.onrender.com`|

## Деплой

- **Backend:** Render Web Service, Root Directory `backend` (или Docker: `backend/Dockerfile`). Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- **Frontend:** Vercel, Root Directory `frontend`, Build `npm run build`, Output `dist`, env `VITE_API_URL`.
- **БД на Render:** демо — SQLite (данные на эфемерном диске теряются при redeploy без Persistent Disk) или managed Postgres. См. [Roadmap to production](docs/Roadmap-to-production.md).

## Использование AI-ассистентов при разработке

Разработка велась с помощью AI-ассистентов:

- **Брейншторм, рисерч и выбор решений** — обсуждение вариантов, границ MVP, архитектуры и ADR велось с **Gemini 3.1 Pro** и **Gemini 3.6 Flash** (сравнение подходов к агенту/MCP, импорту, Ганту, деплою).
- **Реализация в IDE (Cursor / Chat)** — scaffolding Vite/React, FastAPI-роутеры, схемы Pydantic/zod, обвязка TanStack Query / Zustand по принятым ADR.
- **MCP + агент** — регистрация tools, system prompt (МСК-время, grounding, tool stripping), bulk-операции и SQL-поиск вместо полного snapshot плана в промпте.
- **Гант / Excel** — маппинг в `gantt-task-react`, импорт/экспорт, валидация колонок.
- **Деплой** — Dockerfile, Linux-совместимый `requirements.txt` (`pywin32` только на Windows), CORS для Vercel, правки под Render Native Python.
- **Ревью человеком** — продуктовые решения (append-импорт, слой A без автосдвига, контракт toast только на мутации), промпт, UX и приёмка сценария ТЗ на проде.

Ассистенты ускоряли исследование, рутину и черновики; финальный выбор архитектуры, границы MVP и проверка — за автором.

## Документация

| Документ | Описание |
| --- | --- |
| [docs/app.md](docs/app.md) | Обзор, потоки, Excel, env |
| [docs/backend.md](docs/backend.md) | API, модели, агент, Docker |
| [docs/frontend.md](docs/frontend.md) | UI, Гантт, чат, Vercel |
| [docs/agent-mcp.md](docs/agent-mcp.md) | MCP tools и цикл `run_chat` |
| [docs/plan.md](docs/plan.md) | Roadmap MVP / этапы |
| [docs/Roadmap-to-production.md](docs/Roadmap-to-production.md) | Что доработать до боя |
