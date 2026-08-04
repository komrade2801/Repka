# Frontend — документация

SPA Repka: импорт Excel, диаграмма Ганта, чат с AI и детали задачи.

## Стек

| Область | Библиотеки |
| --- | --- |
| Ядро | React 19, TypeScript, Vite 8 |
| Стили | Tailwind CSS 4 (`@tailwindcss/vite`), shadcn/ui, lucide-react, Geist |
| Данные | TanStack Query 5, axios, Zustand |
| Excel | xlsx (SheetJS), zod |
| Гантт | gantt-task-react |
| Чат / формы | react-markdown, react-hook-form |

Скрипты (`frontend/package.json`):

```bash
npm run dev      # Vite dev-server
npm run build    # tsc -b && vite build
npm run lint     # oxlint
npm run preview  # превью production-сборки
```

Алиас `@` → `src/` (`vite.config.ts`).

## Точка входа

`src/main.tsx` — `QueryClientProvider` + `App`.

`src/App.tsx`:

- `useQuery(['tasks'], fetchTasks)` — загрузка плана
- `useMutation(bulkCreateTasks)` — импорт; `onSuccess` → `invalidateQueries(['tasks'])`, закрытие диалога, toast
- Шапка «Repka / BIOCAD» + `RepkaLogo`, кнопки **Чат** / **Импорт** / **Экспорт** (импорт и экспорт рядом)
- `TaskDetailsDialog` — модалка выбранной задачи
- Состояния: скелетон Ганта / ошибка API / Гантт с данными
- `AppToaster` (`sonner`) — уведомления об импорте, экспорте и чате

## Структура `src/`

```
src/
├── App.tsx
├── main.tsx
├── index.css
├── api/
│   ├── tasks.ts          # fetchTasks, bulkCreateTasks (+ normalize priority)
│   └── chat.ts           # sendChatMessage → POST /chat
├── types/
│   ├── task.ts           # Task, TaskCreate, TaskPriority
│   └── chat.ts           # ChatMessage, ChatRequest/Response
├── lib/
│   ├── api.ts            # axios instance
│   ├── parse-excel.ts    # File → ImportParseResult (valid / errors / duplicates)
│   ├── export-excel.ts   # Task[] → скачивание .xlsx
│   ├── task-schema.ts    # zod-схемы импорта
│   ├── gantt-mapper.ts   # Task → gantt-task-react + цвета priority
│   ├── date.ts           # date helpers
│   └── utils.ts          # cn()
├── stores/
│   └── ui-store.ts       # selectedTaskId, isChatOpen, messages
└── components/
    ├── excel-upload.tsx
    ├── gantt-chart.tsx
    ├── chat-panel.tsx
    ├── task-details-dialog.tsx
    ├── repka-logo.tsx
    └── ui/               # button, card, dialog, input, textarea, label, scroll-area, skeleton, sonner
```

## API-клиент

`lib/api.ts`:

```ts
baseURL: import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000"
timeout: 10_000
```

`api/tasks.ts`:

| Функция | Метод | Путь |
| --- | --- | --- |
| `fetchTasks` | GET | `/tasks` |
| `bulkCreateTasks` | POST | `/tasks/bulk` с телом `{ tasks }` |

Ответы нормализуют `priority` (алиасы ru/en → канонические русские значения).

`api/chat.ts`:

| Функция | Метод | Путь | Таймаут |
| --- | --- | --- | --- |
| `sendChatMessage` | POST | `/chat` | 120 с |

Тип `Task` (`types/task.ts`) совпадает с бэкенд `TaskRead` (`start_date` — строка ISO `YYYY-MM-DD`, `priority` — один из `Критический` / `Высокий` / `Средний` / `Низкий` / `Опционально`).

## Импорт Excel

### UI — `ExcelUpload`

- Drag&drop и выбор файла (`.xlsx` / `.xls`)
- Вызов `parseExcelFile` → результат с валидными строками / ошибками / дубликатами
- Если замечаний нет — `onConfirm(valid)` и сохранение через API
- Если есть ошибки или дубликаты — **импорт не выполняется**, toast (`sonner`) со статистикой и примерами строк
- Fatal-ошибки файла (нет листа, нет колонок, пустой файл) — toast + текст в модалке
- Флаг `isUploading` от мутации родителя

### Парсинг — `parseExcelFile`

1. `FileReader` → `XLSX.read`
2. Первый лист → `sheet_to_json`
3. Маппинг русских заголовков (`Задача` → `title`) и legacy EN-ключей
4. Проверка обязательных колонок (Задача, Дата начала, Длительность)
5. Построчный `excelTaskSchema.safeParse` (пустые строки пропускаются)
6. Дубликаты: повтор названия задачи без учёта регистра (первая строка остаётся успешной)

### Схема — `task-schema.ts` + `excel-columns.ts`

Обязательные: `Задача`, `Дата начала`, `Длительность`.  
Опциональные: `Описание`, `Исполнитель`, `Предшественники`, `Приоритет`.

Особенности:

- Excel serial date → UTC-дата → `YYYY-MM-DD`
- `Длительность` — число ≥ 1 (сохраняется как целое)
- пустые опциональные поля → `null`
- `Приоритет` — только известные алиасы / канон; неизвестное значение → ошибка строки
- `Предшественники` — ID через запятую (`1,2`); иначе ошибка строки

## Экспорт Excel

`lib/export-excel.ts` (ExcelJS) + кнопка **Экспорт** в шапке:

