import * as XLSX from "xlsx"

import {
  excelTasksSchema,
  REQUIRED_COLUMNS,
  type ExcelTask,
} from "@/lib/task-schema"

function normalizeHeader(header: unknown): string {
  return String(header ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
}

export function parseExcelFile(file: File): Promise<ExcelTask[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: "array", cellDates: true })
        const sheetName = workbook.SheetNames[0]
        if (!sheetName) {
          reject(new Error("В книге нет листов"))
          return
        }

        const sheet = workbook.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: null,
          raw: true,
        })

        if (rows.length === 0) {
          reject(new Error("Лист пустой"))
          return
        }

        const normalized = rows.map((row) => {
          const mapped: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(row)) {
            mapped[normalizeHeader(key)] = value
          }
          return mapped
        })

        const headers = Object.keys(normalized[0] ?? {})
        const missing = REQUIRED_COLUMNS.filter((col) => !headers.includes(col))
        if (missing.length > 0) {
          reject(new Error(`Нет обязательных колонок: ${missing.join(", ")}`))
          return
        }

        const parsed = excelTasksSchema.safeParse(normalized)
        if (!parsed.success) {
          const first = parsed.error.issues[0]
          const path = first?.path.join(".") || "строка"
          reject(new Error(`${path}: ${first?.message ?? "Ошибка валидации"}`))
          return
        }

        resolve(parsed.data)
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Не удалось разобрать Excel"))
      }
    }

    reader.onerror = () => reject(new Error("Не удалось прочитать файл"))
    reader.readAsArrayBuffer(file)
  })
}
