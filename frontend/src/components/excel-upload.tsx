import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from "react"
import { FileSpreadsheet, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { parseExcelFile, type ImportRowIssue } from "@/lib/parse-excel"
import type { ExcelTask } from "@/lib/task-schema"

type ExcelUploadProps = {
  onConfirm: (tasks: ExcelTask[]) => void | Promise<void>
  isUploading?: boolean
}

const ACCEPT = ".xlsx,.xls"
const TOAST_ISSUE_LIMIT = 5

function formatIssuesToast(
  stats: { total: number; success: number; errors: number; duplicates: number },
  errors: ImportRowIssue[],
  duplicates: ImportRowIssue[],
): { title: string; description: string } {
  const title = `Импорт отклонён: ошибок ${stats.errors}, дубликатов ${stats.duplicates} (из ${stats.total})`
  const lines = [...errors, ...duplicates].slice(0, TOAST_ISSUE_LIMIT).map((item) => {
    const label = item.title ? ` «${item.title}»` : ""
    return `Строка ${item.row}${label}: ${item.message}`
  })
  const rest = stats.errors + stats.duplicates - lines.length
  if (rest > 0) lines.push(`…и ещё ${rest}`)
  return { title, description: lines.join("\n") }
}

export function ExcelUpload({ onConfirm, isUploading = false }: ExcelUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      setFatalError(null)

      const lower = file.name.toLowerCase()
      if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
        const message = "Поддерживаются только файлы .xlsx / .xls"
        setFatalError(message)
        toast.error(message)
        return
      }

      setIsParsing(true)
      try {
        const result = await parseExcelFile(file)
        if (result.hasIssues) {
          const { title, description } = formatIssuesToast(
            result.stats,
            result.errors,
            result.duplicates,
          )
          toast.error(title, { description, duration: 8000 })
          return
        }
        await onConfirm(result.valid)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Не удалось разобрать файл"
        setFatalError(message)
        toast.error(message)
      } finally {
        setIsParsing(false)
      }
    },
    [onConfirm],
  )

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsDragging(false)
      void handleFile(event.dataTransfer.files?.[0])
    },
    [handleFile],
  )

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      void handleFile(event.target.files?.[0])
      event.target.value = ""
    },
    [handleFile],
  )

  const busy = isUploading || isParsing

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed px-6 py-10 text-center transition-colors",
          isDragging
            ? "border-primary bg-muted"
            : "border-border hover:bg-muted/50",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <div className="rounded-md bg-muted p-3">
          <Upload className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">
            Перетащите Excel сюда или нажмите, чтобы выбрать
          </p>
          <p className="text-xs text-muted-foreground">.xlsx / .xls</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation()
            inputRef.current?.click()
          }}
        >
          <FileSpreadsheet data-icon="inline-start" />
          {isParsing ? "Проверка…" : isUploading ? "Загрузка…" : "Выбрать файл"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={onChange}
        />
      </div>
      {fatalError ? (
        <p className="text-sm text-destructive" role="alert">
          {fatalError}
        </p>
      ) : null}
    </div>
  )
}
