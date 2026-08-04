import { api } from "@/lib/api"
import {
  DEFAULT_TASK_PRIORITY,
  type Task,
  type TaskCreate,
  type TaskImportResult,
  type TaskPriority,
  type TaskUpdate,
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

function apiErrorMessage(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    error.response &&
    typeof error.response === "object" &&
    "data" in error.response
  ) {
    const data = (error.response as { data?: { detail?: unknown } }).data
    const detail = data?.detail
    if (typeof detail === "string") return detail
    if (Array.isArray(detail)) {
      return detail
        .map((item) =>
          item && typeof item === "object" && "msg" in item
            ? String((item as { msg: string }).msg)
            : String(item),
        )
        .join("; ")
    }
  }
  if (error instanceof Error) return error.message
  return fallback
}

export async function fetchTasks(): Promise<Task[]> {
  const { data } = await api.get<Task[]>("/tasks")
  return data.map(normalizeTask)
}

export async function createTask(payload: TaskCreate): Promise<Task> {
  try {
    const { data } = await api.post<Task>("/tasks", payload)
    return normalizeTask(data)
  } catch (error) {
    throw new Error(apiErrorMessage(error, "Не удалось создать задачу"))
  }
}

export async function updateTask(
  id: number,
  payload: TaskUpdate,
): Promise<Task> {
  try {
    const { data } = await api.patch<Task>(`/tasks/${id}`, payload)
    return normalizeTask(data)
  } catch (error) {
    throw new Error(apiErrorMessage(error, "Не удалось сохранить задачу"))
  }
}

export async function deleteTask(id: number): Promise<void> {
  try {
    await api.delete(`/tasks/${id}`)
  } catch (error) {
    throw new Error(apiErrorMessage(error, "Не удалось удалить задачу"))
  }
}

export async function importTasks(
  tasks: TaskCreate[],
): Promise<TaskImportResult> {
  try {
    const { data } = await api.post<TaskImportResult>("/tasks/import", {
      tasks,
    })
    return {
      created: data.created.map(normalizeTask),
      skipped: data.skipped,
    }
  } catch (error) {
    throw new Error(apiErrorMessage(error, "Не удалось импортировать задачи"))
  }
}
