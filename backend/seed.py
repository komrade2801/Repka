"""Seed the database with a demo project plan.

Usage (from backend/):
    python seed.py
"""

from __future__ import annotations

import random
from datetime import date, timedelta

from app.database import Base, SessionLocal, engine, ensure_sqlite_columns
from app.models import Task, TaskPriority

# Fixed seed for reproducible demo data
random.seed(42)

ASSIGNEES = [
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

PRIORITIES = [
    TaskPriority.LOW.value,
    TaskPriority.MEDIUM.value,
    TaskPriority.HIGH.value,
    TaskPriority.CRITICAL.value,
    TaskPriority.OPTIONAL.value,
]
PRIORITY_WEIGHTS = [18, 45, 20, 7, 10]

# Phase templates: (title prefix, description template, typical duration range)
PHASES: list[tuple[str, list[tuple[str, str, tuple[int, int]]]]] = [
    (
        "Инициация",
        [
            ("Устав проекта", "Формирование и утверждение устава", (2, 5)),
            ("Стейкхолдеры", "Идентификация и анализ стейкхолдеров", (3, 7)),
            ("Kick-off встреча", "Проведение стартовой встречи команды", (1, 2)),
            ("Критерии успеха", "Согласование KPI и критериев приёмки", (2, 4)),
            ("Реестр рисков", "Первичный реестр рисков проекта", (3, 5)),
            ("Коммуникации", "План коммуникаций и эскалаций", (2, 4)),
            ("Бюджет baseline", "Согласование базового бюджета", (3, 6)),
            ("RACI матрица", "Распределение ролей и ответственности", (2, 4)),
        ],
    ),
    (
        "Аналитика",
        [
            ("Сбор требований", "Интервью и сбор функциональных требований", (5, 12)),
            ("AS-IS процессы", "Описание текущих бизнес-процессов", (4, 8)),
            ("TO-BE процессы", "Проектирование целевых процессов", (5, 10)),
            ("User stories", "Написание пользовательских историй", (4, 9)),
            ("Нефункциональные требования", "NFR: perf, security, compliance", (3, 6)),
            ("Анализ интеграций", "Карта внешних и внутренних интеграций", (4, 8)),
            ("Модель данных", "Концептуальная и логическая модель данных", (5, 10)),
            ("Матрица трассировки", "Трассировка требований к фичам", (3, 6)),
            ("Gap-анализ", "Анализ разрывов текущего и целевого состояния", (4, 7)),
            ("Спецификация API", "Черновик контрактов REST API", (4, 8)),
            ("Acceptance criteria", "Критерии приёмки по эпикам", (3, 5)),
            ("Ревью аналитики", "Согласование аналитики со стейкхолдерами", (2, 4)),
        ],
    ),
    (
        "Дизайн",
        [
            ("Information architecture", "Структура экранов и навигации", (3, 6)),
            ("Wireframes", "Низкодетализированные макеты", (4, 8)),
            ("UI kit", "Базовые компоненты дизайн-системы", (5, 10)),
            ("High-fidelity макеты", "Детализированные макеты ключевых экранов", (6, 12)),
            ("Прототип кликабельный", "Интерактивный прототип для демо", (4, 8)),
            ("UX research", "Юзабилити-тесты прототипа", (3, 7)),
            ("Дизайн форм", "Макеты сложных форм и валидаций", (3, 6)),
            ("Адаптив mobile", "Адаптация под мобильные разрешения", (4, 7)),
            ("Иконки и иллюстрации", "Набор иконок и визуальных акцентов", (2, 5)),
            ("Design review", "Ревью дизайна с продуктом", (1, 3)),
        ],
    ),
    (
        "Backend",
        [
            ("Схема БД", "Миграции и схема таблиц", (3, 6)),
            ("Auth сервис", "Аутентификация и авторизация", (5, 10)),
            ("CRUD задач", "API создания/чтения/обновления задач", (4, 8)),
            ("Bulk import", "Массовый импорт задач", (3, 6)),
            ("Зависимости задач", "Логика predecessors и валидация", (4, 7)),
            ("Поиск и фильтры", "Фильтрация и поиск по задачам", (3, 6)),
            ("Экспорт Excel", "Генерация Excel из текущего плана", (3, 5)),
            ("Chat API", "Эндпоинт AI-чата", (4, 8)),
            ("MCP tools", "Инструменты агента для мутаций", (5, 9)),
            ("Интеграция LLM", "OpenRouter / tool calling loop", (4, 8)),
            ("Логирование", "Структурированные логи и audit trail", (2, 5)),
            ("Rate limiting", "Ограничение частоты запросов", (2, 4)),
            ("Health checks", "Пробы готовности сервиса", (1, 3)),
            ("Unit-тесты API", "Покрытие ключевых эндпоинтов", (4, 8)),
            ("Миграции данных", "Скрипты миграции и rollback", (3, 6)),
        ],
    ),
    (
        "Frontend",
        [
            ("Каркас приложения", "Роутинг, layout, providers", (3, 6)),
            ("Таблица задач", "Список задач с колонками", (4, 7)),
            ("Диаграмма Гантта", "Интеграция gantt-компонента", (6, 12)),
            ("Загрузка Excel", "Drag&drop и парсинг xlsx", (4, 8)),
            ("Валидация Zod", "Схемы валидации импорта", (2, 4)),
            ("Модалка задачи", "Диалог деталей и редактирования", (4, 7)),
            ("Панель чата", "Side panel AI-ассистента", (5, 9)),
            ("Markdown ответы", "Рендер ответов агента", (2, 4)),
            ("Фильтры Гантта", "Поиск по исполнителю и названию", (3, 5)),
            ("Навигация по датам", "Кнопки назад / сегодня / вперёд", (2, 4)),
            ("Приоритеты UI", "Раскраска баров по priority", (2, 4)),
            ("Тосты и ошибки", "Уведомления об ошибках API", (2, 4)),
            ("Скелетоны загрузки", "Состояния loading", (2, 3)),
            ("Адаптив layout", "Адаптация под разные ширины", (3, 6)),
            ("E2E смоук", "Базовые e2e сценарии", (3, 6)),
        ],
    ),
    (
        "Интеграции",
        [
            ("Коннектор CRM", "Синхронизация с CRM", (5, 10)),
            ("SSO / OIDC", "Подключение корпоративного SSO", (6, 12)),
            ("Webhooks исходящие", "События изменений задач", (3, 6)),
            ("Очередь сообщений", "Асинхронная обработка событий", (4, 8)),
            ("Файловое хранилище", "S3-совместимое хранение вложений", (4, 7)),
            ("Уведомления email", "Рассылка по смене статусов", (3, 6)),
            ("Календарь sync", "Экспорт сроков в календарь", (3, 5)),
            ("Мониторинг APM", "Метрики и трейсы", (3, 6)),
        ],
    ),
    (
        "QA",
        [
            ("Тест-план", "План тестирования релиза", (3, 5)),
            ("Тест-кейсы API", "Набор кейсов для API", (4, 8)),
            ("Тест-кейсы UI", "Сценарии UI-регрессии", (4, 8)),
            ("Нагрузочное тестирование", "Нагрузка на критичные эндпоинты", (3, 6)),
            ("Security scan", "Сканирование зависимостей и OWASP", (2, 5)),
            ("Регресс спринт 1", "Регрессионный прогон после спринта 1", (3, 5)),
            ("Регресс спринт 2", "Регрессионный прогон после спринта 2", (3, 5)),
            ("UAT подготовка", "Подготовка среды и сценариев UAT", (3, 6)),
            ("UAT проведение", "Проведение приёмочного тестирования", (5, 10)),
            ("Баг-башинг", "Сессия поиска дефектов", (2, 4)),
            ("Чеклист релиза", "Финальный чеклист перед выкладкой", (1, 3)),
        ],
    ),
    (
        "Документация",
        [
            ("README", "Инструкция по запуску", (1, 3)),
            ("API docs", "Описание HTTP API", (2, 4)),
            ("Админ-гайд", "Руководство администратора", (3, 5)),
            ("User guide", "Руководство пользователя", (4, 7)),
            ("Runbook", "Операционный runbook инцидентов", (2, 4)),
            ("Архитектурный ADR", "Фиксация ключевых ADR", (2, 4)),
            ("Roadmap production", "План переезда на production", (2, 4)),
        ],
    ),
    (
        "Релиз",
        [
            ("Staging деплой", "Выкладка на staging", (2, 4)),
            ("Smoke staging", "Смоук после выкладки на staging", (1, 3)),
            ("Prod деплой", "Выкладка в production", (2, 3)),
            ("Post-release мониторинг", "Мониторинг после релиза", (3, 5)),
            ("Ретроспектива", "Ретро команды по итогам", (1, 2)),
            ("Закрытие проекта", "Формальное закрытие и handoff", (2, 4)),
        ],
    ),
]


def _build_task_specs(count: int = 130) -> list[dict]:
    """Build task dicts with dates spanning ~3 months and FS dependencies."""
    today = date.today()
    horizon_end = today + timedelta(days=90)

    # Flatten phase items, cycling/expanding until we hit `count`
    catalog: list[tuple[str, str, str, tuple[int, int]]] = []
    for phase_name, items in PHASES:
        for title, desc, dur in items:
            catalog.append((phase_name, title, desc, dur))

    specs: list[dict] = []
    # Per-assignee "cursor" — next free start day offset from today
    assignee_cursor: dict[str, int] = {name: 0 for name in ASSIGNEES}

    # Track last few task ids per phase for predecessor chains
    phase_last_ids: dict[str, list[int]] = {}

    i = 0
    while len(specs) < count:
        phase_name, title_base, desc_base, dur_range = catalog[i % len(catalog)]
        wave = i // len(catalog)
        suffix = f" #{wave + 1}" if wave > 0 else ""

        assignee = ASSIGNEES[i % len(ASSIGNEES)]
        duration = random.randint(*dur_range)
        priority = random.choices(PRIORITIES, weights=PRIORITY_WEIGHTS, k=1)[0]

        # Schedule on assignee's timeline with small gaps / parallel jitter
        offset = assignee_cursor[assignee] + random.randint(0, 2)
        start = today + timedelta(days=offset)
        if start > horizon_end:
            # Wrap within horizon for overflow tasks
            start = today + timedelta(days=random.randint(0, 80))

        end_offset = (start - today).days + duration + random.randint(0, 2)
        assignee_cursor[assignee] = min(end_offset, 88)

        task_id = len(specs) + 1
        predecessors: str | None = None

        # ~45% of tasks get a predecessor from earlier work in same/other phase
        if task_id > 1 and random.random() < 0.45:
            pool = phase_last_ids.get(phase_name, [])
            if pool and random.random() < 0.7:
                pred = random.choice(pool[-3:])
            else:
                pred = random.randint(1, task_id - 1)
            # Occasionally dual predecessors
            if task_id > 5 and random.random() < 0.15:
                pred2 = random.randint(1, task_id - 1)
                while pred2 == pred:
                    pred2 = random.randint(1, task_id - 1)
                predecessors = ",".join(str(x) for x in sorted({pred, pred2}))
            else:
                predecessors = str(pred)

            # Push start after predecessor end (approx) for realism
            pred_spec = specs[pred - 1]
            pred_end = pred_spec["start_date"] + timedelta(days=pred_spec["duration"])
            if start < pred_end:
                start = pred_end
                if start > horizon_end:
                    start = horizon_end - timedelta(days=duration)

        phase_last_ids.setdefault(phase_name, []).append(task_id)

        specs.append(
            {
                "id": task_id,
                "title": f"{phase_name}: {title_base}{suffix}",
                "description": f"{desc_base}. Фаза «{phase_name}».",
                "assignee": assignee,
                "start_date": start,
                "duration": duration,
                "predecessors": predecessors,
                "priority": priority,
            }
        )
        i += 1

    return specs


def seed(count: int = 130) -> int:
    Base.metadata.create_all(bind=engine)
    ensure_sqlite_columns()

    specs = _build_task_specs(count)
    db = SessionLocal()
    try:
        db.query(Task).delete()
        db.flush()
        tasks = [Task(**spec) for spec in specs]
        db.add_all(tasks)
        db.commit()
        return len(tasks)
    finally:
        db.close()


if __name__ == "__main__":
    n = seed(130)
    print(f"Seeded {n} tasks for {len(ASSIGNEES)} assignees (horizon ~3 months).")
