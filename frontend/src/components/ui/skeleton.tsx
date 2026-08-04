import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export function GanttLoadingSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}
      aria-busy
      aria-label="Загрузка задач"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Skeleton className="h-7 w-14" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-7" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-7 w-7" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-7" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
        <div className="flex w-[min(40%,280px)] shrink-0 flex-col border-r border-border">
          <Skeleton className="h-10 w-full rounded-none" />
          {Array.from({ length: 8 }, (_, i) => (
            <div
              key={i}
              className="flex h-10 items-center gap-2 border-t border-border px-3"
            >
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="size-6 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden p-3">
          <div className="mb-3 flex gap-1">
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className="h-4 flex-1" />
            ))}
          </div>
          <div className="space-y-3 pt-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton
                key={i}
                className="h-6"
                style={{
                  width: `${40 + ((i * 17) % 50)}%`,
                  marginLeft: `${(i * 11) % 30}%`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export { Skeleton }
