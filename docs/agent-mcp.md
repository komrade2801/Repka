# AI-агент и MCP Tools

| Модуль | Роль |
| --- | --- |
| [`mcp_tools.py`](../backend/app/mcp_tools.py) | MCP Server «Repka», `@mcp.tool()`, ContextVar-сессия БД |
| [`agent.py`](../backend/app/agent.py) | System prompt, OpenRouter, цикл tool calling, grounding / stripping |
| [`chat.py`](../backend/app/routers/chat.py) | `POST /chat` → `run_chat` |

Tools вызываются **in-process** (та же SQLAlchemy-сессия, что у HTTP). Сессия: `set_tool_db` / `reset_tool_db`. Зависимости — слой A (`task_graph`), без автосдвига дат.

## Tools

| Tool | Аргументы | Действие |
| --- | --- | --- |
| `get_project_summary` | `assignee?`, `priority?`, `on_date?`, `active_from?`+`active_to?` | `COUNT` / `GROUP BY`; период — пересечение интервалов |
| `search_tasks` | `query?`, фильтры дат, `limit=50` (max 250), `ids_only?` | ACTIVE / STARTS / ENDS; `ids_only` — компактный список id |
| `move_task` | `task_id`, `new_start_date?`, `new_end_date?`, `duration?` | Старт / старт+финиш / только финиш / старт+duration |
| `shift_tasks` | `task_ids`, `offset_days` | Относительный сдвиг (±дни), duration без изменений |
| `bulk_move_tasks` | `task_ids`, `new_start_date` | Абсолютный перенос известных id |
| `bulk_assign_tasks` | `task_ids`, `new_assignee` | Массовое назначение (`` → сброс) |
| `bulk_delete_tasks` | `task_ids` | Массовое удаление + cleanup |
| `move_tasks_where` | `new_start_date` + фильтры (≥1) | Перенос **всех** подходящих без пагинации |
| `shift_tasks_where` | `offset_days` + фильтры (≥1) | Сдвиг **всех** подходящих |
| `delete_tasks_where` | фильтры (≥1) | Удаление **всех** подходящих + cleanup |
| `clear_entire_project` | `confirm=true` | Полный wipe плана |
| `assign_task` | `task_id`, `assignee` | Исполнитель (`` → сброс) |
| `add_dependency` / `remove_dependency` | `task_id`, `predecessor_id` | FS-связь / снятие |
| `create_task` | `title`, `start_date`, … | Создание (autoincrement id) |
| `delete_task` | `task_id` | Удаление + cleanup ссылок |
| `update_task_duration` | `task_id`, `duration` | Длительность ≥ 1 |
| `update_task_priority` | `task_id`, `priority` | RU/EN → канон |

Мутации: `commit` + текст результата. Ошибки → `rollback`, в LLM уходит `Error: …`.

**Выбор формы мутации:** полный wipe → `clear_entire_project`; «все задачи Ивановой / с приоритетом X» → `*_where`; известные id → `bulk_*` / `shift_tasks`. Не использовать search+bulk для полного удаления (пагинация).

## Цикл `run_chat`

1. System prompt: МСК-дата/день недели + границы текущей недели Пн–Вс; **без** полного снимка задач.
2. History: только `user` / `assistant` с клиента; перед каждым LLM-вызовом tool stripping (`KEEP_TOOL_RESULT_ROUNDS = 2`).
3. Grounding: перед id-мутациями — `search_tasks` (можно `ids_only`); перед `*_where` / wipe — `get_project_summary` с теми же фильтрами. **Список** → `search_tasks`; **счёт** → `get_project_summary`.
4. До `MAX_TOOL_ROUNDS = 6`: completion → `mcp.call_tool` → role `tool`.
5. Ответ: `(reply, tools_used)`. На UI toast «План обновлён» фильтрует read-only (`search_tasks`, `get_project_summary`).

Конфиг: `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL` (дефолт `openai/gpt-4o-mini`). На Windows для МСК нужен `tzdata`.

**Расширение:** новый `@mcp.tool()` в `mcp_tools.py` + строка в `SYSTEM_PROMPT`.

См. также: [app](./app.md) · [backend](./backend.md) · [plan](./plan.md) (этапы 3, 7, 9).
