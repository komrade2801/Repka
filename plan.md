# План реализации MVP: AI-native Диаграмма Гантта

## 🛠 Стек технологий

### Frontend
* **Ядро:** React + TypeScript, сборщик **Vite**
* **UI / Стилизация:** **Tailwind CSS** + **shadcn/ui** + **lucide-react** (иконки)
* **Диаграмма Гантта:** **gantt-task-react**
* **Управление состоянием:**
  * **Zustand** — клиентское состояние (UI чата, модалки, выбранная задача)
  * **TanStack Query (React Query)** — серверное состояние (кеширование задач, синхронизация с бэкендом, инвалидация данных)
* **Работа с Excel и валидация:**
  * **xlsx (SheetJS)** — парсинг и экспорт Excel в браузере
  * **zod** — схема валидации (проверка структуры файла перед отправкой)
  * **react-hook-form** — управление формами в модалке задачи
* **Сеть и рендер:** **axios** (API запросы), **react-markdown** (рендер ответов LLM)

### Backend
* **Ядро:** Python 3.10+ + **FastAPI**
* **База данных и ORM:** **SQLAlchemy 2.0** + **Pydantic**
* **AI и Интеграция:**
  * **openai** — SDK для запросов к OpenRouter (модель по умолчанию `openai/gpt-4o-mini`)
  * **mcp** — официальный Python SDK для Model Context Protocol

---

## 🏗 Архитектурные решения (ADR)

1. **База данных (SQLite ➔ PostgreSQL):** 
   В рамках MVP для упрощения проверки ревьюером используется локальная SQLite. Архитектура построена через SQLAlchemy так, чтобы переход на PostgreSQL в production требовал изменения лишь одной переменной окружения `DATABASE_URL` без переписывания моделей.
2. **Идентичность задач (MVP → prod):**
   В MVP — `int` PK + autoincrement (SQLAlchemy). После MVP / при переезде на PostgreSQL — заменить на **UUID** (`gen_random_uuid()` / uuid4) и предпочтительно вынести зависимости в join-таблицу `task_dependencies` вместо строки `"1,2"`. Пока int достаточно для демо и Excel; не считать `1..N` из старого bulk моделью идентичности навсегда.
3. **Парсинг и валидация на клиенте:** 
   Excel-файл читается библиотекой `xlsx` на фронтенде и превращается в JSON. Затем прогоняется через жесткую схему `zod` (проверка типов, дат и обязательных колонок). Ошибки отлавливаются до сетевого запроса, снижая нагрузку на бэкенд и ускоряя обратную связь для пользователя.
4. **Импорт Excel = append, не wipe:**
   Полная замена плана через `POST /tasks/bulk` снимается. Импорт **добавляет** только новые задачи с уникальным `title` (относительно уже существующих в БД и внутри файла); дубликаты пропускаются с отчётом. Ручной CRUD при этом **допускает** одинаковые названия.
5. **Реактивность состояния:** 
   Изменения (чат, CRUD, импорт) идут через мутации TanStack Query; `onSuccess` → `invalidateQueries(['tasks'])` без optimistic updates. Гантт обновляется из реальных данных API.
6. **Зависимости — слой A (граф), без автосдвига дат:**
   Валидация write-путей: существование predecessor, запрет self-ref, ацикличность; при `DELETE` — очистка ссылок у зависимых. Правило FS «последователь не раньше окончания предшественника» и автопересчёт `start_date` — **слой B**, отдельно и позже (см. этап 7), в MVP не включаем.

---

## 🗺 Roadmap (Пошаговый план разработки)

### Этап 1: Инициализация проекта и БД
- [x] Настройка монорепозитория (папки `/frontend` и `/backend`).
- [x] Инициализация Vite (React + TS) и установка базовых зависимостей (`tailwind`, `shadcn/ui`, `zustand`, `@tanstack/react-query`, `axios`).
- [x] Инициализация FastAPI (создание `venv`, установка `sqlalchemy`, `pydantic`, настройка CORS).
- [x] Создание моделей БД (таблица `Task`: id, title, description, assignee, start_date, duration, predecessors, **priority**).
- [x] Подготовка SQLite через `DATABASE_URL` (+ `ensure_sqlite_columns` для миграции `priority` на существующих БД).

