import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { CircleHelp, Loader2, MessageSquare, SendHorizontal, X } from "lucide-react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"

import { sendChatMessage } from "@/api/chat"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { useUiStore } from "@/stores/ui-store"
import type { ChatHistoryMessage } from "@/types/chat"
import { cn } from "@/lib/utils"

function chatErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === "string" && detail.trim()) return detail
    if (error.code === "ECONNABORTED") return "Превышено время ожидания ответа AI"
    if (!error.response) return "Нет связи с API. Запущен ли бэкенд?"
  }
  if (error instanceof Error) return error.message
  return "Не удалось получить ответ"
}

const TASKS_KEY = ["tasks"] as const

/** Read-only MCP tools — do not trigger «План обновлён» toast. */
const READ_ONLY_TOOLS = new Set(["get_project_summary", "search_tasks"])

const CHAT_PLACEHOLDER =
  "Например: создай задачу «Ревью», перенеси на понедельник, назначь Анне…"

const CHAT_EMPTY_HINT =
  "Могу создать и удалить задачи, сдвинуть сроки, сменить длительность и приоритет, назначить исполнителя, добавить или убрать зависимости. Нажмите «Справка» для примеров."

const ASSISTANT_HELP = `### Справка по ассистенту Repka

Я меняю план на диаграмме Ганта через инструменты. Можно просить по **названию** или **ID** задачи.

**Что умею**
- **Создать задачу** — название, дата начала, длительность, приоритет, исполнитель
- **Удалить задачу** — ссылки на неё в зависимостях очистятся
- **Перенести** — старт, финиш или оба (\`дд.мм.гг\` / «на понедельник»)
- **Сдвинуть** — относительно на ±N дней (одна или группа / по фильтру)
- **Длительность** — сколько дней занимает задача
- **Приоритет** — Критический / Высокий / Средний / Низкий / Опционально
- **Исполнитель** — назначить или снять
- **Массово** — по ID или по фильтру (исполнитель, приоритет, даты); очистка всего плана
- **Зависимости** — добавить или убрать предшественника (без циклов)

**Примеры**
- «Создай задачу „Интеграция API“ на 10 августа, 5 дней, приоритет Высокий»
- «Перенеси „Аналитика“ на 15.08.26»
- «Сдвинь все задачи Алексея на +3 дня»
- «Закончи „Дизайн“ 20.08.26» (старт подстроится)
- «Назначь задачу 42 на Ивана»
- «Перенеси все задачи Алексея на 01.09.26»
- «Назначь все критические задачи на Ивана»
- «Удали все задачи с приоритетом Опционально»
- «Удали все задачи в проекте»
- «Сделай длительность „Дизайн“ 3 дня»
- «Поставь приоритет Критический для „Релиз“»
- «Пусть „Тесты“ зависят от „Разработка“»
- «Убери зависимость задачи 15 от 8»
- «Удали задачу „Черновик“»

**Ограничения**
- Не двигаю даты автоматически только из‑за новой зависимости — попросите перенести отдельно
- Уточню, если задача неоднозначна или не найдена

После изменений Гантт обновится сам.`

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function toHistory(messages: { role: "user" | "assistant"; content: string; isError?: boolean }[]): ChatHistoryMessage[] {
  return messages
    .filter((m) => !m.isError)
    .map(({ role, content }) => ({ role, content }))
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="min-w-0 overflow-hidden [&_:first-child]:mt-0 [&_:last-child]:mb-0">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
          h3: ({ children }) => (
            <h3 className="mb-2 text-sm font-medium text-foreground">{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-medium text-foreground">{children}</strong>
          ),
          code: ({ children }) => (
            <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.8em]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="mb-2 max-w-full overflow-x-auto rounded-md bg-background/60 p-2 font-mono text-xs last:mb-0">
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              className="underline underline-offset-2 hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="mb-2 max-w-full overflow-x-auto rounded-md border border-border/60 last:mb-0">
              <table className="w-max min-w-full border-collapse text-left text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-background/70 text-muted-foreground">{children}</thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-border/50 last:border-b-0">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="whitespace-nowrap px-2.5 py-1.5 font-medium">{children}</th>
          ),
          td: ({ children }) => (
            <td className="whitespace-nowrap px-2.5 py-1.5 align-top">{children}</td>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}

type ChatPanelProps = {
  className?: string
}

export function ChatPanel({ className }: ChatPanelProps) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)

  const messages = useUiStore((s) => s.messages)
  const addMessage = useUiStore((s) => s.addMessage)
  const setChatOpen = useUiStore((s) => s.setChatOpen)

  const chatMutation = useMutation({
    mutationFn: sendChatMessage,
    onSuccess: (data) => {
      addMessage({
        id: nextId(),
        role: "assistant",
        content: data.reply,
        toolsUsed: data.tools_used,
      })
      void queryClient.invalidateQueries({ queryKey: TASKS_KEY })
      const mutatedTools = (data.tools_used ?? []).filter(
        (name) => !READ_ONLY_TOOLS.has(name),
      )
      if (mutatedTools.length) {
        toast.success(`План обновлён (${mutatedTools.join(", ")})`)
      }
    },
    onError: (error) => {
      const message = chatErrorMessage(error)
      addMessage({
        id: nextId(),
        role: "assistant",
        content: message,
        isError: true,
      })
      toast.error(message)
    },
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, chatMutation.isPending])

  const submit = () => {
    const text = draft.trim()
    if (!text || chatMutation.isPending) return

    const history = toHistory(messages)
    addMessage({ id: nextId(), role: "user", content: text })
    setDraft("")
    chatMutation.mutate({ message: text, history })
  }

  const showHelp = () => {
    addMessage({
      id: nextId(),
      role: "assistant",
      content: ASSISTANT_HELP,
    })
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Чат с AI</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Скрыть чат"
          onClick={() => setChatOpen(false)}
        >
          <X />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-3 py-3">
          {messages.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              {CHAT_EMPTY_HINT}
            </p>
          ) : null}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "max-w-[92%] min-w-0 overflow-hidden rounded-md px-3 py-2 text-sm",
                msg.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : msg.isError
                    ? "mr-auto bg-destructive/10 text-destructive"
                    : "mr-auto bg-muted text-foreground",
              )}
            >
              {msg.role === "assistant" && !msg.isError ? (
                <AssistantMarkdown content={msg.content} />
              ) : (
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              )}
              {msg.toolsUsed && msg.toolsUsed.length > 0 ? (
                <p className="mt-2 border-t border-foreground/10 pt-1.5 text-[0.7rem] text-muted-foreground">
                  Инструменты: {msg.toolsUsed.join(", ")}
                </p>
              ) : null}
            </div>
          ))}

          {chatMutation.isPending ? (
            <div className="mr-auto flex max-w-[92%] items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Думаю…
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <form
        onSubmit={onSubmit}
        className="flex shrink-0 flex-col gap-2 border-t p-3"
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={CHAT_PLACEHOLDER}
          disabled={chatMutation.isPending}
          maxLength={8000}
          className="min-h-18 max-h-36 resize-none"
          rows={3}
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={chatMutation.isPending}
            onClick={showHelp}
          >
            <CircleHelp data-icon="inline-start" />
            Справка
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={chatMutation.isPending || !draft.trim()}
          >
            {chatMutation.isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <SendHorizontal data-icon="inline-start" />
            )}
            Отправить
          </Button>
        </div>
      </form>
    </aside>
  )
}
