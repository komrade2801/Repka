# Repka

Repka — AI-native планировщик с диаграммой Ганта: загрузка задач из Excel, визуализация на таймлайне и изменение плана через чат с LLM (OpenRouter / Claude Sonnet) и MCP-инструментами.

## Документация

| Документ | Описание |
| --- | --- |
| [Приложение (обзор)](docs/app.md) | Назначение, архитектура, потоки данных, запуск, статус MVP |
| [Backend](docs/backend.md) | FastAPI, модели, API, агент, MCP Tools |
| [Frontend](docs/frontend.md) | React/Vite, Гантт, импорт Excel, состояние, API-клиент |

## Быстрый старт

```bash
# Backend (из /backend)
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
# В корневом .env: DATABASE_URL, OPENROUTER_API_KEY
uvicorn app.main:app --reload --port 8000

# Frontend (из /frontend)
npm install
npm run dev
```

Фронтенд: `http://localhost:5173`  
API / Swagger: `http://127.0.0.1:8000/docs`

Подробности — в [docs/app.md](docs/app.md).