### Этап 2: Загрузка данных и Диаграмма Гантта
- [x] Создание UI-компонента загрузки Excel (Drag&Drop / Input).
- [x] Написание логики парсинга `xlsx` в JSON-массив.
- [x] Написание схемы `zod` для проверки колонок загруженного файла (в т.ч. опциональный `priority`).
- [x] Создание API-эндпоинта `POST /tasks/bulk` для сохранения распарсенных данных в БД. *(на этапе 6 снимается: импорт → append уникальных)*
- [x] Интеграция `gantt-task-react`: создание компонента-обертки для рендера SVG на основе массива из БД.
- [x] *(сверх плана)* Масштаб День/Неделя/Месяц, навигация по периоду, панель задач (аватар, сроки, ресайз, меню колонок), цвет баров по `priority`, тултипы.

### Этап 3: Подключение AI и MCP (Ключевой этап)
- [x] Интеграция Python SDK `mcp` и `openai`.
- [x] Регистрация MCP Tools на бэкенде:
  - `move_task(task_id, new_start_date)`
  - `assign_task(task_id, assignee)`
  - `add_dependency(task_id, predecessor_id)`
- [x] Настройка системного промпта и логики tool calling через OpenRouter (модель задаётся `OPENROUTER_MODEL`, по умолчанию `openai/gpt-4o-mini`).
- [x] Создание API-эндпоинта `POST /chat` (принимает запрос -> дергает LLM -> выполняет tool -> меняет БД -> возвращает текст ответа).

### Этап 4: Интерфейс Чата и Детали Задачи
- [x] Верстка боковой панели чата (Side-by-side) с помощью `shadcn/ui`.
- [x] Настройка `Zustand` для хранения стейта сообщений.
- [x] Интеграция `react-markdown` для отображения ответов AI.
- [x] Привязка отправки сообщения к мутации `TanStack Query` и обновлению Гантта.
- [x] Разработка модального окна задачи (компонент Dialog):
  - Открытие по клику на задачу в `gantt-task-react`.
  - Отображение полей, зависимостей, исполнителя и приоритета.
  - Подключение `react-hook-form` для отображения (и опционального редактирования) данных.

### Этап 5: Экспорт и Финализация
- [x] Реализация функции экспорта: кнопка **Экспорт** рядом с **Импорт**, генерация Excel из кэша `TanStack Query` (`lib/export-excel.ts` + `xlsx`).
- [x] Полировка UI/UX: скелетон загрузки Ганта, тосты (`sonner`) для импорта / экспорта / чата.
- [x] Импорт с построчной валидацией: форматы данных, неизвестный `priority`, `predecessors`, дубликаты названий; при любых замечаниях — toast с деталями, импорт не выполняется. *(на этапе 6: вместо wipe — append только уникальных `title`)*
- [x] Подготовка демо-данных: `backend/seed.py` (~250 задач) + `samples/demo-tasks.xlsx` (генерация: `node scripts/generate-demo-excel.mjs`).

### Этап 6: Расширение CRUD и ручное управление

#### Решения (зафиксировано)

