import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Download, MessageSquare, Upload } from "lucide-react"
import { toast } from "sonner"

import { fetchTasks } from "@/api/tasks"
import { ChatPanel } from "@/components/chat-panel"
import { ExcelUpload } from "@/components/excel-upload"
import { GanttChart } from "@/components/gantt-chart"
import { RepkaLogo } from "@/components/repka-logo"
import { TaskDetailsDialog } from "@/components/task-details-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { GanttLoadingSkeleton } from "@/components/ui/skeleton"
import { useTaskMutations } from "@/hooks/use-task-mutations"
import { downloadTasksExcel } from "@/lib/export-excel"
import type { ExcelTask } from "@/lib/task-schema"
import { cn } from "@/lib/utils"
import { useUiStore } from "@/stores/ui-store"
import { TASKS_QUERY_KEY } from "@/types/task"

export default function App() {
  const [importOpen, setImportOpen] = useState(false)
  const isChatOpen = useUiStore((s) => s.isChatOpen)
  const setChatOpen = useUiStore((s) => s.setChatOpen)
  const selectedTaskId = useUiStore((s) => s.selectedTaskId)
  const isCreatingTask = useUiStore((s) => s.isCreatingTask)
  const taskDialogOpen = selectedTaskId !== null || isCreatingTask

  const tasksQuery = useQuery({
    queryKey: TASKS_QUERY_KEY,
    queryFn: fetchTasks,
    placeholderData: (previous) => previous,
  })

  const { importMutation } = useTaskMutations()

  const tasks = tasksQuery.data ?? []

  const handleExport = () => {
    void (async () => {
      try {
        await downloadTasksExcel(tasks)
        toast.success(`Экспортировано задач: ${tasks.length}`)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Не удалось экспортировать",
        )
      }
    })()
  }

  return (
    <main className="flex h-svh flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <RepkaLogo className="size-7 shrink-0 text-foreground" />
          <h1 className="truncate text-base font-medium tracking-tight">
            Repka / BIOCAD
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!isChatOpen ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={taskDialogOpen}
              title={
                taskDialogOpen
                  ? "Закройте карточку задачи, чтобы открыть чат"
                  : undefined
              }
              onClick={() => setChatOpen(true)}
            >
              <MessageSquare data-icon="inline-start" />
              Чат
            </Button>
          ) : null}

          <Dialog
            open={importOpen}
            onOpenChange={(open) => {
              setImportOpen(open)
              if (!open) importMutation.reset()
            }}
          >
            <DialogTrigger
              render={
                <Button type="button" variant="outline" size="sm">
                  <Upload data-icon="inline-start" />
                  Импорт
                </Button>
              }
            />
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Импорт Excel</DialogTitle>
                <DialogDescription>
                  Добавляет только новые задачи с уникальным названием.
                  Дубликаты (без учёта регистра) пропускаются. Колонки: Задача,
                  Описание, Исполнитель, Дата начала, Длительность,
                  Предшественники, Приоритет.
                </DialogDescription>
              </DialogHeader>
              <ExcelUpload
                isUploading={importMutation.isPending}
                onConfirm={async (parsed: ExcelTask[]) => {
                  await importMutation.mutateAsync(parsed)
                  setImportOpen(false)
                }}
              />
              {importMutation.isError ? (
                <p className="text-sm text-destructive" role="alert">
                  {importMutation.error instanceof Error
                    ? importMutation.error.message
                    : "Ошибка загрузки"}
                </p>
              ) : null}
            </DialogContent>
          </Dialog>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={tasks.length === 0 || tasksQuery.isLoading}
            onClick={handleExport}
          >
            <Download data-icon="inline-start" />
            Экспорт
          </Button>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-0.5 sm:px-6 sm:pb-6">
          {tasksQuery.isLoading ? (
            <GanttLoadingSkeleton className="min-h-0" />
          ) : tasksQuery.isError ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-destructive">
              Не удалось загрузить задачи. Запущен ли API на порту 8000?
            </div>
          ) : (
            <GanttChart
              className="min-h-0"
              tasks={tasks}
              /* Chat compresses width: day/week fit-resize; month may H-scroll. */
              allowHorizontalScroll={isChatOpen}
            />
          )}
        </div>

        <div
          className={cn(
            "min-h-0 shrink-0 overflow-hidden border-t lg:border-t-0 lg:border-l",
            /* Width snaps instantly so the gantt can refit without mid-animation jitter. */
            "transition-[opacity,height] duration-200",
            isChatOpen
              ? "h-[min(40vh,320px)] w-full opacity-100 lg:h-auto lg:w-[min(100%,360px)]"
              : "pointer-events-none h-0 w-0 border-0 opacity-0 lg:h-auto",
          )}
        >
          {isChatOpen ? <ChatPanel className="h-full" /> : null}
        </div>
      </section>

      <TaskDetailsDialog tasks={tasks} />
    </main>
  )
}
