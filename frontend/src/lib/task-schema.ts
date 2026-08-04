import { z } from "zod"
import { FIELD_LABELS } from "@/lib/excel-columns"
import {
  DEFAULT_TASK_PRIORITY,
  TASK_PRIORITIES,
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
      ctx.addIssue({ code: "custom", message: "некорректная дата" })
      return z.NEVER
    }
    date = parsed
  }

  if (Number.isNaN(date.getTime())) {
    ctx.addIssue({ code: "custom", message: "некорректная дата" })
    return z.NEVER
  }

  return date.toISOString().slice(0, 10)
})

const durationSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const num = typeof value === "number" ? value : Number(String(value).trim())
  if (!Number.isFinite(num)) {
    ctx.addIssue({ code: "custom", message: "должно быть числом" })
    return z.NEVER
  }
  if (num < 1) {
    ctx.addIssue({ code: "custom", message: "должно быть ≥ 1" })
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

for (const label of TASK_PRIORITIES) {
  PRIORITY_MAP[label.toLowerCase()] = label
}

const prioritySchema = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value === null || value === undefined) return DEFAULT_TASK_PRIORITY
    const raw = String(value).trim()
    if (!raw) return DEFAULT_TASK_PRIORITY
    const mapped = PRIORITY_MAP[raw.toLowerCase()]
    if (!mapped) {
      ctx.addIssue({
        code: "custom",
        message: `неизвестное значение «${raw}». Допустимо: ${TASK_PRIORITIES.join(", ")}`,
      })
      return z.NEVER
    }
    return mapped
  })

const predecessorsSchema = optionalString.transform((value, ctx) => {
  if (value === null) return null
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  for (const part of parts) {
    if (!/^\d+$/.test(part) || Number(part) < 1) {
      ctx.addIssue({
        code: "custom",
        message: `некорректный формат «${value}» (ожидаются ID через запятую)`,
      })
      return z.NEVER
    }
  }
  return parts.join(",")
})

export const excelTaskSchema = z.object({
  title: z.union([z.string(), z.number()]).transform((value, ctx) => {
    const title = String(value).trim()
    if (!title) {
      ctx.addIssue({ code: "custom", message: "обязательно" })
      return z.NEVER
    }
    return title
  }),
  description: optionalString,
  assignee: optionalString,
  start_date: dateSchema,
  duration: durationSchema,
  predecessors: predecessorsSchema,
  priority: prioritySchema,
})

export const excelTasksSchema = z
  .array(excelTaskSchema)
  .min(1, "Файл должен содержать хотя бы одну задачу")

export type ExcelTask = z.infer<typeof excelTaskSchema>

/** @deprecated use REQUIRED_COLUMN_KEYS from excel-columns */
export const REQUIRED_COLUMNS = ["title", "start_date", "duration"] as const

export const OPTIONAL_COLUMNS = [
  "description",
  "assignee",
  "predecessors",
  "priority",
] as const

export function formatFieldIssue(path: PropertyKey[], message: string): string {
  const key = String(path[0] ?? "")
  const label = (FIELD_LABELS as Record<string, string>)[key] ?? key
  return label ? `${label}: ${message}` : message
}