- **API:** `POST /tasks`, `PATCH /tasks/{id}` (частичное обновление), `DELETE /tasks/{id}`. Полный `PUT` не используем.
- **ID:** `int` PK + autoincrement при создании. *После MVP → UUID + (желательно) join-таблица зависимостей — см. ADR и `Roadmap-to-production.md`.*
- **Поля:** редактируются все, кроме `id` (и руками, и ботом — один контракт).
- **Дубликаты `title`:** CRUD допускает; импорт Excel добавляет только уникальные относительно БД и файла.
- **Зависимости (слой A):** на write — проверка существования predecessor, запрет self-ref, ацикличность; дубликаты в списке схлопывать. Даты **не** пересчитываем.
- **Удаление:** чистить `predecessors` у всех задач, ссылавшихся на удалённый id.
- **`POST /tasks/bulk`:** удалить. Импорт перевести на добавление новых уникальных задач (новый эндпоинт, напр. `POST /tasks/import`, или пакетный `POST` append).
- **Безопасность (без auth):** rate limiting (жёстче на mutate + `/chat`), лимиты длины полей / тела, только ORM, CORS сужать в prod.
- **Состояние:** хук мутаций (напр. `useTaskMutations`); только `invalidateQueries(['tasks'])`, без optimistic UI.
- **Чат ↔ модалка:** при открытой модалке чат недоступен (дизейбл / закрыть панель). Пока форма открыта — не делать `reset` поверх dirty-состояния из кэша; после Save — закрыть.

#### Backend
- [x] Схемы: `TaskUpdate` (все поля Optional), ответ `TaskRead`; общая валидация predecessors (слой A) для create / patch / import.
- [x] `POST /tasks` — создание с autoincrement id; дефолты на UI: `start_date` = сегодня, `duration` = 1, `priority` = Средний, пустые description/assignee/predecessors.
- [x] `PATCH /tasks/{id}` — частичное обновление; 404 если нет задачи; 422 при ошибке графа зависимостей.
- [x] `DELETE /tasks/{id}` — удаление + cleanup ссылок у зависимых; 204.
- [x] Убрать `POST /tasks/bulk` (wipe+insert). Добавить `POST /tasks/import` (append уникальных `title`); ответ — `created` + `skipped`.
- [x] Rate limiting + базовые лимиты на mutate-эндпоинты и `/chat`.

#### Frontend — API и хук
- [x] API-слой: `createTask` / `updateTask` / `deleteTask` / `importTasks` в `api/tasks.ts` (axios), типы по схемам бэкенда.
- [x] Хук `useTaskMutations`: мутации create/update/delete/import; `onSuccess` → `invalidateQueries(['tasks'])` + toast; ошибки → toast.

#### Frontend — модалка и создание
- [x] Рефакторинг `TaskDetailsDialog`: редактируемая форма на `react-hook-form` + **zod** (`@hookform/resolvers`); кнопки «Сохранить» / «Удалить».
- [x] Поля: title, description, assignee, start_date, duration; **priority** — `select` из канона; **predecessors** — мультиселект с поиском по задачам (в API уходит строка/список id).
- [x] При открытии — `reset()` значениями выбранной задачи.
- [x] «Сохранить» → `updateTask` (`PATCH`) / `createTask` (`POST`); `isPending` → disabled + индикатор; успех — toast + **закрыть** модалку; ошибка — toast.
- [x] «Удалить» → подтверждение (Dialog) → `deleteTask`; успех — закрыть, сбросить `selectedTaskId`, toast.
- [x] Закрытие Esc / outside — **молча сбросить** форму (без confirm несохранённых правок).
- [x] Кнопка «+» (создать задачу) в тулбаре шапки → модалка create с дефолтами → `createTask` (`POST /tasks`).
- [x] При открытой модалке — чат недоступен.

#### Frontend — импорт
- [x] Переключить импорт с bulk-wipe на `importTasks` (append уникальных); toast со статистикой созданных / пропущенных дубликатов.
- [x] Клиентская проверка дубликатов внутри файла сохранить; сверка с уже загруженным планом — на бэкенде (источник истины).

### Этап 7: Расширение возможностей агента (MCP Tools)
- [x] Backend: Добавить инструмент `create_task`.
- [x] Backend: Добавить инструмент `delete_task` (с cleanup ссылок, как в CRUD).
- [x] Backend: Добавить инструменты `update_task_duration`, `update_task_priority`, `remove_dependency`.
- [x] Backend: Tools create/update зависимостей используют ту же валидацию слоя A, что и HTTP CRUD.
- [ ] *(слой B, опционально / после MVP)* Автопересчёт `start_date` последователя при `add_dependency` (FS: не раньше окончания предшественника) — отдельный флаг/поведение, не смешивать с обязательной валидацией графа.

