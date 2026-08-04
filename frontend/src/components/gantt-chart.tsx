import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react"
import { Gantt, ViewMode, type Task as GanttTask } from "gantt-task-react"
import "gantt-task-react/dist/index.css"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  endOfMonth,
  endOfWeekSunday,
  isoWeekNumber,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeekMonday,
} from "@/lib/date"
import { toGanttTasks, PRIORITY_COLORS } from "@/lib/gantt-mapper"
import { useUiStore } from "@/stores/ui-store"
import {
  DEFAULT_TASK_PRIORITY,
  type Task,
  type TaskPriority,
} from "@/types/task"
import { cn } from "@/lib/utils"

type GanttChartProps = {
  tasks: Task[]
  className?: string
  /**
   * When true (e.g. AI chat open), month view keeps a min column width and the
   * shell can scroll horizontally. Day/week always fit-resize.
   */
  allowHorizontalScroll?: boolean
}

type ChartScale = "day" | "week" | "month"
type SortKey = "title" | "assignee" | "priority" | "dates"
type SortDir = "asc" | "desc"

type HoverTip = {
  clientX: number
  clientY: number
  title: string
  lines: string[]
}

const TIP_GAP = 12
const TIP_PAD = 8

/** Prefer below-right of the cursor; flip/clamp when the viewport is tight. */
function fitHoverTip(
  clientX: number,
  clientY: number,
  width: number,
  height: number,
): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight

  let left = clientX + TIP_GAP
  if (left + width > vw - TIP_PAD) {
    left = clientX - TIP_GAP - width
  }
  if (left < TIP_PAD) left = TIP_PAD
  if (left + width > vw - TIP_PAD) {
    left = Math.max(TIP_PAD, vw - TIP_PAD - width)
  }

  let top = clientY + TIP_GAP
  if (top + height > vh - TIP_PAD) {
    top = clientY - TIP_GAP - height
  }
  if (top < TIP_PAD) top = TIP_PAD
  if (top + height > vh - TIP_PAD) {
    top = Math.max(TIP_PAD, vh - TIP_PAD - height)
  }

  return { left, top }
}

/** Library TooltipContent — unused; scroll-linked wrapper is hidden via CSS. */
function EmptyGanttTooltip() {
  return null
}

type ListLayout = {
  title: number
  assignee: number
  priority: number
  dates: number
  total: number
  showAssignee: boolean
  showPriority: boolean
  /** Dot-only priority column (month view). */
  priorityCompact: boolean
  showDates: boolean
}

const SCALE_OPTIONS: { scale: ChartScale; label: string }[] = [
  { scale: "day", label: "День" },
  { scale: "week", label: "Неделя" },
  { scale: "month", label: "Месяц" },
]

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const
const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
] as const
const MONTHS_LONG = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
] as const

const HEADER_ROW_H = 32
const CALENDAR_HEADER_H = HEADER_ROW_H
const SPLITTER_W = 1
/** Top + bottom border of `.gantt-shell` (border-box). */
const SHELL_BORDER_Y = 2
const ROW_HEIGHT = 44
const MIN_COL_WITH_SCROLL = 36
const DATES_COL = 96
const ASSIGNEE_COL = 150
const PRIORITY_COL = 120
/** Month view: colored dot only. */
const PRIORITY_COL_COMPACT = 36
const LIST_MIN = 160
const LIST_MAX = 790
/** Reserved width for the library vertical scrollbar when content overflows. */
const V_SCROLL_W = 12
const LIST_DEFAULT: Record<ChartScale, number> = {
  day: 650,
  week: 680,
  month: 560,
}

const PRIORITY_RANK: Record<TaskPriority, number> = {
  Критический: 0,
  Высокий: 1,
  Средний: 2,
  Низкий: 3,
  Опционально: 4,
}

type ChartMetrics = {
  /**
   * Width passed to gantt-task-react (uniform). When fitting the shell this is
   * the average availableWidth / columns so the SVG spans the timeline flush.
   */
  columnWidth: number
  /** Floor width for overlay cells; first `columnRemainder` columns get +1px. */
  baseColWidth: number
  /** Number of leading columns that are baseColWidth + 1. */
  columnRemainder: number
  /** Exact available timeline width (no stub gap on the right when fitting). */
  timelineWidth: number
  /** List pane width (hint); timeline takes the remaining shell. */
  listWidth: number
  ganttHeight: number
  /** True only when fixed window is wider than the timeline viewport. */
  needsHorizontalScroll: boolean
  /** Library vertical scrollbar is shown; width reserved from the shell. */
  needsVerticalScroll: boolean
  vScrollWidth: number
}

type VisibleWindow = {
  start: Date
  /** Exclusive end. */
  end: Date
  columns: number
}

function formatCompactRange(start: Date, exclusiveEnd: Date): string {
  const end = addDays(exclusiveEnd, -1)
  const fmt = (d: Date) => {
    const dd = String(d.getDate()).padStart(2, "0")
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    return `${dd}.${mm}`
  }
  return `${fmt(start)}–${fmt(end)}`
}

/** Flatten task fields for client-side full-row search. */
function taskSearchHaystack(task: Task): string {
  const start = parseISO(task.start_date)
  const end = addDays(start, Math.max(task.duration, 1))
  return [
    task.id,
    task.title,
    task.description,
    task.assignee,
    task.priority,
    task.start_date,
    task.duration,
    task.predecessors,
    formatCompactRange(start, end),
  ]
    .filter((v) => v != null && String(v).trim() !== "")
    .join("\n")
    .toLocaleLowerCase("ru")
}

function compareTasks(a: Task, b: Task, key: SortKey, dir: SortDir): number {
  const sign = dir === "asc" ? 1 : -1
  if (key === "dates") {
    const da = parseISO(a.start_date).getTime()
    const db = parseISO(b.start_date).getTime()
    if (da !== db) return (da < db ? -1 : 1) * sign
    return (a.id - b.id) * sign
  }
  if (key === "priority") {
    const pa = PRIORITY_RANK[a.priority ?? DEFAULT_TASK_PRIORITY] ?? 2
    const pb = PRIORITY_RANK[b.priority ?? DEFAULT_TASK_PRIORITY] ?? 2
    if (pa !== pb) return (pa - pb) * sign
    return (a.id - b.id) * sign
  }
  const left =
    key === "assignee" ? (a.assignee ?? "").trim() : a.title.trim()
  const right =
    key === "assignee" ? (b.assignee ?? "").trim() : b.title.trim()
  const cmp = left.localeCompare(right, "ru", { sensitivity: "base" })
  if (cmp !== 0) return cmp * sign
  return (a.id - b.id) * sign
}

