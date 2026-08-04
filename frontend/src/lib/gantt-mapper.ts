import { addDays, parseISO } from "@/lib/date"
import type { Task as GanttTask } from "gantt-task-react"
import {
  DEFAULT_TASK_PRIORITY,
  type Task,
  type TaskPriority,
} from "@/types/task"

type PriorityStyle = {
  backgroundColor: string
  backgroundSelectedColor: string
}

/** Pastel priority palette for gantt bars. */
export const PRIORITY_COLORS: Record<TaskPriority, PriorityStyle> = {
  Критический: {
    backgroundColor: "#FCA5A5",
    backgroundSelectedColor: "#F87171",
  },
  Высокий: {
    backgroundColor: "#FCD34D",
    backgroundSelectedColor: "#FBBF24",
  },
  Средний: {
    backgroundColor: "#93C5FD",
    backgroundSelectedColor: "#60A5FA",
  },
  Низкий: {
    backgroundColor: "#D1D5DB",
    backgroundSelectedColor: "#9CA3AF",
  },
  Опционально: {
    backgroundColor: "#C4B5FD",
    backgroundSelectedColor: "#A78BFA",
  },
}

function parsePredecessors(predecessors: string | null): string[] | undefined {
  if (!predecessors) return undefined
  const ids = predecessors
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  return ids.length > 0 ? ids : undefined
}

export function formatAssigneeShort(assignee: string | null | undefined): string {
  if (!assignee?.trim()) return "—"
  const parts = assignee.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0]
  // «Фамилия И.О.» — first token is surname, rest become initials.
  const surname = parts[0]
  const initials = parts
    .slice(1)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}.`)
    .join("")
  return `${surname} ${initials}`
}

/** Two-letter initials for avatar chips (Фамилия Имя → ФИ). */
export function formatAssigneeInitials(assignee: string | null | undefined): string {
  if (!assignee?.trim()) return "?"
  const parts = assignee.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  const a = parts[0][0] ?? ""
  const b = parts[1][0] ?? ""
  return `${a}${b}`.toUpperCase()
}

export function toGanttTasks(tasks: Task[]): GanttTask[] {
  return tasks.map((task) => {
    const start = parseISO(task.start_date)
    const end = addDays(start, Math.max(task.duration, 1))
    const priority = task.priority ?? DEFAULT_TASK_PRIORITY
    const colors = PRIORITY_COLORS[priority] ?? PRIORITY_COLORS[DEFAULT_TASK_PRIORITY]

    return {
      id: String(task.id),
      name: task.title,
      start,
      end,
      progress: 0,
      type: "task" as const,
      dependencies: parsePredecessors(task.predecessors),
      styles: {
        backgroundColor: colors.backgroundColor,
        backgroundSelectedColor: colors.backgroundSelectedColor,
        progressColor: colors.backgroundColor,
        progressSelectedColor: colors.backgroundSelectedColor,
      },
    }
  })
}
