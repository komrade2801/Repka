import { z } from "zod"
import {
  DEFAULT_TASK_PRIORITY,
  type TaskPriority,
} from "@/types/task"

const optionalString = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) return null
    const trimmed = String(value).trim()
    return trimmed.length > 0 ? trimmed : null
  })

const dateSchema = z.union([z.string(), z.number(), z.date()]).transform((value, ctx) => {
  let date: Date

  if (value instanceof Date) {
    date = value
  } else if (typeof value === "number") {
    // Excel serial date (days since 1899-12-30)
    date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000)
  } else {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: "custom", message: "Некорректная start_date" })
      return z.NEVER
    }
    date = parsed
  }

  if (Number.isNaN(date.getTime())) {
    ctx.addIssue({ code: "custom", message: "Некорректная start_date" })
    return z.NEVER
  }

  return date.toISOString().slice(0, 10)
})

const durationSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const num = typeof value === "number" ? value : Number(String(value).trim())
  if (!Number.isFinite(num) || num < 1) {
    ctx.addIssue({ code: "custom", message: "duration должен быть ≥ 1" })
    return z.NEVER
  }
  return Math.floor(num)
})

/** Normalize Excel / legacy English labels to canonical Russian priorities. */
const PRIORITY_MAP: Record<string, TaskPriority> = {
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

const prioritySchema = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) return DEFAULT_TASK_PRIORITY
    const key = String(value).trim().toLowerCase()
    if (!key) return DEFAULT_TASK_PRIORITY
    return PRIORITY_MAP[key] ?? DEFAULT_TASK_PRIORITY
  })

export const excelTaskSchema = z.object({
  title: z.union([z.string(), z.number()]).transform((value, ctx) => {
    const title = String(value).trim()
    if (!title) {
      ctx.addIssue({ code: "custom", message: "title обязателен" })
      return z.NEVER
    }
    return title
  }),
  description: optionalString,
  assignee: optionalString,
  start_date: dateSchema,
  duration: durationSchema,
  predecessors: optionalString,
  priority: prioritySchema,
})

export const excelTasksSchema = z
  .array(excelTaskSchema)
  .min(1, "Файл должен содержать хотя бы одну задачу")

export type ExcelTask = z.infer<typeof excelTaskSchema>

export const REQUIRED_COLUMNS = [
  "title",
  "start_date",
  "duration",
] as const

export const OPTIONAL_COLUMNS = [
  "description",
  "assignee",
  "predecessors",
  "priority",
] as const
