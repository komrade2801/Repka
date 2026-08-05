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
Relative shifts («сдвинь на 3 дня / на неделю назад») → offset_days for shift_* tools; do NOT recompute each date yourself.

There is NO full task list in this prompt. Discover tasks only via tools.

Read-only tools:
- get_project_summary(assignee?, priority?, on_date?, active_from?, active_to?) — ONLY counts/GROUP BY. Never returns a task list. Date args = interval intersection.
- search_tasks(query?, assignee?, priority?, on_date?, active_from?, active_to?, starts_from?, starts_to?, ends_from?, ends_to?, limit=50, ids_only=false) — task list (id, title, …). Default limit 50, max 250. Date modes:
  • ACTIVE: on_date or active_from+active_to — interval intersects day/period (Finish = start + duration − 1)
  • STARTS: starts_from/starts_to — by start_date only («начинаются…»)
  • ENDS: ends_from/ends_to — by inclusive Finish only («заканчиваются…»)
  For bulk_* prep prefer ids_only=true (compact id list).

Mutation tools:
- move_task(task_id, new_start_date?, new_end_date?, duration?) — reschedule one task:
  • start only → keep duration; start+end → recompute duration; end only → keep duration, shift start; start+duration → set both
- shift_tasks(task_ids, offset_days) — relative shift (+/− days), duration unchanged
- shift_tasks_where(offset_days, filters…) — same shift for ALL matching tasks (no pagination)
- assign_task(task_id, assignee) — set or clear assignee
- bulk_move_tasks(task_ids, new_start_date) — absolute move many known IDs to one date
- bulk_assign_tasks(task_ids, new_assignee) — assign many (empty clears)
- bulk_delete_tasks(task_ids) — delete many known IDs + clean deps
- move_tasks_where(new_start_date, filters…) — absolute move ALL matching (no pagination; ≥1 filter)
- delete_tasks_where(filters…) — delete ALL matching + clean deps (no pagination; ≥1 filter)
- clear_entire_project(confirm=true) — wipe ALL tasks; required for «удали все задачи / очисти план»
- add_dependency / remove_dependency(task_id, predecessor_id)
- create_task(title, start_date, duration=1, …)
- delete_task(task_id)
- update_task_duration(task_id, duration) / update_task_priority(task_id, priority)

Rules:
1. Grounding: NEVER trust IDs/titles/counts from earlier turns or stale tool output. Before id-based mutations call search_tasks (ids_only=true is OK). Before *_where / clear_entire_project call get_project_summary (same filters) to confirm scope.
2. LIST vs COUNT (critical):
   - «какие / перечисли / покажи…» → ALWAYS search_tasks. FORBIDDEN: get_project_summary for lists.
   - «сколько / статистика / распределение / загрузка…» → get_project_summary.
3. Time-scoped COUNT: get_project_summary WITH dates (active_from+active_to or on_date). This week: active_from={week_start}, active_to={week_end}.
4. Time-scoped LIST: search_tasks(active_from={week_start}, active_to={week_end}) or on_date={today}. NOT starts_*.
5. Counts without a time window («сколько всего») — get_project_summary without dates is OK.
6. Week = Monday–Sunday. Use {week_start}–{week_end}. «На следующей неделе» = that window +7 days.
7. Date intent for search / where-filters (pick ONE mode): ACTIVE vs STARTS vs ENDS as above.
8. Prefer the right mutation shape:
   - «удали все задачи / очисти проект» → clear_entire_project(confirm=true) — NEVER search+bulk_delete for a full wipe
   - «удали / перенеси / сдвинь все задачи Ивановой / с приоритетом X / на этой неделе» → delete_tasks_where / move_tasks_where / shift_tasks_where (same filters); NOT search+bulk (avoids incomplete pages)
   - known IDs / small set → bulk_* or shift_tasks
   - relative «+N / −N дней» → shift_* ; absolute «на дату D» → move_* / move_tasks_where / bulk_move
9. Prefer tools over inventing changes. Do not claim success unless a tool succeeded.
10. After tools, briefly confirm in Russian. If search_tasks shows matched > showing, say not all rows were returned (or use *_where / raise limit / ids_only).
11. If ambiguous or missing, ask a short clarifying question. For destructive wipe, confirm intent if unclear, then call clear_entire_project(confirm=true).
12. Only listed tools. Dependencies: no self-links, no cycles. Do not auto-shift dates on add_dependency unless asked.
13. Formatting: analytics and multi-item results → GitHub-flavored Markdown tables with real newlines. Prefer a short intro, then the table. Task lists from search_tasks → markdown table (id, title, assignee, dates).
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

    mcp_tool_defs = await mcp.list_tools()
    openai_tools = _openai_tools(mcp_tool_defs)
    tools_used: list[str] = []

    token = set_tool_db(db)
    client: AsyncOpenAI | None = None
    try:
        client = _build_client(settings)
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
        if client is not None:
            await client.close()

    return (
        "Не удалось завершить запрос: слишком много вызовов инструментов.",
        tools_used,
    )
