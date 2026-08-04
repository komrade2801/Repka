"""OpenRouter LLM agent with MCP tool calling."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from openai import AsyncOpenAI
from sqlalchemy.orm import Session

from app.config import Settings
from app.mcp_tools import (
    format_date_ddmmyy,
    mcp,
    reset_tool_db,
    set_tool_db,
    tool_result_text,
)

_MSK = ZoneInfo("Europe/Moscow")
_WEEKDAYS_RU = (
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
    "воскресенье",
)

SYSTEM_PROMPT = """\
You are Repka — an AI assistant for a Gantt chart project planner.

Сегодня: {today} ({weekday_ru}). Местное время (Europe/Moscow): {now_time}.
Текущая неделя: с {week_start} (Пн) по {week_end} (Вс).
Неделя всегда начинается в понедельник (weekday=0) и заканчивается в воскресенье.
Resolve relative phrases like «сегодня», «завтра», «послезавтра», «до конца недели», «на этой / следующей неделе» into concrete dates dd.mm.yy using this clock. Always pass dates to tools as dd.mm.yy (e.g. 05.08.26).

There is NO full task list in this prompt. Discover tasks only via tools.

Read-only tools:
- get_project_summary(assignee?, priority?, on_date?, active_from?, active_to?) — ONLY counts/GROUP BY (total, by assignee, by priority). Never returns a task list. Date args = interval intersection.
- search_tasks(query?, assignee?, priority?, on_date?, active_from?, active_to?, starts_from?, starts_to?, ends_from?, ends_to?, limit=10) — returns the task list (id, title, …). Date modes:
  • ACTIVE: on_date or active_from+active_to — interval intersects day/period (Finish = start + duration − 1)
  • STARTS: starts_from/starts_to — by start_date only («начинаются…»)
  • ENDS: ends_from/ends_to — by inclusive Finish only («заканчиваются…»)

Mutation tools:
- move_task(task_id, new_start_date) — change start date (dd.mm.yy)
- assign_task(task_id, assignee) — set or clear assignee
- bulk_move_tasks(task_ids, new_start_date) — move many tasks to one date (prefer over many move_task)
- bulk_assign_tasks(task_ids, new_assignee) — assign many tasks to one person (empty clears)
- bulk_delete_tasks(task_ids) — delete many tasks + clean dependency refs
- add_dependency(task_id, predecessor_id) — FS predecessor link
- remove_dependency(task_id, predecessor_id) — remove predecessor
- create_task(title, start_date, duration=1, …) — create task (start_date dd.mm.yy)
- delete_task(task_id) — delete + clean dependency refs
- update_task_duration(task_id, duration) — duration in days
- update_task_priority(task_id, priority) — Критический/Высокий/Средний/Низкий/Опционально

Rules:
1. Grounding: NEVER trust task IDs, titles, assignees, dates, or counts from earlier chat turns or stale tool output — the plan may have changed in the UI. Before any mutation, always call search_tasks (or get_project_summary for stats) to obtain fresh IDs and state in this turn.
2. LIST vs COUNT (critical):
   - «какие / перечисли / покажи / что за задачи / какие попадают…» → ALWAYS search_tasks. FORBIDDEN: get_project_summary for list questions (it has no titles/IDs — answering with only stats is wrong).
   - «сколько / статистика / распределение / загрузка…» → get_project_summary.
3. Time-scoped COUNT («сколько на этой неделе / сегодня / в августе»): get_project_summary WITH dates — active_from+active_to or on_date. This week: active_from={week_start}, active_to={week_end}. FORBIDDEN: summary without dates for time-scoped questions.
4. Time-scoped LIST («какие задачи на этой неделе / сегодня / попадают на неделю»): search_tasks(active_from={week_start}, active_to={week_end}, limit=50) or on_date={today}. NOT starts_*.
5. Counts without a time window («сколько всего») — get_project_summary without dates is OK.
6. Week = Monday–Sunday. Use precomputed {week_start}–{week_end}. Never invent a Sunday-based week. «На следующей неделе» = that window +7 days.
7. Date intent for search_tasks (pick ONE mode):
   - «какие / что активно на неделе / сегодня / в августе» → ACTIVE: active_from+active_to or on_date.
   - «какие начинаются / стартуют …» → STARTS: starts_from/starts_to.
   - «какие заканчиваются / финишируют …» → ENDS: ends_from/ends_to.
