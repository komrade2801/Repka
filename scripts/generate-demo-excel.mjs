/**
 * Generate samples/demo-tasks.xlsx (~250 unique tasks) for import demos.
 *
 * Usage (from repo root):
 *   node scripts/generate-demo-excel.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../frontend/package.json"))
const XLSX = require("xlsx")

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, "../samples/demo-tasks.xlsx")
const COUNT = 250

// Deterministic PRNG (mulberry32)
function mulberry32(seed) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(42)
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1))
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const weighted = (items, weights) => {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

const ASSIGNEES = [
  "Иванова Анна",
  "Петров Сергей",
  "Сидорова Мария",
  "Козлов Дмитрий",
  "Новикова Елена",
  "Морозов Алексей",
  "Волкова Ольга",
  "Соколов Иван",
  "Лебедева Наталья",
  "Кузнецов Павел",
]

const PRIORITIES = ["Низкий", "Средний", "Высокий", "Критический", "Опционально"]
const PRIORITY_WEIGHTS = [18, 45, 20, 7, 10]

const PHASES = [
  [
    "Инициация",
    [
      ["Устав проекта", "Формирование и утверждение устава", [2, 5]],
      ["Стейкхолдеры", "Идентификация и анализ стейкхолдеров", [3, 7]],
      ["Kick-off встреча", "Проведение стартовой встречи команды", [1, 2]],
      ["Критерии успеха", "Согласование KPI и критериев приёмки", [2, 4]],
      ["Реестр рисков", "Первичный реестр рисков проекта", [3, 5]],
      ["Коммуникации", "План коммуникаций и эскалаций", [2, 4]],
      ["Бюджет baseline", "Согласование базового бюджета", [3, 6]],
      ["RACI матрица", "Распределение ролей и ответственности", [2, 4]],
    ],
  ],
  [
    "Аналитика",
    [
      ["Сбор требований", "Интервью и сбор функциональных требований", [5, 12]],
      ["AS-IS процессы", "Описание текущих бизнес-процессов", [4, 8]],
      ["TO-BE процессы", "Проектирование целевых процессов", [5, 10]],
      ["User stories", "Написание пользовательских историй", [4, 9]],
      ["Нефункциональные требования", "NFR: perf, security, compliance", [3, 6]],
      ["Анализ интеграций", "Карта внешних и внутренних интеграций", [4, 8]],
      ["Модель данных", "Концептуальная и логическая модель данных", [5, 10]],
      ["Матрица трассировки", "Трассировка требований к фичам", [3, 6]],
      ["Gap-анализ", "Анализ разрывов текущего и целевого состояния", [4, 7]],
      ["Спецификация API", "Черновик контрактов REST API", [4, 8]],
      ["Acceptance criteria", "Критерии приёмки по эпикам", [3, 5]],
      ["Ревью аналитики", "Согласование аналитики со стейкхолдерами", [2, 4]],
    ],
  ],
  [
    "Дизайн",
    [
      ["Information architecture", "Структура экранов и навигации", [3, 6]],
      ["Wireframes", "Низкодетализированные макеты", [4, 8]],
      ["UI kit", "Базовые компоненты дизайн-системы", [5, 10]],
      ["High-fidelity макеты", "Детализированные макеты ключевых экранов", [6, 12]],
      ["Прототип кликабельный", "Интерактивный прототип для демо", [4, 8]],
      ["UX research", "Юзабилити-тесты прототипа", [3, 7]],
      ["Дизайн форм", "Макеты сложных форм и валидаций", [3, 6]],
      ["Адаптив mobile", "Адаптация под мобильные разрешения", [4, 7]],
      ["Иконки и иллюстрации", "Набор иконок и визуальных акцентов", [2, 5]],
      ["Design review", "Ревью дизайна с продуктом", [1, 3]],
    ],
  ],
  [
    "Backend",
    [
      ["Схема БД", "Миграции и схема таблиц", [3, 6]],
      ["Auth сервис", "Аутентификация и авторизация", [5, 10]],
      ["CRUD задач", "API создания/чтения/обновления задач", [4, 8]],
      ["Bulk import", "Массовый импорт задач", [3, 6]],
      ["Зависимости задач", "Логика predecessors и валидация", [4, 7]],
      ["Поиск и фильтры", "Фильтрация и поиск по задачам", [3, 6]],
      ["Экспорт Excel", "Генерация Excel из текущего плана", [3, 5]],
      ["Chat API", "Эндпоинт AI-чата", [4, 8]],
      ["MCP tools", "Инструменты агента для мутаций", [5, 9]],
      ["Интеграция LLM", "OpenRouter / tool calling loop", [4, 8]],
      ["Логирование", "Структурированные логи и audit trail", [2, 5]],
      ["Rate limiting", "Ограничение частоты запросов", [2, 4]],
      ["Health checks", "Пробы готовности сервиса", [1, 3]],
      ["Unit-тесты API", "Покрытие ключевых эндпоинтов", [4, 8]],
      ["Миграции данных", "Скрипты миграции и rollback", [3, 6]],
    ],
  ],
  [
    "Frontend",
    [
      ["Каркас приложения", "Роутинг, layout, providers", [3, 6]],
      ["Таблица задач", "Список задач с колонками", [4, 7]],
      ["Диаграмма Гантта", "Интеграция gantt-компонента", [6, 12]],
      ["Загрузка Excel", "Drag&drop и парсинг xlsx", [4, 8]],
      ["Валидация Zod", "Схемы валидации импорта", [2, 4]],
      ["Модалка задачи", "Диалог деталей и редактирования", [4, 7]],
      ["Панель чата", "Side panel AI-ассистента", [5, 9]],
      ["Markdown ответы", "Рендер ответов агента", [2, 4]],
      ["Фильтры Гантта", "Поиск по исполнителю и названию", [3, 5]],
      ["Навигация по датам", "Кнопки назад / сегодня / вперёд", [2, 4]],
      ["Приоритеты UI", "Раскраска баров по priority", [2, 4]],
      ["Тосты и ошибки", "Уведомления об ошибках API", [2, 4]],
      ["Скелетоны загрузки", "Состояния loading", [2, 3]],
      ["Адаптив layout", "Адаптация под разные ширины", [3, 6]],
      ["E2E смоук", "Базовые e2e сценарии", [3, 6]],
    ],
  ],
  [
    "Интеграции",
    [
      ["Коннектор CRM", "Синхронизация с CRM", [5, 10]],
      ["SSO / OIDC", "Подключение корпоративного SSO", [6, 12]],
      ["Webhooks исходящие", "События изменений задач", [3, 6]],
      ["Очередь сообщений", "Асинхронная обработка событий", [4, 8]],
      ["Файловое хранилище", "S3-совместимое хранение вложений", [4, 7]],
      ["Уведомления email", "Рассылка по смене статусов", [3, 6]],
      ["Календарь sync", "Экспорт сроков в календарь", [3, 5]],
      ["Мониторинг APM", "Метрики и трейсы", [3, 6]],
    ],
  ],
  [
    "QA",
    [
      ["Тест-план", "План тестирования релиза", [3, 5]],
      ["Тест-кейсы API", "Набор кейсов для API", [4, 8]],
      ["Тест-кейсы UI", "Сценарии UI-регрессии", [4, 8]],
      ["Нагрузочное тестирование", "Нагрузка на критичные эндпоинты", [3, 6]],
      ["Security scan", "Сканирование зависимостей и OWASP", [2, 5]],
      ["Регресс спринт 1", "Регрессионный прогон после спринта 1", [3, 5]],
      ["Регресс спринт 2", "Регрессионный прогон после спринта 2", [3, 5]],
      ["UAT подготовка", "Подготовка среды и сценариев UAT", [3, 6]],
      ["UAT проведение", "Проведение приёмочного тестирования", [5, 10]],
      ["Баг-башинг", "Сессия поиска дефектов", [2, 4]],
      ["Чеклист релиза", "Финальный чеклист перед выкладкой", [1, 3]],
    ],
  ],
  [
    "Документация",
    [
      ["README", "Инструкция по запуску", [1, 3]],
      ["API docs", "Описание HTTP API", [2, 4]],
      ["Админ-гайд", "Руководство администратора", [3, 5]],
      ["User guide", "Руководство пользователя", [4, 7]],
      ["Runbook", "Операционный runbook инцидентов", [2, 4]],
      ["Архитектурный ADR", "Фиксация ключевых ADR", [2, 4]],
      ["Roadmap production", "План переезда на production", [2, 4]],
    ],
  ],
  [
    "Релиз",
    [
      ["Staging деплой", "Выкладка на staging", [2, 4]],
      ["Smoke staging", "Смоук после выкладки на staging", [1, 3]],
      ["Prod деплой", "Выкладка в production", [2, 3]],
      ["Post-release мониторинг", "Мониторинг после релиза", [3, 5]],
      ["Ретроспектива", "Ретро команды по итогам", [1, 2]],
      ["Закрытие проекта", "Формальное закрытие и handoff", [2, 4]],
    ],
  ],
]

function toISODate(d) {
  return d.toISOString().slice(0, 10)
}

function addDays(d, days) {
  const next = new Date(d)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function buildRows(count) {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const horizonEnd = addDays(today, 90)

  const catalog = []
  for (const [phaseName, items] of PHASES) {
    for (const [title, desc, dur] of items) {
      catalog.push([phaseName, title, desc, dur])
    }
  }

  const specs = []
  const assigneeCursor = Object.fromEntries(ASSIGNEES.map((n) => [n, 0]))
  const phaseLastIds = {}

  let i = 0
  while (specs.length < count) {
    const [phaseName, titleBase, descBase, durRange] = catalog[i % catalog.length]
    const wave = Math.floor(i / catalog.length)
    const suffix = wave > 0 ? ` #${wave + 1}` : ""

    const assignee = ASSIGNEES[i % ASSIGNEES.length]
    const duration = randInt(durRange[0], durRange[1])
    const priority = weighted(PRIORITIES, PRIORITY_WEIGHTS)

    let offset = assigneeCursor[assignee] + randInt(0, 2)
    let start = addDays(today, offset)
    if (start > horizonEnd) {
      start = addDays(today, randInt(0, 80))
    }

    const endOffset = (start - today) / 86400000 + duration + randInt(0, 2)
    assigneeCursor[assignee] = Math.min(endOffset, 88)

    const taskId = specs.length + 1
    let predecessors = ""

    if (taskId > 1 && rand() < 0.45) {
      const pool = phaseLastIds[phaseName] ?? []
      let pred
      if (pool.length && rand() < 0.7) {
        pred = pick(pool.slice(-3))
      } else {
        pred = randInt(1, taskId - 1)
      }
      if (taskId > 5 && rand() < 0.15) {
        let pred2 = randInt(1, taskId - 1)
        while (pred2 === pred) pred2 = randInt(1, taskId - 1)
        predecessors = [pred, pred2].sort((a, b) => a - b).join(",")
      } else {
        predecessors = String(pred)
      }

      const predSpec = specs[pred - 1]
      const predEnd = addDays(new Date(predSpec.start_date), predSpec.duration)
      if (start < predEnd) {
        start = predEnd
        if (start > horizonEnd) {
          start = addDays(horizonEnd, -duration)
        }
      }
    }

    if (!phaseLastIds[phaseName]) phaseLastIds[phaseName] = []
    phaseLastIds[phaseName].push(taskId)

    specs.push({
      title: `${phaseName}: ${titleBase}${suffix}`,
      description: `${descBase}. Фаза «${phaseName}».`,
      assignee,
      start_date: toISODate(start),
      duration,
      predecessors,
      priority,
    })
    i += 1
  }

  return specs
}

const rows = buildRows(COUNT).map((row) => ({
  Задача: row.title,
  Описание: row.description,
  Исполнитель: row.assignee,
  "Дата начала": row.start_date,
  Длительность: row.duration,
  Предшественники: row.predecessors,
  Приоритет: row.priority,
}))
const sheet = XLSX.utils.json_to_sheet(rows, {
  header: [
    "Задача",
    "Описание",
    "Исполнитель",
    "Дата начала",
    "Длительность",
    "Предшественники",
    "Приоритет",
  ],
})
const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(workbook, sheet, "Задачи")

mkdirSync(dirname(OUT), { recursive: true })
const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })
writeFileSync(OUT, buffer)
console.log(`Wrote ${rows.length} tasks → ${OUT}`)
