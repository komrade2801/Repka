# Roadmap to production

Что сознательно оставлено за рамками MVP и порядок закрытия долгов перед боевым использованием.

## Уже в MVP

- React + FastAPI + MCP + LLM (OpenRouter)
- Гантт, CRUD, append-импорт / экспорт Excel
- Чат с search/summary + мутации
- Деплой: [Vercel] + [Render]
- Rate limiting на mutate/`/chat`, лимиты полей, CORS из env

## Технические долги и пробелы

| Тема | Сейчас | Для прода |
| --- | --- | --- |
| БД | SQLite (на Render без Persistent Disk) | Managed **PostgreSQL**; `DATABASE_URL=postgresql+psycopg://…` + драйвер в `requirements.txt` |
| ID задач | `int` autoincrement | **UUID**; миграция данных и Excel-контракта |
| Зависимости | Строка `"1,2"` | Join-таблица `task_dependencies` |
| Auth | Нет | Пользователи / проекты / RBAC; не публичный OpenRouter-ключ на общем демо |
| Импорт | Append по уникальному `title` | Merge / upsert по стабильному ключу; явная политика конфликтов |
| Realtime | Poll через invalidate после чата | WebSockets / SSE для коллаборации |
| Слой B (FS) | Нет автосдвига дат | `shift_dependents` / `auto_reschedule` при move/add_dependency |
| Наблюдаемость | Логи хостинга | Структурированные логи, метрики LLM (токены, latency, errors) |
| Миграции схемы | `create_all` + SQLite ALTER | Alembic / аналог |
| Мультиарендность | Один общий план | Изоляция tenant / project |

## Риски

1. **Стоимость и квоты LLM** — публичное демо без auth → abuse; смягчение: жёсткий rate limit, бюджет OpenRouter, капча / ключ ревьюера.
2. **Cold start Render Free** — долгий первый запрос; UX: статус «Агент думает», warm-up, платный инстанс.
3. **Потеря данных SQLite** на redeploy без диска.
4. **Галлюцинации агента** — снижены grounding + SQL-tools, но без human-in-the-loop опасны массовые delete/move.
5. **CORS / env** — `CORS_ORIGINS` для pydantic `list[str]` задавать **JSON-массивом**; `VITE_API_URL` только на build-time Vercel.

## Порядок закрытия (рекомендуемый)

1. Postgres + Persistent / managed + бэкапы; убрать зависимость от локального файла.
2. Auth (хотя бы API key / basic project isolation) и ротация секретов.
3. Alembic + UUID + нормализация зависимостей.
4. Слой B (FS auto-shift) и явные bulk-подтверждения в UI.
5. Observability и лимиты стоимости LLM.
6. WebSockets / multi-user при необходимости коллаборации.

См. также этапы 7–10 в [plan.md](./plan.md).
