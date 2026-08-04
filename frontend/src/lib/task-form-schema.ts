import { z } from "zod"

import { TASK_PRIORITIES } from "@/types/task"

/** Align with backend `TaskBase` / DB column limits. */
export const TASK_FIELD_MAX = {
  title: 80,
  description: 500,
  assignee: 60,
} as const

export const taskFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Укажите название")
    .max(TASK_FIELD_MAX.title, `Не больше ${TASK_FIELD_MAX.title} символов`),
  description: z
    .string()
    .max(
      TASK_FIELD_MAX.description,
      `Не больше ${TASK_FIELD_MAX.description} символов`,
    ),
  assignee: z
    .string()
    .max(
      TASK_FIELD_MAX.assignee,
      `Не больше ${TASK_FIELD_MAX.assignee} символов`,
    ),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате YYYY-MM-DD"),
  duration: z
    .number({ error: "Укажите длительность" })
    .int()
    .min(1, "Минимум 1 день")
    .max(3650),
  predecessorIds: z.array(z.number().int().positive()),
  priority: z.enum(TASK_PRIORITIES),
})

export type TaskFormValues = z.infer<typeof taskFormSchema>

export function predecessorsToIds(raw: string | null | undefined): number[] {
  if (!raw?.trim()) return []
  return raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0)
}

export function idsToPredecessors(ids: number[]): string | null {
  return ids.length > 0 ? ids.join(",") : null
}
