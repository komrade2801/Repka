import ExcelJS from "exceljs"

import { EXCEL_COLUMNS } from "@/lib/excel-columns"
import type { Task } from "@/types/task"

const HEADER_FONT_SIZE = 14
const BODY_FONT_SIZE = 11
const MIN_COL_WIDTH = 12
const MAX_COL_WIDTH = 60

function cellDisplayLength(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (value instanceof Date) return 10
  return String(value).length
}

function fitColumnWidth(header: string, values: unknown[]): number {
  let max = header.length
  for (const value of values) {
    max = Math.max(max, cellDisplayLength(value))
  }
  // Excel width ≈ character count + padding
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, max + 2))
}

export function tasksToExportRows(tasks: Task[]) {
  return tasks.map((task) => ({
    title: task.title,
    description: task.description ?? "",
    assignee: task.assignee ?? "",
    start_date: task.start_date,
    duration: task.duration,
    predecessors: task.predecessors ?? "",
    priority: task.priority,
  }))
}

export async function buildTasksWorkbook(tasks: Task[]): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Repka"
  workbook.created = new Date()

  const sheet = workbook.addWorksheet("Задачи", {
    views: [{ state: "frozen", ySplit: 1 }],
  })

  const rows = tasksToExportRows(tasks)

  sheet.columns = EXCEL_COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: fitColumnWidth(
      col.header,
      rows.map((row) => row[col.key as keyof typeof row]),
    ),
  }))

  for (const row of rows) {
    sheet.addRow(row)
  }

  const headerRow = sheet.getRow(1)
  headerRow.height = 22
  headerRow.eachCell((cell) => {
    cell.font = {
      name: "Calibri",
      bold: true,
      size: HEADER_FONT_SIZE,
    }
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true }
  })

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: "Calibri", size: BODY_FONT_SIZE }
      cell.alignment = { vertical: "middle", wrapText: true }
    })
  })

  // Date column format
  const dateColIndex = EXCEL_COLUMNS.findIndex((c) => c.key === "start_date") + 1
  if (dateColIndex > 0) {
    sheet.getColumn(dateColIndex).numFmt = "yyyy-mm-dd"
  }

  return workbook
}

export async function downloadTasksExcel(
  tasks: Task[],
  filename = `repka-tasks-${new Date().toISOString().slice(0, 10)}.xlsx`,
): Promise<void> {
  if (tasks.length === 0) {
    throw new Error("Нет задач для экспорта")
  }

  const workbook = await buildTasksWorkbook(tasks)
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
