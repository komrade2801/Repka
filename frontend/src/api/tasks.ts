import { api } from "@/lib/api"
import {
  DEFAULT_TASK_PRIORITY,
  type Task,
  type TaskCreate,
  type TaskPriority,
} from "@/types/task"

const PRIORITY_ALIASES: Record<string, TaskPriority> = {
  критический: "Критический",
  крит: "Критический",
  critical: "Критический",
  blocker: "Критический",
  urgent: "Критический",
  высокий: "Высокий",
  high: "Высокий",
  средний: "Средний",
  medium: "Средний",
  normal: "Средний",
  низкий: "Низкий",
  low: "Низкий",
  опционально: "Опционально",
  optional: "Опционально",
}

function normalizePriority(value: string | null | undefined): TaskPriority {
  if (!value?.trim()) return DEFAULT_TASK_PRIORITY
  const key = value.trim().toLowerCase()
  return PRIORITY_ALIASES[key] ?? (value as TaskPriority)
}

function normalizeTask(task: Task): Task {
  return {
    ...task,
    priority: normalizePriority(task.priority),
  }
}

export async function fetchTasks(): Promise<Task[]> {
  const { data } = await api.get<Task[]>("/tasks")
  return data.map(normalizeTask)
}

export async function bulkCreateTasks(tasks: TaskCreate[]): Promise<Task[]> {
  const { data } = await api.post<Task[]>("/tasks/bulk", { tasks })
  return data.map(normalizeTask)
}