### Этап 8: Enterprise UI/UX (BIOCAD Style) и Навигация
- [ ] Дизайн: Упростить шапку (убрать подзаголовки, сделать чистый белый фон, тонкий border-bottom, строгий логотип). Шрифт зафиксировать на Inter/Geist 400–500.
- [x] Данные: Поле `priority` (Low, Medium, High, Critical) в БД и парсинг Excel — сделано на этапах 1–2.
- [x] UI Гантта: Динамическая раскраска баров задач в зависимости от `priority` — сделано на этапе 2.
- [x] UI Гантта: Добавить колонку "Исполнитель" в левую таблицу (`TaskListTable`).
- [x] UI Гантта: Панель навигации по времени (`< Назад`, `Сегодня`, `Вперед >` через `viewDate`) — сделано на этапе 2.
- [ ] UI Гантта: Новый view «сплошной таймлайн» — непрерывная шкала без фиксированного окна День/Неделя/Месяц; горизонтальный скролл по всему горизонту плана, без «прыжков» `viewDate`.
- [x] UX: Над диаграммой слева от слайдера даты — поле поиска по совпадениям во всей строке задачи (ширина = колонка «Задача»). В таблице: сортировка по возрастанию/убыванию по клику на заголовки колонок.
- [ ] UX: Улучшить индикацию загрузки в чате (показывать статус «Агент думает / Вызывает инструменты»).

### Этап 9: Правки ассистента (MCP Tools + контекст)

Цель: ассистент опирается на SQL-тулы и актуальное время, а не на огромный снимок плана в промпте. Без аналитики/поиска LLM галлюцинирует на запросах вроде «Сколько задач у Алексея?». Массовые операции и автосдвиг закрывают сценарии, которые руками делать долго.

#### 🔴 Приоритет 1 (CRITICAL) — Время, поиск, grounding

##### Учёт текущего времени (МСК)
- [x] Backend: при каждом `run_chat` вычислять текущую дату и день недели по `Europe/Moscow` и подставлять в system prompt.
  - Зачем: корректная интерпретация «сегодня», «завтра», «до конца недели» → ISO `DD-MM-YYYY`.

##### Точечный поиск (`search_tasks`)
- [x] Backend: `get_project_summary` — `COUNT` / `GROUP BY` assignee и priority (`assignee?`, `priority?`).
- [x] Backend: базовый `search_tasks` — фильтр по `query` (title/description), `assignee`, `priority`, `limit` (default 10).
- [x] Backend: расширить `search_tasks` диапазоном дат старта/финиша (SQL-фильтрация на бэкенде).
  - Зачем: «просроченные», «что стартует на этой неделе» без передачи всего списка задач модели.
- [x] Backend: `search_tasks(on_date=…)` — пересечение рабочих интервалов (`Start ≤ date ≤ Finish`, `Finish = start + duration − 1`); правило в system prompt для «задачи на сегодня / на дату X».

##### Актуальность данных (Grounding & History Cleanup)
- [x] Backend: убрать статичный `task_snapshot` (markdown-таблицу всех задач) из system prompt — экономия токенов.
- [x] Backend / промпт: grounding rule — не доверять старым ID и состояниям из истории диалога; перед мутацией обязательно запрашивать свежие данные через search/summary.
- [x] Backend: tool stripping — в history сохранять реплики user/assistant, но устаревшие `tool`-результаты (старше 2–3 раундов) сжимать или очищать перед отправкой в LLM.
  - Зачем: нет рассинхрона после ручных правок в UI и не раздувается контекст.

