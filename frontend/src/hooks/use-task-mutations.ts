import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  createTask,
  deleteTask,
  importTasks,
  updateTask,
} from "@/api/tasks"
import {
  TASKS_QUERY_KEY,
  type TaskCreate,
  type TaskUpdate,
} from "@/types/task"

export function useTaskMutations() {
  const queryClient = useQueryClient()

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY })

  const createMutation = useMutation({
    mutationFn: (payload: TaskCreate) => createTask(payload),
    onSuccess: (task) => {
      void invalidate()
      toast.success(`Создана задача «${task.title}»`)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Не удалось создать задачу",
      )
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: TaskUpdate }) =>
      updateTask(id, payload),
    onSuccess: (task) => {
      void invalidate()
      toast.success(`Сохранена задача «${task.title}»`)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Не удалось сохранить задачу",
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTask(id),
    onSuccess: () => {
      void invalidate()
      toast.success("Задача удалена")
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Не удалось удалить задачу",
      )
    },
  })

  const importMutation = useMutation({
    mutationFn: (tasks: TaskCreate[]) => importTasks(tasks),
    onSuccess: (result) => {
      void invalidate()
      const created = result.created.length
      const skipped = result.skipped.length
      if (created === 0 && skipped > 0) {
        toast.message("Новых задач нет", {
          description: `Пропущено дубликатов: ${skipped}`,
        })
      } else if (skipped > 0) {
        toast.success(`Добавлено: ${created}`, {
          description: `Пропущено дубликатов: ${skipped}`,
        })
      } else {
        toast.success(`Добавлено задач: ${created}`)
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось импортировать задачи",
      )
    },
  })

  return {
    createMutation,
    updateMutation,
    deleteMutation,
    importMutation,
  }
}