function formatDayLabel(date: Date): string {
  const weekday = WEEKDAY_LABELS[(date.getDay() + 6) % 7]
  return `${weekday}, ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`
}

function formatWeekLabel(monday: Date): string {
  const sunday = endOfWeekSunday(monday)
  const week = isoWeekNumber(monday)
  const fmt = (d: Date) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
  const range =
    monday.getMonth() === sunday.getMonth()
      ? `${monday.getDate()}–${fmt(sunday)} ${sunday.getFullYear()}`
      : `${fmt(monday)} – ${fmt(sunday)} ${sunday.getFullYear()}`
  return `Неделя ${week} · ${range}`
}

function formatMonthLabel(date: Date): string {
  return `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`
}

function buildListLayout(
  totalWidth: number,
  showAssignee: boolean,
  showPriority: boolean,
  showDatesPref: boolean,
  priorityCompact = false,
): ListLayout {
  const showDates = showDatesPref
  const showAssigneeEff = showAssignee
  const showPriorityEff = showPriority
  if (totalWidth <= 0) {
    return {
      title: 0,
      assignee: 0,
      priority: 0,
      dates: 0,
      total: 0,
      showAssignee: showAssigneeEff,
      showPriority: showPriorityEff,
      priorityCompact,
      showDates,
    }
  }
  const assignee = showAssigneeEff ? ASSIGNEE_COL : 0
  const priority = showPriorityEff
    ? priorityCompact
      ? PRIORITY_COL_COMPACT
      : PRIORITY_COL
    : 0
  const dates = showDates ? DATES_COL : 0
  const minNeeded = 96 + assignee + priority + dates
  const total = Math.min(
    LIST_MAX,
    Math.max(LIST_MIN, minNeeded, totalWidth),
  )
  const title = Math.max(96, total - assignee - priority - dates)
  return {
    title,
    assignee,
    priority,
    dates,
    total: title + assignee + priority + dates,
    showAssignee: showAssigneeEff,
    showPriority: showPriorityEff,
    priorityCompact,
    showDates,
  }
}

function getVisibleWindow(scale: ChartScale, viewDate: Date): VisibleWindow {
  if (scale === "day") {
    const start = startOfDay(viewDate)
    return { start, end: addDays(start, 1), columns: 1 }
  }
  if (scale === "week") {
    const start = startOfWeekMonday(viewDate)
    return { start, end: addDays(start, 7), columns: 7 }
  }
  const start = startOfMonth(viewDate)
  const columns = daysInMonth(viewDate)
  return { start, end: addDays(endOfMonth(viewDate), 1), columns }
}

function overlapsWindow(task: GanttTask, window: VisibleWindow): boolean {
  return task.start < window.end && task.end > window.start
}

/** Clamp bar to the visible window so the library date span stays tight. */
function clampToWindow(task: GanttTask, window: VisibleWindow): GanttTask {
  const start = task.start < window.start ? new Date(window.start) : new Date(task.start)
  let end = task.end > window.end ? new Date(window.end) : new Date(task.end)
  // Library needs end > start; keep at least one day inside the window.
  if (end <= start) end = addDays(start, 1)
  return { ...task, start, end }
}

/**
 * Library starts calendar at min(task.start) - preSteps.
 * Choose preSteps so dates[0] = window.start - 1 day (pad), dates[1] = window.start.
 */
function preStepsForWindow(tasks: GanttTask[], windowStart: Date): number {
  if (tasks.length === 0) return 1
  let minStart = startOfDay(tasks[0].start)
  for (const task of tasks) {
    const day = startOfDay(task.start)
    if (day < minStart) minStart = day
  }
  const padStart = addDays(windowStart, -1)
  if (minStart <= padStart) return 1
  return Math.max(1, daysBetween(padStart, minStart))
}

function windowDates(window: VisibleWindow): Date[] {
  const dates: Date[] = []
  let cursor = new Date(window.start)
  while (cursor < window.end) {
    dates.push(new Date(cursor))
    cursor = addDays(cursor, 1)
  }
  return dates
}

/**
 * Stable displayOrder for the library. We deliberately do NOT append a synthetic
 * window-span row: an extra barTasks entry made ganttFullHeight disagree with the
 * task list and teleported scrollY to 0 at the bottom. Calendar coverage for the
 * fixed window comes from PeriodHeader / PeriodBodyGrid instead.
 */
function withDisplayOrder(tasks: GanttTask[]): GanttTask[] {
  return tasks.map((task, index) => ({
    ...task,
    displayOrder: index + 1,
  }))
}

/** Hide library bar selection when our modal selection is cleared. */
function withoutSelectedBarStyles(tasks: GanttTask[]): GanttTask[] {
  return tasks.map((task) => {
    const backgroundColor = task.styles?.backgroundColor
    const progressColor = task.styles?.progressColor ?? backgroundColor
    if (!backgroundColor) return task
    return {
      ...task,
      styles: {
        ...task.styles,
        backgroundSelectedColor: backgroundColor,
        progressSelectedColor: progressColor,
      },
    }
  })
}

/** Integer +1px remainder distribution: first N columns are one pixel wider. */
function getColumnWidth(
  index: number,
  baseColWidth: number,
  columnRemainder: number,
): number {
  return index < columnRemainder ? baseColWidth + 1 : baseColWidth
}

/**
 * Fit columns into the shell. When not horizontally scrolling, timelineWidth
 * equals availableWidth exactly; pixel remainder is spread via +1px on the
 * first `remainder` columns (no stub gap, especially with the list collapsed).
 * Horizontal overflow only when allowScroll and min col no longer fits.
 *
 * `maxShellHeight` is the viewport cap (parent flex area). Body height hugs
 * task rows until that cap, then vertical scroll locks at the cap.
 */