#### 🟡 Приоритет 2 (HIGH) — Массовые операции (Bulk Actions)
Главная фишка AI-native трекера: то, что руками делать долго. Одну задачу можно править в модалке; перенести 5 задач одним запросом — супер-сила LLM. Отдельный bulk-тул нужен, потому что 10 последовательных `move_task` исчерпают `MAX_TOOL_ROUNDS = 6` и упадут по таймауту.
- [x] Backend: `bulk_move_tasks` / `bulk_assign_tasks`.
  - Зачем: «Перенеси все задачи Алексея на следующую неделю», «Назначь все критические задачи на Ивана».
  - Аргументы: `task_ids: list[int]`, `new_start_date` / `new_assignee`.
- [x] Backend: `bulk_delete_tasks`.
  - Зачем: «Удали все задачи со статусом Опционально», «Очисти задачи Ивана».

#### 🟢 Приоритет 3 (MEDIUM) — Умное управление связями и расписанием
Делает систему «умной» и закрывает бизнес-логику Ганта (слой B).
- [ ] Backend: `auto_reschedule_dependents` (или параметр автосдвига у `move_task`).
  - Зачем: при переносе предшественника ведомые задачи на Ганте сдвигаются вправо, чтобы не ломать FS (Finish-to-Start).
  - Реализация: `move_task(..., shift_dependents=True)` → каскадно обновить `start_date` зависимых через граф из `task_graph.py`.
- [ ] Backend: `clear_task_assignee` / `remove_all_dependencies`.
  - Зачем: точечная очистка полей без передачи `None` / пустых строк.

### Этап 10: Деплой (Render + Vercel) и документация сдачи

Цель: ревьюер открывает URL → видит засидированный Гантт → может импортировать Excel, править через чат, экспортировать. В репо — README / Roadmap / демо / sample Excel (требования ТЗ).

#### A. Подготовка монорепы (код и конфиг) — до нажатия Deploy

##### Конфиг и секреты
- [x] `.env.example`: только плейсхолдеры (`OPENROUTER_API_KEY=`, без реального ключа); добавить `CORS_ORIGINS`, `VITE_API_URL` (для фронта — комментарий / отдельный блок).
- [x] Backend `Settings`: читать `CORS_ORIGINS` из env (CSV или JSON-список), не только localhost:5173 — иначе прод-фронт на Vercel получит CORS-блок.

##### Backend — совместимость с Linux / Render
- [x] Убрать безусловный `pywin32` из `requirements.txt`: оставить `pywin32>=311; sys_platform == "win32"` (как в metadata `mcp`); на Linux маркер пропускает пакет. `tzdata` оставлен (МСК). Файл перезаписан в UTF-8 (был UTF-16 — ломал `pip` в Docker/Render).
- [x] Проверить, что все зависимости ставятся на Linux: `docker run python:3.12-slim` + `pip install -r requirements.txt` + `scripts/verify_requirements.py` → `LINUX_REQUIREMENTS_OK`; `pywin32` не ставится. При переходе на Postgres — добавить драйвер (`psycopg[binary]` / `psycopg2-binary`) в requirements.
- [x] `Dockerfile` в `backend/` (+ `.dockerignore`):
  - base: `python:3.12-slim`;
  - `WORKDIR /app`, copy `requirements.txt` → `pip install --no-cache-dir`;
  - copy `app/` + `seed.py`;
  - `CMD` через uvicorn **без** `--reload`: `uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}` (Render передаёт `PORT`);
  - `HEALTHCHECK` на `GET /health`. Проверено: `docker build` + `GET /health` → `{"status":"ok"}`.
- [ ] Документировать стратегию БД на Render:
  - **демо-минимум:** SQLite + **Persistent Disk** (путь файла на диске, напр. `/data/repka.db` → `DATABASE_URL=sqlite:////data/repka.db`) **или** seed на каждый cold start без диска (данные эфемерны);
  - **предпочтительно для сдачи:** managed Postgres (`DATABASE_URL=postgresql+psycopg://…`) — модели уже SQLAlchemy; `ensure_sqlite_columns` на PG не мешает (no-op / skip).

