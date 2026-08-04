import { useEffect, useRef } from "react"
import { useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useUiStore } from "@/stores/ui-store"
import { DEFAULT_TASK_PRIORITY, type Task } from "@/types/task"

/** Ignore dismissals that race with the opening pointer gesture. */
const OPEN_GUARD_MS = 150

type TaskFormValues = {
  title: string
  description: string
  assignee: string
  start_date: string
  duration: number
  predecessors: string
  priority: string
}

function parsePredecessorIds(raw: string | null): number[] {
  if (!raw?.trim()) return []
  return raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => !Number.isNaN(id) && id > 0)
}

function formatPredecessorsLabel(
  task: Task,
  allTasks: Task[],
): string {
  const ids = parsePredecessorIds(task.predecessors)
  if (ids.length === 0) return "—"

  const byId = new Map(allTasks.map((t) => [t.id, t]))
  return ids
    .map((id) => {
      const pred = byId.get(id)
      return pred ? `#${id} ${pred.title}` : `#${id}`
    })
    .join(", ")
}

type TaskDetailsDialogProps = {
  tasks: Task[]
}

export function TaskDetailsDialog({ tasks }: TaskDetailsDialogProps) {
  const selectedTaskId = useUiStore((s) => s.selectedTaskId)
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId)
  const openedAtRef = useRef(0)

  const task = tasks.find((t) => t.id === selectedTaskId) ?? null
  const open = selectedTaskId !== null

  const { register, reset } = useForm<TaskFormValues>({
    defaultValues: {
      title: "",
      description: "",
      assignee: "",
      start_date: "",
      duration: 1,
      predecessors: "",
      priority: DEFAULT_TASK_PRIORITY,
    },
  })

  useEffect(() => {
    if (selectedTaskId !== null) {
      openedAtRef.current = Date.now()
    }
  }, [selectedTaskId])

  useEffect(() => {
    if (!task) return
    reset({
      title: task.title,
      description: task.description ?? "",
      assignee: task.assignee ?? "",
      start_date: task.start_date,
      duration: task.duration,
      predecessors: formatPredecessorsLabel(task, tasks),
      priority: task.priority ?? DEFAULT_TASK_PRIORITY,
    })
  }, [task, tasks, reset])

  const onOpenChange = (
    next: boolean,
    eventDetails?: { reason: string; cancel: () => void },
  ) => {
    if (next) return

    const reason = eventDetails?.reason
    const isTransientDismiss =
      reason === "outside-press" || reason === "focus-out"
    if (
      isTransientDismiss &&
      Date.now() - openedAtRef.current < OPEN_GUARD_MS
    ) {
      eventDetails?.cancel()
      return
    }

    setSelectedTaskId(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {task ? `Задача #${task.id}` : "Задача"}
          </DialogTitle>
          <DialogDescription>
            Детали задачи с диаграммы Ганта. Правки плана — через чат с AI.
          </DialogDescription>
        </DialogHeader>

        {task ? (
          <form className="grid gap-3" onSubmit={(e) => e.preventDefault()}>
            <div className="grid gap-1.5">
              <Label htmlFor="task-title">Название</Label>
              <Input id="task-title" readOnly {...register("title")} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="task-description">Описание</Label>
              <Textarea
                id="task-description"
                readOnly
                rows={3}
                className="min-h-16 resize-none"
                {...register("description")}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="task-assignee">Исполнитель</Label>
                <Input
                  id="task-assignee"
                  readOnly
                  placeholder="Не назначен"
                  {...register("assignee")}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="task-priority">Приоритет</Label>
                <Input id="task-priority" readOnly {...register("priority")} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="task-start">Начало</Label>
                <Input id="task-start" readOnly {...register("start_date")} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="task-duration">Длительность (дни)</Label>
                <Input
                  id="task-duration"
                  type="number"
                  readOnly
                  {...register("duration", { valueAsNumber: true })}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="task-predecessors">Зависимости (предшественники)</Label>
              <Input
                id="task-predecessors"
                readOnly
                {...register("predecessors")}
              />
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Задача не найдена в текущем плане.
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