function computeMetrics(
  shell: HTMLElement,
  columns: number,
  allowScroll: boolean,
  listWidthHint = 0,
  taskCount = 0,
  maxShellHeight?: number,
): ChartMetrics {
  const shellWidth = shell.clientWidth
  const hint = Math.max(0, listWidthHint)
  const safeColumns = Math.max(1, columns)

  const maxH = Math.max(
    CALENDAR_HEADER_H + ROW_HEIGHT + SHELL_BORDER_Y,
    maxShellHeight ?? shell.clientHeight,
  )
  const availableHeight = Math.max(
    ROW_HEIGHT,
    Math.floor(maxH - CALENDAR_HEADER_H - SHELL_BORDER_Y),
  )
  // Library ganttFullHeight = taskCount * rowHeight (no synthetic rows).
  // Empty period: fill the viewport so the placeholder isn't a one-row stub.
  const contentHeight =
    taskCount <= 0
      ? availableHeight
      : Math.max(ROW_HEIGHT, taskCount * ROW_HEIGHT)
  const needsVerticalScroll = taskCount > 0 && contentHeight > availableHeight
  const vScrollWidth = needsVerticalScroll ? V_SCROLL_W : 0

  const available = Math.max(40, shellWidth - hint - vScrollWidth)

  let columnWidth: number
  let baseColWidth: number
  let columnRemainder: number
  let timelineWidth: number
  let listWidth: number
  let needsHorizontalScroll = false

  const fitExact = (width: number) => {
    const base = Math.floor(width / safeColumns)
    if (base < 24) {
      // Too narrow to fit at MIN_COL; keep uniform 24px (may overflow shell).
      return {
        baseColWidth: 24,
        columnRemainder: 0,
        timelineWidth: 24 * safeColumns,
        columnWidth: 24,
        listWidth:
          hint > 0
            ? Math.max(0, shellWidth - 24 * safeColumns - vScrollWidth)
            : 0,
      }
    }
    const rem = width - base * safeColumns
    return {
      baseColWidth: base,
      columnRemainder: rem,
      timelineWidth: width,
      // Average for the library so N·col ≈ available (SVG flush with shell).
      columnWidth: width / safeColumns,
      listWidth: hint > 0 ? shellWidth - width - vScrollWidth : 0,
    }
  }

  if (allowScroll) {
    const natural = Math.floor(available / safeColumns)
    if (natural < MIN_COL_WITH_SCROLL) {
      columnWidth = MIN_COL_WITH_SCROLL
      baseColWidth = MIN_COL_WITH_SCROLL
      columnRemainder = 0
      needsHorizontalScroll = true
      timelineWidth = columnWidth * safeColumns
      listWidth = hint
    } else {
      ;({
        columnWidth,
        baseColWidth,
        columnRemainder,
        timelineWidth,
        listWidth,
      } = fitExact(available))
    }
  } else {
    ;({
      columnWidth,
      baseColWidth,
      columnRemainder,
      timelineWidth,
      listWidth,
    } = fitExact(available))
  }

  const ganttHeight = Math.min(contentHeight, availableHeight)

  return {
    columnWidth,
    baseColWidth,
    columnRemainder,
    timelineWidth,
    listWidth,
    ganttHeight,
    needsHorizontalScroll,
    needsVerticalScroll,
    vScrollWidth,
  }
}

/** Library pad day sits at scrollLeft=0; visible window starts at +columnWidth. */
function lockTimelinePad(timeline: HTMLElement | null, padPx: number) {
  if (!timeline) return
  if (timeline.scrollLeft !== padPx) timeline.scrollLeft = padPx
}

