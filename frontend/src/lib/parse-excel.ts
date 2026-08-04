import * as XLSX from "xlsx"

import {
  mapHeaderToKey,
  REQUIRED_COLUMN_HEADERS,
  REQUIRED_COLUMN_KEYS,
  type ExcelColumnKey,
} from "@/lib/excel-columns"
import {
  excelTaskSchema,
  formatFieldIssue,
  type ExcelTask,
} from "@/lib/task-schema"

export type ImportRowIssue = {
  /** 1-based Excel row number (header = 1). */
  row: number
  kind: "error" | "duplicate"
  message: string
  title?: string
}

export type ImportParseStats = {
  total: number
  success: number
  errors: number
  duplicates: number
}

export type ImportParseResult = {
  valid: ExcelTask[]
  errors: ImportRowIssue[]
  duplicates: ImportRowIssue[]
  stats: ImportParseStats
  hasIssues: boolean
}

function formatZodIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((issue) => formatFieldIssue(issue.path, issue.message)).join("; ")
}

function isBlankRow(row: Record<string, unknown>): boolean {
  return Object.values(row).every((value) => {
    if (value === null || value === undefined) return true
    if (typeof value === "string" && value.trim() === "") return true
    return false
  })
}

/**
 * Parse and validate an Excel file row-by-row.
 * Accepts Russian headers (Задача, …) and legacy English keys.
 * Duplicates are detected by case-insensitive title (first occurrence wins).
 */
export function parseExcelFile(file: File): Promise<ImportParseResult> {
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
          const mapped: Partial<Record<ExcelColumnKey, unknown>> = {}
          for (const [key, value] of Object.entries(row)) {
            const field = mapHeaderToKey(key)
            if (field) mapped[field] = value
          }
          return mapped
        })

        const headers = new Set<ExcelColumnKey>()
        for (const row of normalized) {
          for (const key of Object.keys(row) as ExcelColumnKey[]) {
            headers.add(key)
          }
        }

        const missing = REQUIRED_COLUMN_KEYS.filter((col) => !headers.has(col))
        if (missing.length > 0) {
          const missingLabels = missing.map((key) => {
            const idx = REQUIRED_COLUMN_KEYS.indexOf(key)
            return REQUIRED_COLUMN_HEADERS[idx] ?? key
          })
          reject(new Error(`Нет обязательных колонок: ${missingLabels.join(", ")}`))
          return
        }

        const valid: ExcelTask[] = []
        const errors: ImportRowIssue[] = []
        const duplicates: ImportRowIssue[] = []
        const seenTitles = new Map<string, number>()

        let dataRowCount = 0

        normalized.forEach((row, index) => {
          if (isBlankRow(row)) return
          dataRowCount += 1
          const excelRow = index + 2 // header is row 1

          const parsed = excelTaskSchema.safeParse(row)
          if (!parsed.success) {
            errors.push({
              row: excelRow,
              kind: "error",
              message: formatZodIssues(parsed.error.issues),
              title:
                row.title !== null && row.title !== undefined
                  ? String(row.title).trim() || undefined
                  : undefined,
            })
            return
          }

          const titleKey = parsed.data.title.toLowerCase()
          const firstRow = seenTitles.get(titleKey)
          if (firstRow !== undefined) {
            duplicates.push({
              row: excelRow,
              kind: "duplicate",
              message: `Дубликат названия «${parsed.data.title}» (первая строка ${firstRow})`,
              title: parsed.data.title,
            })
            return
          }

          seenTitles.set(titleKey, excelRow)
          valid.push(parsed.data)
        })

        if (dataRowCount === 0) {
          reject(new Error("В файле нет строк с данными"))
          return
        }

        const stats: ImportParseStats = {
          total: dataRowCount,
          success: valid.length,
          errors: errors.length,
          duplicates: duplicates.length,
        }

        resolve({
          valid,
          errors,
          duplicates,
          stats,
          hasIssues: errors.length > 0 || duplicates.length > 0,
        })
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Не удалось разобрать Excel"))
      }
    }

    reader.onerror = () => reject(new Error("Не удалось прочитать файл"))
    reader.readAsArrayBuffer(file)
  })
}
