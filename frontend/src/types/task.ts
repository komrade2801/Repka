export const TASK_PRIORITIES = [
  "Критический",
  "Высокий",
  "Средний",
  "Низкий",
  "Опционально",
] as const

export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const DEFAULT_TASK_PRIORITY: TaskPriority = "Средний"

export type Task = {
  id: number
  title: string
  description: string | null
  assignee: string | null
  start_date: string
  duration: number
  predecessors: string | null
  priority: TaskPriority
}

export type TaskCreate = Omit<Task, "id">