function AssigneeName({ name }: { name: string | null | undefined }) {
  const label = name?.trim() || "—"
  return (
    <span
      className={cn(
        "block min-w-0 truncate text-[13px] leading-tight",
        name?.trim() ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
    </span>
  )
}

function PriorityCell({
  priority,
  compact = false,
}: {
  priority: TaskPriority | null | undefined
  compact?: boolean
}) {
  const value = priority ?? DEFAULT_TASK_PRIORITY
  const color =
    PRIORITY_COLORS[value]?.backgroundColor ??
    PRIORITY_COLORS[DEFAULT_TASK_PRIORITY].backgroundColor
  const dot = (
    <span
      data-gantt-priority-tip={value}
      className="inline-flex size-2.5 shrink-0 cursor-default rounded-full"
      style={{ backgroundColor: color }}
      aria-label={value}
    />
  )
  if (compact) return dot
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {dot}
      <span className="min-w-0 truncate text-[13px] leading-tight text-foreground">
        {value}
      </span>
    </span>
  )
}

function PeriodHeader({
  left,
  timelineWidth,
  baseColWidth,
  columnRemainder,
  dates,
  scale,
}: {
  left: number
  timelineWidth: number
  baseColWidth: number
  columnRemainder: number
  dates: Date[]
  scale: ChartScale
}) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 box-border overflow-hidden border-b border-border bg-background"
      style={{
        left,
        width: timelineWidth,
        height: CALENDAR_HEADER_H,
        boxShadow: "inset 1px 0 0 var(--border)",
      }}
    >
      <div
        className="box-border flex"
        style={{
          width: timelineWidth,
          height: HEADER_ROW_H,
        }}
      >
        {dates.map((date, index) => {
          let label: string
          if (scale === "month") {
            label = String(date.getDate())
          } else {
            label = WEEKDAY_LABELS[(date.getDay() + 6) % 7]
          }
          return (
            <div
              key={date.toISOString()}
              className="box-border flex shrink-0 items-center justify-center text-xs font-medium"
              style={{
                width: getColumnWidth(index, baseColWidth, columnRemainder),
                height: HEADER_ROW_H,
              }}
            >
              {label}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Full-window vertical day rules under bars (library ticks stop early). */
function PeriodBodyGrid({
  left,
  timelineWidth,
  height,
  columns,
  baseColWidth,
  columnRemainder,
}: {
  left: number
  timelineWidth: number
  height: number
  columns: number
  baseColWidth: number
  columnRemainder: number
}) {
  const line = "color-mix(in oklab, var(--border) 40%, transparent)"
  return (
    <div
      className="pointer-events-none absolute z-0 flex"
      style={{
        left,
        top: CALENDAR_HEADER_H,
        width: timelineWidth,
        height,
        boxShadow: `inset 1px 0 0 ${line}`,
      }}
      aria-hidden
    >
      {Array.from({ length: columns }, (_, index) => (
        <div
          key={index}
          className="box-border h-full shrink-0"
          style={{
            width: getColumnWidth(index, baseColWidth, columnRemainder),
            boxShadow: `inset -1px 0 0 ${line}`,
          }}
        />
      ))}
    </div>
  )
}

export function GanttChart({
  tasks,
  className,
  allowHorizontalScroll = false,
}: GanttChartProps) {
  const [scale, setScale] = useState<ChartScale>("day")
  const [viewDate, setViewDate] = useState(() => startOfDay(new Date()))
  const [metrics, setMetrics] = useState<ChartMetrics>({
    columnWidth: 80,
    baseColWidth: 80,
    columnRemainder: 0,
    timelineWidth: 560,
    listWidth: LIST_DEFAULT.day,
    ganttHeight: 400,
    needsHorizontalScroll: false,
    needsVerticalScroll: false,
    vScrollWidth: 0,
  })
  const [listWidth, setListWidth] = useState(() => LIST_DEFAULT.day)
  const [listCollapsed, setListCollapsed] = useState(false)
  const [showAssigneeCol, setShowAssigneeCol] = useState(true)
  const [showPriorityCol, setShowPriorityCol] = useState(true)
  const [showDatesCol, setShowDatesCol] = useState(true)
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("title")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [timelineLeft, setTimelineLeft] = useState(LIST_DEFAULT.day)
  /** Current view is settled and safe to show. */
  const [isReady, setIsReady] = useState(false)
  /**
   * Last fully-ready frame kept on screen while the next one paints hidden.
   * Avoids blank/skeleton flashes on scale or slider changes.
   */
  const [frozen, setFrozen] = useState<{
    chartKey: string
    scale: ChartScale
    metrics: ChartMetrics
    timelineLeft: number
    periodDates: Date[]
    tasks: GanttTask[]
    preSteps: number
    viewStart: Date
    columns: number
  } | null>(null)

  const shellRef = useRef<HTMLDivElement>(null)
  /** Flex area that defines the max shell height (shell itself may hug content). */
  const viewportRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const columnsMenuRef = useRef<HTMLDivElement>(null)
  const resizeDrag = useRef<{ startX: number; startWidth: number } | null>(null)
  const setSelectedTaskId = useUiStore((state) => state.setSelectedTaskId)
  const selectedTaskId = useUiStore((state) => state.selectedTaskId)
  const openCreateTask = useUiStore((state) => state.openCreateTask)
  const [hoverTip, setHoverTip] = useState<HoverTip | null>(null)

  /** Only month may H-scroll when chat compresses; day/week always fit-resize. */
  const effectiveAllowScroll = allowHorizontalScroll && scale === "month"

  const listLayout = useMemo(
    () =>
      buildListLayout(
        listCollapsed ? 0 : listWidth,
        showAssigneeCol,
        showPriorityCol,
        showDatesCol,
        scale === "month",
      ),
    [listWidth, listCollapsed, showAssigneeCol, showPriorityCol, showDatesCol, scale],
  )

  const listWidthForShell = listCollapsed ? 0 : listLayout.total

  const tasksById = useMemo(
    () => new Map(tasks.map((task) => [String(task.id), task])),
    [tasks],
  )

  const preparedTasks = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase("ru")
    const filtered = q
      ? tasks.filter((task) => taskSearchHaystack(task).includes(q))
      : tasks.slice()
    filtered.sort((a, b) => compareTasks(a, b, sortKey, sortDir))
    return filtered
  }, [tasks, searchQuery, sortKey, sortDir])

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"))
      } else {
        setSortKey(key)
        setSortDir("asc")
      }
    },
    [sortKey],
  )

  const visibleWindow = useMemo(
    () => getVisibleWindow(scale, viewDate),
    [scale, viewDate],
  )
  const periodDates = useMemo(() => windowDates(visibleWindow), [visibleWindow])

  const periodTitle = useMemo(() => {
    if (scale === "day") return formatDayLabel(visibleWindow.start)
    if (scale === "week") return formatWeekLabel(visibleWindow.start)
    return formatMonthLabel(visibleWindow.start)
  }, [scale, visibleWindow.start])

  const allGanttTasks = useMemo(() => toGanttTasks(preparedTasks), [preparedTasks])

  const visibleGanttTasks = useMemo(() => {
    const overlapping = allGanttTasks.filter((task) =>
      overlapsWindow(task, visibleWindow),
    )
    return overlapping.map((task) => clampToWindow(task, visibleWindow))
  }, [allGanttTasks, visibleWindow])

  const chartTasks = useMemo(
    () => withDisplayOrder(visibleGanttTasks),
    [visibleGanttTasks],
  )

  const preSteps = useMemo(
    () => preStepsForWindow(visibleGanttTasks, visibleWindow.start),
    [visibleGanttTasks, visibleWindow.start],
  )

  const chartKey = `${scale}-${visibleWindow.start.toISOString()}-${listWidthForShell}-${listLayout.showAssignee}-${listLayout.showPriority}-${listLayout.showDates}-${searchQuery}-${sortKey}-${sortDir}`

  const listMinWidth = useMemo(() => {
    const assignee = showAssigneeCol ? ASSIGNEE_COL : 0
    const priority = showPriorityCol
      ? scale === "month"
        ? PRIORITY_COL_COMPACT
        : PRIORITY_COL
      : 0
    const dates = showDatesCol ? DATES_COL : 0
    return Math.max(LIST_MIN, 96 + assignee + priority + dates)
  }, [showAssigneeCol, showPriorityCol, showDatesCol, scale])

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (listCollapsed) return
      event.preventDefault()
      resizeDrag.current = { startX: event.clientX, startWidth: listWidth }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [listCollapsed, listWidth],
  )

  const onResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!resizeDrag.current) return
      const delta = event.clientX - resizeDrag.current.startX
      setListWidth(
        Math.min(
          LIST_MAX,
          Math.max(listMinWidth, resizeDrag.current.startWidth + delta),
        ),
      )
    },
    [listMinWidth],
  )

  const onResizePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!resizeDrag.current) return
      resizeDrag.current = null
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        /* already released */
      }
    },
    [],
  )

  const TaskListHeader = useMemo(
    () =>
      function TaskListHeaderInner({
        headerHeight,
        fontFamily,
        fontSize,
      }: {
        headerHeight: number
        rowWidth: string
        fontFamily: string
        fontSize: string
      }) {
        const cols: { key: SortKey; label: string; width: number }[] = [
          { key: "title", label: "Задача", width: listLayout.title },
        ]
        if (listLayout.showAssignee) {
          cols.push({
            key: "assignee",
            label: "Исполнитель",
            width: listLayout.assignee,
          })
        }
        if (listLayout.showPriority) {
          cols.push({
            key: "priority",
            label: listLayout.priorityCompact ? "" : "Приоритет",
            width: listLayout.priority,
          })
        }
        if (listLayout.showDates) {
          cols.push({ key: "dates", label: "Сроки", width: listLayout.dates })
        }

        return (
          <div
            className="_3_ygE flex overflow-hidden bg-background"
            style={{
              fontFamily,
              fontSize,
              height: headerHeight,
              width: listLayout.total,
            }}
          >
            <div
              className="flex w-full shrink-0 border-b border-border"
              style={{ height: HEADER_ROW_H }}
            >
              {cols.map((col) => {
                const active = sortKey === col.key
                const Icon = !active
                  ? ArrowUpDown
                  : sortDir === "asc"
                    ? ArrowUp
                    : ArrowDown
                const compactPriority =
                  col.key === "priority" && listLayout.priorityCompact
                return (
                  <button
                    key={col.key}
                    type="button"
                    className={cn(
                      "box-border flex shrink-0 items-center gap-1 overflow-hidden px-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                      col.key === "dates" && "is-dates-col",
                      compactPriority && "justify-center px-0",
                      active && "text-foreground",
                    )}
                    style={{
                      width: col.width,
                      minWidth: col.width,
                      maxWidth: col.width,
                    }}
                    onClick={() => toggleSort(col.key)}
                    aria-label={`Сортировать по «${col.label || "Приоритет"}»`}
                    title={compactPriority ? "Приоритет" : undefined}
                  >
                    {col.label ? (
                      <span className="min-w-0 truncate">{col.label}</span>
                    ) : null}
                    <Icon className="size-3 shrink-0 opacity-70" aria-hidden />
                  </button>
                )
              })}
            </div>
          </div>
        )
      },
    [listLayout, sortKey, sortDir, toggleSort],
  )

  const TaskListTable = useMemo(
    () =>
      function TaskListTableInner({
        rowHeight,
        tasks: rowTasks,
        fontFamily,
        fontSize,
        onExpanderClick,
      }: {
        rowHeight: number
        rowWidth: string
        fontFamily: string
        fontSize: string
        locale: string
        tasks: GanttTask[]
        selectedTaskId: string
        setSelectedTask: (taskId: string) => void
        onExpanderClick: (task: GanttTask) => void
      }) {
        return (
          <div className="_3ZbQT" style={{ fontFamily, fontSize }}>
            {rowTasks.map((task) => {
              let expanderSymbol = ""
              if (task.hideChildren === false) expanderSymbol = "▼"
              else if (task.hideChildren === true) expanderSymbol = "▶"
              const source = tasksById.get(task.id)
              const original = allGanttTasks.find((t) => t.id === task.id)
              const title = source?.title ?? task.name
              const range = formatCompactRange(
                original?.start ?? task.start,
                original?.end ?? task.end,
              )

              return (
                <div
                  key={`${task.id}row`}
                  className="_34SS0"
                  style={{ height: rowHeight }}
                >
                  <div
                    className="_3lLk3"
                    style={{
                      minWidth: listLayout.title,
                      maxWidth: listLayout.title,
                      height: rowHeight,
                    }}
                    title={title}
                  >
                    <div className="nI1Xw min-w-0 items-center gap-1">
                      <div
                        className={expanderSymbol ? "_2QjE6" : "_2TfEi"}
                        onClick={() => onExpanderClick(task)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            onExpanderClick(task)
                          }
                        }}
                        role="button"
                        tabIndex={expanderSymbol ? 0 : -1}
                      >
                        {expanderSymbol}
                      </div>
                      <div className="min-w-0 flex-1 truncate text-[13px] leading-tight">
                        {title}
                      </div>
                    </div>
                  </div>
                  {listLayout.showAssignee ? (
                    <div
                      className="_3lLk3 flex items-center px-1"
                      style={{
                        minWidth: listLayout.assignee,
                        maxWidth: listLayout.assignee,
                        height: rowHeight,
                      }}
                    >
                      <AssigneeName name={source?.assignee} />
                    </div>
                  ) : null}
                  {listLayout.showPriority ? (
                    <div
                      className={cn(
                        "_3lLk3 flex items-center",
                        listLayout.priorityCompact
                          ? "justify-center px-0"
                          : "px-1",
                      )}
                      style={{
                        minWidth: listLayout.priority,
                        maxWidth: listLayout.priority,
                        height: rowHeight,
                      }}
                    >
                      <PriorityCell
                        priority={source?.priority}
                        compact={listLayout.priorityCompact}
                      />
                    </div>
                  ) : null}
                  {listLayout.showDates ? (
                    <div
                      className="_3lLk3 is-dates-col flex items-center tabular-nums text-[11px] text-muted-foreground"
                      style={{
                        minWidth: listLayout.dates,
                        maxWidth: listLayout.dates,
                        height: rowHeight,
                      }}
                      title={range}
                    >
                      <span className="block min-w-0 truncate whitespace-nowrap px-0.5">
                        {range}
                      </span>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )
      },
    [tasksById, allGanttTasks, listLayout],
  )

  const changeScale = (next: ChartScale) => {
    if (next === scale) return
    setIsReady(false)
    setScale(next)
    setListWidth(LIST_DEFAULT[next])
  }

  const shiftView = (direction: -1 | 0 | 1) => {
    setIsReady(false)
    if (direction === 0) {
      setViewDate(startOfDay(new Date()))
      return
    }
    setViewDate((prev) => {
      if (scale === "day") return addDays(prev, direction)
      if (scale === "week") return addDays(prev, direction * 7)
      return addMonths(prev, direction)
    })
  }

  useEffect(() => {
    if (!columnsMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const root = columnsMenuRef.current
      if (!root || !(event.target instanceof Node)) return
      if (!root.contains(event.target)) setColumnsMenuOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [columnsMenuOpen])

  // Recompute metrics and settle the upcoming frame (hidden until ready).
  useLayoutEffect(() => {
    const shell = shellRef.current
    const viewport = viewportRef.current
    if (!shell || !viewport) return

    setIsReady(false)

    const next = computeMetrics(
      shell,
      visibleWindow.columns,
      effectiveAllowScroll,
      listWidthForShell,
      visibleGanttTasks.length,
      viewport.clientHeight,
    )
    setMetrics(next)
    setTimelineLeft(next.vScrollWidth + next.listWidth)

    if (visibleGanttTasks.length === 0) {
      setFrozen(null)
      setIsReady(true)
      return
    }

    let cancelled = false
    let frames = 0

    const settle = () => {
      if (cancelled) return
      frames += 1

      const timeline = shell.querySelector<HTMLElement>("[data-gantt-pending] ._CZjuD")
        ?? shell.querySelector<HTMLElement>("._CZjuD")
      if (timeline) {
        lockTimelinePad(timeline, next.columnWidth)
      }

      if (frames < 3) {
        requestAnimationFrame(settle)
        return
      }

      lockTimelinePad(timeline, next.columnWidth)
      if (!next.needsHorizontalScroll) shell.scrollLeft = 0

      setTimelineLeft(next.vScrollWidth + next.listWidth)
      setFrozen({
        chartKey,
        scale,
        metrics: next,
        timelineLeft: next.vScrollWidth + next.listWidth,
        periodDates,
        tasks: chartTasks,
        preSteps,
        viewStart: visibleWindow.start,
        columns: visibleWindow.columns,
      })
      setIsReady(true)
    }

    // Let React commit the pending (hidden) Gantt with new metrics first.
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(settle)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
  }, [
    scale,
    viewDate,
    visibleGanttTasks,
    chartTasks,
    effectiveAllowScroll,
    visibleWindow.columns,
    visibleWindow.start,
    chartKey,
    periodDates,
    preSteps,
    listWidthForShell,
  ])

  // Keep fitting when the viewport resizes after ready (e.g. chat open/close).
  useLayoutEffect(() => {
    const shell = shellRef.current
    const viewport = viewportRef.current
    if (!shell || !viewport) return

    const observer = new ResizeObserver(() => {
      if (!isReady) return
      const next = computeMetrics(
        shell,
        visibleWindow.columns,
        effectiveAllowScroll,
        listWidthForShell,
        visibleGanttTasks.length,
        viewport.clientHeight,
      )
      setMetrics((prev) => {
        if (
          Math.abs(prev.columnWidth - next.columnWidth) <= 0.01 &&
          prev.baseColWidth === next.baseColWidth &&
          prev.columnRemainder === next.columnRemainder &&
          Math.abs(prev.timelineWidth - next.timelineWidth) <= 1 &&
          Math.abs(prev.listWidth - next.listWidth) <= 1 &&
          Math.abs(prev.ganttHeight - next.ganttHeight) <= 2 &&
          prev.needsHorizontalScroll === next.needsHorizontalScroll &&
          prev.needsVerticalScroll === next.needsVerticalScroll
        ) {
          return prev
        }
        return next
      })
      const timeline = shell.querySelector<HTMLElement>("._CZjuD")
      if (timeline) {
        lockTimelinePad(timeline, next.columnWidth)
        if (!next.needsHorizontalScroll) shell.scrollLeft = 0
        setTimelineLeft(next.vScrollWidth + next.listWidth)
        setFrozen((prev) =>
          prev
            ? {
                ...prev,
                metrics: next,
                timelineLeft: next.vScrollWidth + next.listWidth,
                columns: visibleWindow.columns,
              }
            : prev,
        )
      }
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [isReady, visibleWindow.columns, effectiveAllowScroll, visibleGanttTasks.length, listWidthForShell])

  // Keep library pad day clipped: never let the user scroll timeline into empty cells.
  useLayoutEffect(() => {
    const shell = shellRef.current
    if (!shell || !isReady) return

    const padPx = metrics.columnWidth
    const timelines = shell.querySelectorAll<HTMLElement>("._CZjuD")

    const onScroll = (event: Event) => {
      const target = event.currentTarget as HTMLElement
      lockTimelinePad(target, padPx)
    }

    timelines.forEach((timeline) => {
      lockTimelinePad(timeline, padPx)
      timeline.addEventListener("scroll", onScroll, { passive: true })
    })

    return () => {
      timelines.forEach((timeline) => {
        timeline.removeEventListener("scroll", onScroll)
      })
    }
  }, [isReady, metrics.columnWidth, chartKey, frozen?.chartKey])

  /**
   * Own wheel handling:
   * - Vertical: gantt-task-react can clamp scrollY to 0 at the bottom; we drive
   *   `_1eT-t` + list/timeline panes ourselves.
   * - Horizontal (Shift+wheel / trackpad deltaX): timeline is overflow:hidden, so
   *   we must scroll the shell when `needsHorizontalScroll` (month + chat).
   */
  useEffect(() => {
    const shell = shellRef.current
    if (!shell || !isReady) return
    if (!metrics.needsVerticalScroll && !metrics.needsHorizontalScroll) return

    const lastTop = new WeakMap<HTMLElement, number>()
    const intendedY = { current: 0 }

    const vScrollEl = () => shell.querySelector<HTMLElement>("._1eT-t")
    const listBodyEl = () =>
      shell.querySelector<HTMLElement>("._3ZbQT")?.parentElement ?? null
    const timelineBodyEl = () =>
      shell.querySelector<HTMLElement>("._CZjuD ._2B2zv") ?? null

    const applyVerticalScroll = (next: number) => {
      const vScroll = vScrollEl()
      if (!vScroll) return
      const max = Math.max(0, vScroll.scrollHeight - vScroll.clientHeight)
      const clamped = Math.min(max, Math.max(0, next))
      intendedY.current = clamped

      if (vScroll.scrollTop !== clamped) vScroll.scrollTop = clamped

      const listBody = listBodyEl()
      const timelineBody = timelineBodyEl()
      if (listBody && listBody.scrollTop !== clamped) listBody.scrollTop = clamped
      if (timelineBody && timelineBody.scrollTop !== clamped) {
        timelineBody.scrollTop = clamped
      }
      lastTop.set(vScroll, clamped)
      if (listBody) lastTop.set(listBody, clamped)
      if (timelineBody) lastTop.set(timelineBody, clamped)
    }

    const applyHorizontalScroll = (delta: number) => {
      const max = Math.max(0, shell.scrollWidth - shell.clientWidth)
      if (max <= 0) return
      const next = Math.min(max, Math.max(0, shell.scrollLeft + delta))
      if (shell.scrollLeft !== next) shell.scrollLeft = next
    }

    const onWheel = (event: WheelEvent) => {
      const wantsHorizontal =
        event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)

      if (wantsHorizontal && metrics.needsHorizontalScroll) {
        event.preventDefault()
        event.stopImmediatePropagation()
        // Windows/Chrome: Shift+wheel reports deltaY; trackpads use deltaX.
        const delta =
          event.shiftKey && Math.abs(event.deltaY) >= Math.abs(event.deltaX)
            ? event.deltaY
            : event.deltaX !== 0
              ? event.deltaX
              : event.deltaY
        applyHorizontalScroll(delta)
        return
      }

      if (!metrics.needsVerticalScroll || wantsHorizontal) return

      event.preventDefault()
      event.stopImmediatePropagation()

      const vScroll = vScrollEl()
      if (!vScroll) return
      applyVerticalScroll(vScroll.scrollTop + event.deltaY)
    }

    const onVScroll = (event: Event) => {
      const el = event.currentTarget as HTMLElement
      const max = Math.max(0, el.scrollHeight - el.clientHeight)
      const prev = lastTop.get(el) ?? intendedY.current
      let top = el.scrollTop
      if (top < 0) top = 0
      if (top > max) top = max

      if (top === 0 && prev > Math.min(max, 80) && prev >= max - 2) {
        applyVerticalScroll(prev)
        return
      }

      intendedY.current = top
      lastTop.set(el, top)
    }

    const onPaneScroll = (event: Event) => {
      const el = event.currentTarget as HTMLElement
      const prev = lastTop.get(el) ?? el.scrollTop
      const top = el.scrollTop

      if (
        top === 0 &&
        (prev > 40 || intendedY.current > 40) &&
        intendedY.current > 0
      ) {
        applyVerticalScroll(intendedY.current)
        return
      }

      lastTop.set(el, top)
    }

    const vScrolls = metrics.needsVerticalScroll
      ? [...shell.querySelectorAll<HTMLElement>("._1eT-t")]
      : []
    const listBody = metrics.needsVerticalScroll ? listBodyEl() : null
    const timelineBody = metrics.needsVerticalScroll ? timelineBodyEl() : null
    intendedY.current = vScrolls[0]?.scrollTop ?? 0

    shell.addEventListener("wheel", onWheel, { passive: false, capture: true })
    vScrolls.forEach((el) => {
      lastTop.set(el, el.scrollTop)
      el.addEventListener("scroll", onVScroll, { passive: true })
    })
    listBody?.addEventListener("scroll", onPaneScroll, { passive: true })
    timelineBody?.addEventListener("scroll", onPaneScroll, { passive: true })
    if (listBody) lastTop.set(listBody, listBody.scrollTop)
    if (timelineBody) lastTop.set(timelineBody, timelineBody.scrollTop)

    return () => {
      shell.removeEventListener("wheel", onWheel, { capture: true })
      vScrolls.forEach((el) => {
        el.removeEventListener("scroll", onVScroll)
      })
      listBody?.removeEventListener("scroll", onPaneScroll)
      timelineBody?.removeEventListener("scroll", onPaneScroll)
    }
  }, [
    isReady,
    metrics.needsVerticalScroll,
    metrics.needsHorizontalScroll,
    metrics.ganttHeight,
    chartKey,
    visibleGanttTasks.length,
  ])

  // Space-aware fixed tooltip: measure after commit, flip when edges are tight.
  useLayoutEffect(() => {
    const el = tipRef.current
    if (!hoverTip || !el) return
    const { left, top } = fitHoverTip(
      hoverTip.clientX,
      hoverTip.clientY,
      el.offsetWidth,
      el.offsetHeight,
    )
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [hoverTip])

  // Fixed cursor tooltip — library tip is scroll-linked and jitters with pad lock / wheel.
  useEffect(() => {
    const shell = shellRef.current
    if (!shell || !isReady) return

    const tasksByTitle = new Map(tasks.map((task) => [task.title, task]))
    const pointer = { x: 0, y: 0, inside: false }

    const dismiss = () => setHoverTip(null)

    const tipFromPriority = (
      el: Element,
      clientX: number,
      clientY: number,
    ) => {
      const label = el.getAttribute("data-gantt-priority-tip")?.trim()
      if (!label) {
        dismiss()
        return
      }
      setHoverTip({ clientX, clientY, title: label, lines: [] })
    }

    const tipFromBar = (bar: Element, clientX: number, clientY: number) => {
      const label = bar.parentElement?.querySelector("text")?.textContent?.trim()
      if (!label) {
        dismiss()
        return
      }
      const task = tasksByTitle.get(label)
      const lines: string[] = []
      if (task?.assignee?.trim()) lines.push(task.assignee)
      if (task) {
        const start = parseISO(task.start_date)
        const end = addDays(start, Math.max(task.duration, 1))
        lines.push(`${formatCompactRange(start, end)} · ${task.duration} дн.`)
        if (task.priority) lines.push(`Приоритет: ${task.priority}`)
        if (task.predecessors?.trim()) {
          lines.push(`Зависимости: ${task.predecessors}`)
        }
      }
      setHoverTip({ clientX, clientY, title: label, lines })
    }

    const tipFromPoint = (target: Element, clientX: number, clientY: number) => {
      const priority = target.closest("[data-gantt-priority-tip]")
      if (priority && shell.contains(priority)) {
        tipFromPriority(priority, clientX, clientY)
        return
      }
      const bar = target.closest("._KxSXS")
      if (bar && shell.contains(bar)) {
        tipFromBar(bar, clientX, clientY)
        return
      }
      dismiss()
    }

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.inside = true
      const target = event.target
      if (!(target instanceof Element)) {
        dismiss()
        return
      }
      tipFromPoint(target, event.clientX, event.clientY)
    }

    const refreshAfterScroll = () => {
      requestAnimationFrame(() => {
        if (!pointer.inside) return
        const el = document.elementFromPoint(pointer.x, pointer.y)
        if (!(el instanceof Element) || !shell.contains(el)) {
          dismiss()
          return
        }
        tipFromPoint(el, pointer.x, pointer.y)
      })
    }

    const onPointerLeave = () => {
      pointer.inside = false
      dismiss()
    }

    shell.addEventListener("pointermove", onPointerMove)
    shell.addEventListener("pointerleave", onPointerLeave)
    shell.addEventListener("wheel", refreshAfterScroll, { passive: true })
    shell.addEventListener("scroll", refreshAfterScroll, { passive: true })

    return () => {
      shell.removeEventListener("pointermove", onPointerMove)
      shell.removeEventListener("pointerleave", onPointerLeave)
      shell.removeEventListener("wheel", refreshAfterScroll)
      shell.removeEventListener("scroll", refreshAfterScroll)
      dismiss()
    }
  }, [isReady, tasks, chartKey])

  if (allGanttTasks.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        Загрузите Excel-файл, чтобы построить диаграмму Ганта
      </div>
    )
  }

  const columnsForShell = isReady
    ? visibleWindow.columns
    : (frozen?.columns ?? visibleWindow.columns)
  const metricsForShell = isReady ? metrics : (frozen?.metrics ?? metrics)
  const needsScroll = metricsForShell.needsHorizontalScroll
  const listWidthRendered = listCollapsed ? 0 : metricsForShell.listWidth
  const listLeftRendered = metricsForShell.vScrollWidth + listWidthRendered

  const renderFrame = (
    frame: {
      chartKey: string
      scale: ChartScale
      metrics: ChartMetrics
      timelineLeft: number
      periodDates: Date[]
      tasks: GanttTask[]
      preSteps: number
      viewStart: Date
    },
    opts: { pending?: boolean; visible: boolean },
  ) => {
    const ganttTasks =
      selectedTaskId === null
        ? withoutSelectedBarStyles(frame.tasks)
        : frame.tasks

    return (
    <div
      data-gantt-pending={opts.pending ? "true" : undefined}
      className={cn(
        "relative min-h-0 flex-1",
        opts.pending && "pointer-events-none absolute inset-0",
      )}
      style={{ visibility: opts.visible ? "visible" : "hidden" }}
      aria-hidden={!opts.visible}
    >
      {frame.tasks.length === 0 ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
          Нет задач в выбранном периоде
        </div>
      ) : (
        <>
          <PeriodHeader
            left={frame.timelineLeft}
            timelineWidth={frame.metrics.timelineWidth}
            baseColWidth={frame.metrics.baseColWidth}
            columnRemainder={frame.metrics.columnRemainder}
            dates={frame.periodDates}
            scale={frame.scale}
          />
          <PeriodBodyGrid
            left={frame.timelineLeft}
            timelineWidth={frame.metrics.timelineWidth}
            height={frame.metrics.ganttHeight}
            columns={frame.periodDates.length}
            baseColWidth={frame.metrics.baseColWidth}
            columnRemainder={frame.metrics.columnRemainder}
          />
          <Gantt
            key={frame.chartKey}
            tasks={ganttTasks}
            viewMode={ViewMode.Day}
            viewDate={frame.viewStart}
            locale="ru"
            preStepsCount={frame.preSteps}
            listCellWidth={listCollapsed ? "" : `${Math.round(listLayout.total / 3)}px`}
            headerHeight={CALENDAR_HEADER_H}
            rowHeight={ROW_HEIGHT}
            columnWidth={frame.metrics.columnWidth}
            ganttHeight={frame.metrics.ganttHeight}
            barCornerRadius={4}
            barFill={70}
            fontFamily="inherit"
            fontSize="13px"
            TaskListHeader={TaskListHeader}
            TaskListTable={TaskListTable}
            TooltipContent={EmptyGanttTooltip}
            onClick={(task: GanttTask) => {
              const id = Number(task.id)
              if (Number.isNaN(id)) return
              globalThis.setTimeout(() => setSelectedTaskId(id), 0)
            }}
          />
        </>
      )}
    </div>
    )
  }

  const pendingFrame = {
    chartKey,
    scale,
    metrics,
    timelineLeft,
    periodDates,
    tasks: chartTasks,
    preSteps,
    viewStart: visibleWindow.start,
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-0.5", className)}>
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {SCALE_OPTIONS.map(({ scale: option, label }) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={scale === option ? "default" : "outline"}
              onClick={() => changeScale(option)}
            >
              {label}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={listCollapsed ? "Показать таблицу" : "Скрыть таблицу"}
            onClick={() => setListCollapsed((v) => !v)}
          >
            {listCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
          <div ref={columnsMenuRef} className="relative">
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Колонки таблицы"
              aria-expanded={columnsMenuOpen}
              onClick={() => setColumnsMenuOpen((v) => !v)}
            >
              <Columns3 />
            </Button>
            {columnsMenuOpen ? (
              <div className="absolute left-0 top-full z-40 mt-1 w-52 rounded-md border border-border bg-background p-2 text-sm shadow-md">
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={showAssigneeCol}
                    onChange={(e) => setShowAssigneeCol(e.target.checked)}
                  />
                  Исполнители
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={showPriorityCol}
                    onChange={(e) => setShowPriorityCol(e.target.checked)}
                  />
                  Приоритет
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={showDatesCol}
                    onChange={(e) => setShowDatesCol(e.target.checked)}
                  />
                  Сроки
                </label>
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Создать задачу"
            title="Создать задачу"
            onClick={() => openCreateTask()}
          >
            <Plus data-icon="inline-start" />
            Создать
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!listCollapsed ? (
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск…"
              aria-label="Поиск по задачам"
              className="h-8 shrink-0"
              style={{ width: listLayout.title, maxWidth: "100%" }}
            />
          ) : null}
          <span className="text-sm text-muted-foreground">{periodTitle}</span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Назад"
              onClick={() => shiftView(-1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => shiftView(0)}
            >
              Сегодня
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Вперёд"
              onClick={() => shiftView(1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>

      <div ref={viewportRef} className="min-h-0 w-full max-w-full flex-1">
        <div
          ref={shellRef}
          className={cn(
            "gantt-shell is-fixed-window box-border w-full max-w-full overflow-hidden rounded-lg border border-border bg-background",
            needsScroll && "is-h-scroll",
            metricsForShell.needsVerticalScroll && "is-v-scroll",
            listCollapsed && "is-list-collapsed",
          )}
          style={
            {
              height:
                CALENDAR_HEADER_H +
                metricsForShell.ganttHeight +
                SHELL_BORDER_Y,
              maxHeight: "100%",
              "--gantt-col-width": `${metricsForShell.columnWidth}px`,
              "--gantt-cols": columnsForShell,
              "--gantt-timeline-width": `${metricsForShell.timelineWidth}px`,
              "--gantt-list-width": `${listWidthRendered}px`,
              "--gantt-v-scroll-width": `${metricsForShell.vScrollWidth}px`,
              "--gantt-body-height": `${metricsForShell.ganttHeight}px`,
              "--gantt-header-height": `${CALENDAR_HEADER_H}px`,
              "--gantt-tasks-height": `${Math.max(ROW_HEIGHT, (isReady ? visibleGanttTasks.length : (frozen?.tasks.length ?? 0)) * ROW_HEIGHT)}px`,
            } as CSSProperties
          }
        >
          <div
            className={cn(
              "relative box-border flex h-full min-h-0 flex-col",
              needsScroll
                ? "w-max min-w-full"
                : "w-full max-w-full overflow-hidden",
            )}
          >
            {/* Keep previous ready frame visible while the next paints. */}
            {!isReady && frozen
              ? renderFrame(frozen, { visible: true })
              : null}

            {/* Upcoming / current frame: hidden until settled, then shown. */}
            {renderFrame(pendingFrame, {
              pending: !isReady && frozen !== null,
              visible: isReady,
            })}

            {!listCollapsed ? (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Ширина таблицы задач"
                className="absolute z-30 cursor-col-resize touch-none"
                style={{
                  left: Math.max(0, listLeftRendered - SPLITTER_W),
                  top: 0,
                  width: SPLITTER_W + 4,
                  height: CALENDAR_HEADER_H + metricsForShell.ganttHeight,
                  marginLeft: -2,
                }}
                onPointerDown={onResizePointerDown}
                onPointerMove={onResizePointerMove}
                onPointerUp={onResizePointerUp}
                onPointerCancel={onResizePointerUp}
              >
                <div
                  className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border"
                  aria-hidden
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {hoverTip ? (
        <div
          ref={tipRef}
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-sm rounded-md border border-border bg-background px-3 py-2 text-xs shadow-md"
          style={{
            left: hoverTip.clientX + TIP_GAP,
            top: hoverTip.clientY + TIP_GAP,
          }}
        >
          <div className="font-medium leading-snug text-foreground">
            {hoverTip.title}
          </div>
          {hoverTip.lines.map((line) => (
            <div key={line} className="mt-0.5 text-muted-foreground">
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
