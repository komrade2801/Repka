"""OpenRouter LLM agent with MCP tool calling."""

from __future__ import annotations

import json
from typing import Any

from openai import AsyncOpenAI
from sqlalchemy.orm import Session

from app.config import Settings
from app.mcp_tools import (
    format_tasks_for_prompt,
    mcp,
    reset_tool_db,
    set_tool_db,
    tool_result_text,
)
from app.models import Task

SYSTEM_PROMPT = """\
You are Repka — an AI assistant for a Gantt chart project planner.

You help users rearrange the schedule by calling tools when needed:
- move_task(task_id, new_start_date) — change a task's start date (YYYY-MM-DD)
- assign_task(task_id, assignee) — set the assignee
- add_dependency(task_id, predecessor_id) — make task wait for another task

Rules:
1. Always resolve tasks by the IDs from the current task list below.
2. If the user refers to a task by title, find the matching id first.
3. Prefer calling tools over inventing changes. Do not claim you changed data unless a tool succeeded.
4. After tools run, briefly confirm what changed in Russian (or the user's language).
5. If the request is ambiguous or a task is missing, ask a short clarifying question.
6. Do not invent new tasks or delete tasks — only the listed tools are available.

{task_snapshot}
"""

MAX_TOOL_ROUNDS = 6


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
    tasks = db.query(Task).order_by(Task.id).all()
    system = SYSTEM_PROMPT.format(task_snapshot=format_tasks_for_prompt(tasks))

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