8. Prefer tools over inventing changes. Do not claim success unless a tool succeeded. For multi-task edits use bulk_* tools (one round), not repeated single-task calls.
9. After tools, briefly confirm in the user's language (usually Russian). If search_tasks shows matched > showing, say that not all rows were returned.
10. If ambiguous or missing, ask a short clarifying question.
11. Only listed tools. Dependencies: no self-links, no cycles, predecessors must exist.
12. Do not auto-shift dates on add_dependency unless the user asks to move a task.
13. Formatting: for analytics, stats, comparisons, and multi-item results use GitHub-flavored Markdown tables with real newlines (each row on its own line). Example:
| Исполнитель | Задач |
| --- | --- |
| Иванова Анна | 25 |
Never squash a table into one line. Prefer a short intro sentence, then the table. Use bullet lists only for 1–3 simple items. For task lists from search_tasks prefer a markdown table (id, title, assignee, dates).
"""

MAX_TOOL_ROUNDS = 6
# Keep full tool payloads only for the last N assistant tool-call rounds in the LLM context.
KEEP_TOOL_RESULT_ROUNDS = 2
_STALE_TOOL_PLACEHOLDER = (
    "[cleared: stale tool result — call search_tasks or get_project_summary for current data]"
)


def _moscow_clock() -> dict[str, str]:
    """MSK wall clock + Mon–Sun week bounds (weekday 0 = Monday)."""
    now = datetime.now(_MSK)
    today = now.date()
    # Explicit Monday shift: date.weekday() is Mon=0 … Sun=6.
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    return {
        "today": format_date_ddmmyy(today),
        "weekday_ru": _WEEKDAYS_RU[today.weekday()].capitalize(),
        "now_time": now.strftime("%H:%M"),
        "week_start": format_date_ddmmyy(week_start),
        "week_end": format_date_ddmmyy(week_end),
    }


def _strip_stale_tool_results(
    messages: list[dict[str, Any]],
    *,
    keep_rounds: int = KEEP_TOOL_RESULT_ROUNDS,
) -> None:
    """Compress tool payloads older than the last `keep_rounds` tool-call rounds (in-place).

    Keeps message structure (assistant tool_calls + matching tool messages) valid for the
    OpenAI API while dropping bulky stale results so the model re-fetches via search tools.
    """
    if keep_rounds < 0:
        return

    round_starts = [
        i
        for i, msg in enumerate(messages)
        if msg.get("role") == "assistant" and msg.get("tool_calls")
    ]
    if len(round_starts) <= keep_rounds:
        return

    keep_from = round_starts[-keep_rounds] if keep_rounds else len(messages)
    for i in range(keep_from):
        msg = messages[i]
        if msg.get("role") == "tool" and msg.get("content") != _STALE_TOOL_PLACEHOLDER:
            msg["content"] = _STALE_TOOL_PLACEHOLDER


def _openai_tools(mcp_tools: list[Any]) -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = []
    for tool in mcp_tools:
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description or tool.name,
                    "parameters": tool.input_schema,
                },
            }
        )
    return tools


def _build_client(settings: Settings) -> AsyncOpenAI:
    if not settings.openrouter_api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not set. Add it to the project .env file."
        )
    return AsyncOpenAI(
        api_key=settings.openrouter_api_key,
        base_url=settings.openrouter_base_url,
        default_headers={
            "HTTP-Referer": "http://localhost:5173",
            "X-Title": "Repka",
        },
    )


async def run_chat(
    *,
    message: str,
    history: list[dict[str, str]],
    db: Session,
    settings: Settings,
) -> tuple[str, list[str]]:
    """Run an LLM turn with MCP tools. Returns (reply_text, tools_used)."""
    system = SYSTEM_PROMPT.format(**_moscow_clock())

    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    for item in history:
        role = item.get("role")
        content = item.get("content")
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})

    client = _build_client(settings)
    mcp_tool_defs = await mcp.list_tools()
    openai_tools = _openai_tools(mcp_tool_defs)
    tools_used: list[str] = []

    token = set_tool_db(db)
    try:
        for _ in range(MAX_TOOL_ROUNDS):
            _strip_stale_tool_results(messages)
            completion = await client.chat.completions.create(
                model=settings.openrouter_model,
                messages=messages,
                tools=openai_tools,
                tool_choice="auto",
            )
            choice = completion.choices[0].message
            tool_calls = choice.tool_calls or []

            assistant_message: dict[str, Any] = {
                "role": "assistant",
                "content": choice.content or "",
            }
            if tool_calls:
                assistant_message["tool_calls"] = [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.function.name,
                            "arguments": call.function.arguments,
                        },
                    }
                    for call in tool_calls
                ]
            messages.append(assistant_message)

            if not tool_calls:
                reply = (choice.content or "").strip()
                return reply or "Готово.", tools_used

            for call in tool_calls:
                name = call.function.name
                tools_used.append(name)
                try:
                    args = json.loads(call.function.arguments or "{}")
                    if not isinstance(args, dict):
                        raise ValueError("Tool arguments must be a JSON object")
                    result = await mcp.call_tool(name, args)
                    content = tool_result_text(result)
                    if getattr(result, "is_error", False):
                        content = f"Error: {content}"
                except Exception as exc:  # noqa: BLE001 — surface to the model
                    db.rollback()
                    content = f"Error: {exc}"

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": content,
                    }
                )
    finally:
        reset_tool_db(token)

    return (
        "Не удалось завершить запрос: слишком много вызовов инструментов.",
        tools_used,
    )
