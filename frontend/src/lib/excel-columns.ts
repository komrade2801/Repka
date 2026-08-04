/**
 * Russian Excel column labels (import + export).
 * Canonical internal keys stay English for API / zod.
 */
export const EXCEL_COLUMNS = [
  { key: "title", header: "Задача", required: true },
  { key: "description", header: "Описание", required: false },
  { key: "assignee", header: "Исполнитель", required: false },
  { key: "start_date", header: "Дата начала", required: true },
  { key: "duration", header: "Длительность", required: true },
  { key: "predecessors", header: "Предшественники", required: false },
  { key: "priority", header: "Приоритет", required: false },
] as const

export type ExcelColumnKey = (typeof EXCEL_COLUMNS)[number]["key"]

/** Normalized header → internal field key. */
export const HEADER_TO_KEY: Record<string, ExcelColumnKey> = {
  задача: "title",
  описание: "description",
  исполнитель: "assignee",
  дата_начала: "start_date",
  длительность: "duration",
  предшественники: "predecessors",
  приоритет: "priority",
  title: "title",
  description: "description",
  assignee: "assignee",
  start_date: "start_date",
  duration: "duration",
  predecessors: "predecessors",
  priority: "priority",
}

export const FIELD_LABELS: Record<ExcelColumnKey, string> = Object.fromEntries(
  EXCEL_COLUMNS.map((c) => [c.key, c.header]),
) as Record<ExcelColumnKey, string>

export const REQUIRED_COLUMN_KEYS = EXCEL_COLUMNS.filter((c) => c.required).map(
  (c) => c.key,
)

export const REQUIRED_COLUMN_HEADERS = EXCEL_COLUMNS.filter((c) => c.required).map(
  (c) => c.header,
)

export function normalizeHeader(header: unknown): string {
  return String(header ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
}

export function mapHeaderToKey(header: unknown): ExcelColumnKey | null {
  return HEADER_TO_KEY[normalizeHeader(header)] ?? null
}
