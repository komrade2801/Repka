import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from "react"
import { FileSpreadsheet, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { parseExcelFile } from "@/lib/parse-excel"
import type { ExcelTask } from "@/lib/task-schema"

type ExcelUploadProps = {
  onParsed: (tasks: ExcelTask[]) => void | Promise<void>
  isUploading?: boolean
}

const ACCEPT = ".xlsx,.xls"

export function ExcelUpload({ onParsed, isUploading = false }: ExcelUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      setError(null)

      const lower = file.name.toLowerCase()
      if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
        setError("Поддерживаются только файлы .xlsx / .xls")
        return
      }

      try {
        const tasks = await parseExcelFile(file)
        await onParsed(tasks)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось разобрать файл")
      }
    },
    [onParsed],
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
          isUploading && "pointer-events-none opacity-60",
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
          disabled={isUploading}
          onClick={(event) => {
            event.stopPropagation()
            inputRef.current?.click()
          }}
        >
          <FileSpreadsheet data-icon="inline-start" />
          {isUploading ? "Загрузка…" : "Выбрать файл"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={onChange}
        />
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
