import { useEffect, useRef, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { PredecessorPicker } from "@/components/predecessor-picker"
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
import { useTaskMutations } from "@/hooks/use-task-mutations"
import { toISODate } from "@/lib/date"
import {
  idsToPredecessors,
  predecessorsToIds,
  TASK_FIELD_MAX,
  taskFormSchema,
  type TaskFormValues,
} from "@/lib/task-form-schema"
import { useUiStore } from "@/stores/ui-store"
import {
  DEFAULT_TASK_PRIORITY,
  TASK_PRIORITIES,
  type Task,
} from "@/types/task"

/** Ignore dismissals that race with the opening pointer gesture. */
const OPEN_GUARD_MS = 150

function emptyCreateValues(): TaskFormValues {
  return {
    title: "",
    description: "",
    assignee: "",
    start_date: toISODate(new Date()),
    duration: 1,
    predecessorIds: [],
    priority: DEFAULT_TASK_PRIORITY,
  }
}

function taskToFormValues(task: Task): TaskFormValues {
  return {
    title: task.title,
    description: task.description ?? "",
    assignee: task.assignee ?? "",
    start_date: task.start_date,
    duration: task.duration,
    predecessorIds: predecessorsToIds(task.predecessors),
    priority: task.priority ?? DEFAULT_TASK_PRIORITY,
  }
}

type TaskDetailsDialogProps = {
  tasks: Task[]
}

export function TaskDetailsDialog({ tasks }: TaskDetailsDialogProps) {
  const selectedTaskId = useUiStore((s) => s.selectedTaskId)
  const isCreatingTask = useUiStore((s) => s.isCreatingTask)
  const closeTaskDialog = useUiStore((s) => s.closeTaskDialog)
  const openedAtRef = useRef(0)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { createMutation, updateMutation, deleteMutation } = useTaskMutations()

  const task =
    selectedTaskId !== null
      ? (tasks.find((t) => t.id === selectedTaskId) ?? null)
      : null
  const isCreate = isCreatingTask
  const open = isCreate || selectedTaskId !== null

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: emptyCreateValues(),
  })

  useEffect(() => {
    if (open) {
      openedAtRef.current = Date.now()
      setConfirmDelete(false)
    }
  }, [open, selectedTaskId, isCreatingTask])

  useEffect(() => {
    if (!open) return
    if (isCreate) {
      reset(emptyCreateValues())
      return
    }
    if (task) {
      reset(taskToFormValues(task))
    }
    // Intentionally not resetting on every `tasks` refresh while editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dirty form must survive invalidate
  }, [open, isCreate, selectedTaskId, reset])

  const pending =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending

  const onOpenChange = (
    next: boolean,
    eventDetails?: { reason: string; cancel: () => void },
  ) => {
    if (next) return
    if (pending) {
      eventDetails?.cancel?.()
      return
    }

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

    setConfirmDelete(false)
    closeTaskDialog()
  }

  const onSubmit = handleSubmit(async (values) => {
    const payload = {
      title: values.title.trim(),
      description: values.description.trim() || null,
      assignee: values.assignee.trim() || null,
      start_date: values.start_date,
      duration: values.duration,
      predecessors: idsToPredecessors(values.predecessorIds),
      priority: values.priority,
    }

    try {
      if (isCreate) {
        await createMutation.mutateAsync(payload)
      } else if (task) {
        await updateMutation.mutateAsync({ id: task.id, payload })
      }
      closeTaskDialog()
    } catch {
      // toast handled in mutation
    }
  })

  const onDelete = async () => {
    if (!task) return
    try {
      await deleteMutation.mutateAsync(task.id)
      setConfirmDelete(false)
      closeTaskDialog()
    } catch {
      // toast handled in mutation
    }
  }

  const missingEditTarget = !isCreate && selectedTaskId !== null && !task

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>
              {isCreate
                ? "Новая задача"
                : task
                  ? `Задача #${task.id}`
                  : "Задача"}
            </DialogTitle>
            <DialogDescription>
              {isCreate
                ? "Создание задачи вручную. После сохранения диаграмма обновится."
                : "Редактирование задачи. Несохранённые изменения сбрасываются при закрытии."}
            </DialogDescription>
          </DialogHeader>

          {missingEditTarget ? (
            <p className="text-sm text-muted-foreground">
              Задача не найдена в текущем плане.
            </p>
          ) : (
            <form className="grid gap-3" onSubmit={onSubmit} id="task-form">
              <div className="grid gap-1.5">
                <Label htmlFor="task-title">Название</Label>
                <Input
                  id="task-title"
                  disabled={pending}
                  maxLength={TASK_FIELD_MAX.title}
                  {...register("title")}
                />
                {errors.title ? (
                  <p className="text-xs text-destructive">
                    {errors.title.message}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="task-description">Описание</Label>
                <Textarea
                  id="task-description"
                  rows={3}
                  disabled={pending}
                  maxLength={TASK_FIELD_MAX.description}
                  className="min-h-16 resize-none"
                  {...register("description")}
                />
                {errors.description ? (
                  <p className="text-xs text-destructive">
                    {errors.description.message}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="task-assignee">Исполнитель</Label>
                  <Input
                    id="task-assignee"
                    disabled={pending}
                    maxLength={TASK_FIELD_MAX.assignee}
                    placeholder="Не назначен"
                    {...register("assignee")}
                  />
                  {errors.assignee ? (
                    <p className="text-xs text-destructive">
                      {errors.assignee.message}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="task-priority">Приоритет</Label>
                  <select
                    id="task-priority"
                    disabled={pending}
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                    {...register("priority")}
                  >
                    {TASK_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="task-start">Начало</Label>
                  <Input
                    id="task-start"
                    type="date"
                    disabled={pending}
                    {...register("start_date")}
                  />
                  {errors.start_date ? (
                    <p className="text-xs text-destructive">
                      {errors.start_date.message}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="task-duration">Длительность (дни)</Label>
                  <Input
                    id="task-duration"
                    type="number"
                    min={1}
                    disabled={pending}
                    {...register("duration", { valueAsNumber: true })}
                  />
                  {errors.duration ? (
                    <p className="text-xs text-destructive">
                      {errors.duration.message}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label>Зависимости (предшественники)</Label>
                <Controller
                  control={control}
                  name="predecessorIds"
                  render={({ field }) => (
                    <PredecessorPicker
                      tasks={tasks}
                      excludeId={task?.id ?? null}
                      value={field.value}
                      onChange={field.onChange}
                      disabled={pending}
                    />
                  )}
                />
              </div>
            </form>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {!isCreate && task ? (
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() => setConfirmDelete(true)}
              >
                Удалить
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              {!missingEditTarget ? (
                <Button type="submit" form="task-form" disabled={pending}>
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Сохранить
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onOpenChange={(next) => {
          if (!next && !deleteMutation.isPending) setConfirmDelete(false)
        }}
      >
        <DialogContent className="sm:max-w-sm" showCloseButton>
          <DialogHeader>
            <DialogTitle>Удалить задачу?</DialogTitle>
            <DialogDescription>
              {task
                ? `Задача «${task.title}» будет удалена. Ссылки на неё в зависимостях других задач очистятся.`
                : "Задача будет удалена."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleteMutation.isPending}
              onClick={() => setConfirmDelete(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => void onDelete()}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