##### Frontend — совместимость с Vercel
- [ ] Сборка из `frontend/` (Root Directory = `frontend` в Vercel): `npm install` + `npm run build`, Output = `dist`.
- [ ] Env на Vercel: `VITE_API_URL=https://<render-service>.onrender.com` (без trailing slash; подставляется на **build**-time).
- [ ] Опционально `frontend/vercel.json`: SPA fallback не обязателен (нет client-router), можно пустой / не добавлять.
- [ ] Прогнать локально `npm run build` — убедиться, что production-сборка зелёная до деплоя.
- [ ] Таймаут чата: фронт уже 120 с; на Render Free cold start + LLM могут упираться в gateway — в README предупредить; при необходимости статус «Агент думает» (этап 8) или увеличить timeout сервиса.

##### Репозиторий / артефакты ТЗ (файлы в монорепе)
- [ ] Sample Excel: `samples/demo-tasks.xlsx` уже есть; опционально добавить короткий `samples/demo-tasks-small.xlsx` (~10–15 строк) для видео и быстрой проверки.
- [ ] `Roadmap-to-production.md` в корне: PostgreSQL, int→UUID, join `task_dependencies`, Auth, WebSockets, merge-импорт, слой B (FS auto-shift), риски (стоимость LLM, rate limit, отсутствие multi-tenant), порядок закрытия.
- [ ] Расширить `README.md`:
  - быстрый старт (local);
  - архитектура + ключевые ADR (кратко + ссылки на `docs/`);
  - **отдельный раздел: использование AI-ассистентов при разработке** (требование ТЗ);
  - деплой: Render (backend) + Vercel (frontend), список env;
  - ссылки на sample Excel, Roadmap, демо-видео.
- [ ] Демо-видео / GIF: Excel → чат (мутация) → Гантт обновился → экспорт; положить в `docs/demo.gif` / `docs/demo.mp4` или ссылку в README.
- [ ] Подтянуть устаревшие места в `docs/app.md` (snapshot задач в промпте уже убран) перед сдачей.

#### B. Деплой (порядок действий на хостингах)

##### Render (API)
- [ ] New → Web Service → connect repo → Docker (`backend/Dockerfile`) **или** Native: root `backend`, build `pip install -r requirements.txt`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- [ ] Env: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (опц.), `CORS_ORIGINS=https://<vercel-app>.vercel.app`, `AUTO_SEED=true`, `DATABASE_URL` (disk/Postgres).
- [ ] Persistent Disk (если SQLite) или Postgres addon; проверить `GET /health` → `{"status":"ok"}`.
- [ ] После первого деплоя фронта — дописать точный Vercel origin в `CORS_ORIGINS` и redeploy API при необходимости.

##### Vercel (SPA)
- [ ] Import repo → Root Directory `frontend` → Framework Vite → Build `npm run build` → Output `dist`.
- [ ] Env: `VITE_API_URL` = публичный URL Render; **Redeploy** после смены env (Vite inlines на build).
- [ ] Проверка: открыть сайт → задачи на Ганте (seed) → Импорт / Чат / Экспорт / модалка.

#### C. Чеклист приёмки перед отправкой ТЗ
- [ ] Прод-URL открывается без локального бэкенда; CORS ок; чат отвечает (ключ валиден).
- [ ] Сценарий ТЗ на проде пройден вручную.
- [ ] В репо: README (архитектура + AI-ассистенты) + Roadmap + sample Excel + демо + ссылки на git и deployed app.

---

## Статус на сейчас

| Этап | Статус |
| --- | --- |
| 1–7 | **готово** (этап 7: слой B опционально — не делали) |
| 8 | **частично** — priority / раскраска / навигация / исполнитель / поиск+сортировка есть; остаётся шапка, сплошной таймлайн, статус чата |
| 9 | **частично** — P1+P2 готовы; остаётся P3 (автосдвиг / clear fields) |
| 10 | **не начат** (кроме черновика README + sample Excel); блок A — подготовка монорепы перед Render/Vercel |
