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
| `get_project_summary` | `assignee?`, `priority?` | `COUNT` / `GROUP BY` assignee и priority |
| `search_tasks` | `query?`, `assignee?`, `priority?`, `start_from/to?`, `finish_from/to?`, `limit=10` | SQL-фильтр; даты `dd.mm.yy`; finish = start + duration |
| `move_task` | `task_id`, `new_start_date` | Смена `start_date` (`dd.mm.yy`) |
| `assign_task` | `task_id`, `assignee` | Исполнитель (`` → сброс) |
| `add_dependency` / `remove_dependency` | `task_id`, `predecessor_id` | FS-связь / снятие |
| `create_task` | `title`, `start_date`, … | Создание (autoincrement id) |
| `delete_task` | `task_id` | Удаление + cleanup ссылок |
| `update_task_duration` | `task_id`, `duration` | Длительность ≥ 1 |
| `update_task_priority` | `task_id`, `priority` | RU/EN → канон |

Мутации: `commit` + текст результата. Ошибки → `rollback`, в LLM уходит `Error: …`.

## Цикл `run_chat`

1. System prompt: МСК-дата/день недели; **без** полного снимка задач.
2. History: только `user` / `assistant` с клиента; перед каждым LLM-вызовом tool stripping (`KEEP_TOOL_RESULT_ROUNDS = 2`).
3. Grounding: модель обязана перепроверять ID через `search_tasks` / `get_project_summary` перед мутациями.
4. До `MAX_TOOL_ROUNDS = 6`: completion → `mcp.call_tool` → role `tool`.
5. Ответ: `(reply, tools_used)`.

Конфиг: `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`. На Windows для МСК нужен `tzdata`.

**Расширение:** новый `@mcp.tool()` в `mcp_tools.py` + строка в `SYSTEM_PROMPT`.

См. также: [app](./app.md) · [backend](./backend.md) · [plan](../plan.md) (этапы 3, 7, 9).
