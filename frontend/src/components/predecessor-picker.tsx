import { useMemo, useState } from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { Task } from "@/types/task"

type PredecessorPickerProps = {
  tasks: Task[]
  excludeId?: number | null
  value: number[]
  onChange: (ids: number[]) => void
  disabled?: boolean
}

export function PredecessorPicker({
  tasks,
  excludeId,
  value,
  onChange,
  disabled,
}: PredecessorPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const options = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tasks
      .filter((t) => t.id !== excludeId)
      .filter((t) => {
        if (!q) return true
        return (
          t.title.toLowerCase().includes(q) ||
          String(t.id).includes(q) ||
          (t.assignee?.toLowerCase().includes(q) ?? false)
        )
      })
      .slice(0, 80)
  }, [tasks, excludeId, query])

  const selected = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]))
    return value
      .map((id) => byId.get(id))
      .filter((t): t is Task => Boolean(t))
  }, [tasks, value])

  const toggle = (id: number) => {
    if (value.includes(id)) {
      onChange(value.filter((x) => x !== id))
    } else {
      onChange([...value, id])
    }
  }

  return (
    <div className="grid gap-1.5">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((task) => (
            <span
              key={task.id}
              className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs"
            >
              <span className="truncate">
                #{task.id} {task.title}
              </span>
              <button
                type="button"
                disabled={disabled}
                className="shrink-0 rounded p-0.5 hover:bg-muted"
                aria-label={`Убрать #${task.id}`}
                onClick={() => toggle(task.id)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Нет зависимостей</p>
      )}

      <div className="relative">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="w-full justify-between font-normal"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="truncate text-muted-foreground">
            Добавить предшественника…
          </span>
          <ChevronsUpDown className="size-3.5 opacity-60" />
        </Button>

        {open ? (
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-2 shadow-md">
            <Input
              autoFocus
              placeholder="Поиск по названию или ID…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="mb-2 h-8"
            />
            <ul className="max-h-48 overflow-auto">
              {options.length === 0 ? (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">
                  Ничего не найдено
                </li>
              ) : (
                options.map((task) => {
                  const active = value.includes(task.id)
                  return (
                    <li key={task.id}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted",
                          active && "bg-muted/70",
                        )}
                        onClick={() => toggle(task.id)}
                      >
                        <Check
                          className={cn(
                            "size-3.5 shrink-0",
                            active ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="min-w-0 truncate">
                          #{task.id} {task.title}
                        </span>
                      </button>
                    </li>
                  )
                })
              )}
            </ul>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 w-full"
              onClick={() => {
                setOpen(false)
                setQuery("")
              }}
            >
              Готово
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