- Берёт текущий массив задач из `useQuery(['tasks'])`
- Лист `Задачи`, русские заголовки с заглавной буквы
- Заголовок: жирный, размер 14; тело: 11
- Ширина колонок по контенту (с min/max)
- Закреплённая первая строка
- Имя файла: `repka-tasks-YYYY-MM-DD.xlsx`

Демо-файл для импорта: `samples/demo-tasks.xlsx` (~250 задач). Перегенерация:

```bash
node scripts/generate-demo-excel.mjs
```

## Диаграмма Ганта

`components/gantt-chart.tsx` — обёртка над `gantt-task-react`.

### Маппинг

`toGanttTasks` (`lib/gantt-mapper.ts`):

- `id` → string
- `name` ← `title`
- `start` ← `start_date`
- `end` ← start + `duration` дней
- `dependencies` ← split `predecessors`
- стили баров из `PRIORITY_COLORS` по `priority`

### Масштаб и навигация

| UI | Режим библиотеки | Поведение |
| --- | --- | --- |
| День | `ViewMode.Day` | Однодневное окно |
| Неделя | `ViewMode.Day` + кастомный хедер | Текущая календарная неделя Пн–Вс |
| Месяц | `ViewMode.Day` + кастомный хедер | Дни текущего месяца |

Кнопки **Назад / Сегодня / Вперёд** сдвигают `viewDate` (день / неделя / месяц).

Адаптивная ширина колонок через `ResizeObserver` и `computeMetrics`: при подгонке `timelineWidth` строго равен доступной ширине, пиксельный остаток (`available % columns`) распределяется алгоритмом +1px по первым колонкам (`getColumnWidth`), без горизонтального «разъезда» и без обрубка справа.

Горизонтальный скролл: только вид «Месяц» при открытом чате (`allowHorizontalScroll`), если колонки не влезают при `MIN_COL_WITH_SCROLL`. «День» и «Неделя» всегда подгоняют ширину колонок. Сетка дней рисуется своим оверлеем на всё окно (библиотека в Day mode обрезает ticks на ~task end + 19 дней).

При смене масштаба/ширины предыдущий кадр остаётся видимым до готовности следующего (без «мигания» скелетоном).

### Панель задач (task list)

Кастомные `TaskListHeader` / `TaskListTable`:

- колонки «Задача / Аватар исполнителя / Сроки» (`ДД.ММ — ДД.ММ`);
- на виде «День» колонка сроков по умолчанию скрыта;
- меню колонок (вкл/выкл исполнителей и сроков);
- сворачивание списка;
- ресайзер ширины панели.

### Тултипы

Hover по бару / аватару — fixed tooltip: название, исполнитель, приоритет, даты.

### Выбор задачи

`onClick` / `onSelect` → `useUiStore.setSelectedTaskId` → открывает `TaskDetailsDialog`.

## Чат с AI

`components/chat-panel.tsx` — боковая панель (на lg справа от Ганта, на узких экранах снизу).

1. Сообщения в Zustand (`messages`, `addMessage`).
2. Отправка через `useMutation(sendChatMessage)` с `history` без ошибочных реплик.
3. Ответ ассистента рендерится через `react-markdown`.
4. `onSuccess` → `invalidateQueries(['tasks'])` — Гантт обновляется после MCP-мутаций.
5. Спиннер (`Loader2`) на время запроса; ошибки — inline в ленте (`isError`).
6. Панель скрывается через `setChatOpen(false)`; кнопка «Чат» в шапке возвращает её.

## Модалка задачи

`components/task-details-dialog.tsx`:

- Открывается при ненулевом `selectedTaskId`.
- Поля через `react-hook-form` (read-only display): название, описание, исполнитель, приоритет, даты, зависимости с подписью предшественников.
- Правки плана в MVP — через чат, не через форму.

## Zustand

`stores/ui-store.ts`:

| Поле / метод | Назначение |
| --- | --- |
| `selectedTaskId` | Выбранная задача на Ганте / в модалке |
| `isChatOpen` | Видимость панели чата |
| `messages` | История чата |
| `setSelectedTaskId` / `setChatOpen` | Сеттеры UI |
| `addMessage` / `clearMessages` | Управление сообщениями |

## TanStack Query

| Ключ | Источник | Инвалидация |
| --- | --- | --- |
| `['tasks']` | `GET /tasks` | после `POST /tasks/bulk` и успешного `POST /chat` |

## UI-kit

shadcn-компоненты в `components/ui/` (`button`, `card`, `dialog`, `input`, `textarea`, `label`, `scroll-area`). Конфиг: `components.json`. Стили темы — `index.css` + CSS variables.

## Переменные окружения

| Переменная | Описание |
| --- | --- |
| `VITE_API_URL` | Базовый URL бэкенда; иначе `http://127.0.0.1:8000` |

Для Vercel (план этапа 6): задать URL задеплоенного API.

## Запуск

```bash
cd frontend
npm install
npm run dev
```

Нужен запущенный бэкенд на порту 8000 (или корректный `VITE_API_URL`) и `OPENROUTER_API_KEY` для чата. Для демо без Excel: `python seed.py` из `backend/`.

## Планируемое (этап 6+)

- Деплой Render / Vercel
- Расширенный README, `Roadmap-to-production.md`, демо-видео

## Связанные документы

- [Обзор приложения](./app.md)
- [Backend](./backend.md)
