"use client"

import { useFormState, useFormStatus } from "react-dom"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { CheckCircle2, Loader2, Lock, HelpCircle, Plus } from "lucide-react"
import { guideHref } from "@/lib/guide-anchors"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  createTarget,
  archiveTarget,
  setTargetGoal,
  type ActionResult,
} from "./actions"
import { GoalSelect } from "./goal-select"
import type { TargetWithStats } from "@/lib/targets-data"
import type { TierConfig } from "@/lib/tier-limits"

type PickedGoal = { id: string; name: string; type: string } | null

type Props = {
  siteId: string
  metrikaConfigured: boolean
  tier: TierConfig
  activeTargets: TargetWithStats[]
  archivedTargets: TargetWithStats[]
  sessionsAllocated: number
  sessionsRemaining: number
  targetsRemaining: number
  // Из env MIN_SESSIONS_BUDGET (server-only, читается в page.tsx).
  // Управляет и minимумом бюджета при создании цели, и порогом
  // "готова к анализу" в подписи кнопки.
  minSessionsBudget: number
}

const initialState: ActionResult | null = null

function CreateButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Добавление..." : "Добавить страницу"}
    </Button>
  )
}

// Кнопка submit'а внутри archive-формы. ОБЯЗАТЕЛЬНО рендерится ВНУТРИ
// <form>, чтобы useFormStatus подхватил статус именно этой формы, а не
// родительской CREATE-формы.
function ArchiveSubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant="destructive"
      size="sm"
      disabled={pending}
    >
      {pending ? "..." : "Точно? Архивировать"}
    </Button>
  )
}

// Завершённая = полный бюджет И есть анализ. Такая страница замерла навсегда:
// бюджет не растёт, оба гейта (should-record + атомарный инкремент) закрывают
// приём новых сессий. Проанализированная, но НЕ добитая до бюджета — ещё
// собирает (Модель B), поэтому остаётся в «Активных».
function isCompleted(t: TargetWithStats): boolean {
  return t.analyzed && t.sessionsCollected >= t.sessionsBudget
}

type TabKey = "active" | "completed" | "archived"

export function TargetsClient(props: Props) {
  const [createState, createAction] = useFormState(createTarget, initialState)
  const [createGoal, setCreateGoal] = useState<PickedGoal>(null)
  // Контролируем url — нужен для url-бейджа и релевантности в GoalSelect.
  const [createUrl, setCreateUrl] = useState("")
  const canCreate =
    props.targetsRemaining > 0 &&
    props.sessionsRemaining >= props.minSessionsBudget

  // Разбиваем НЕархивные на «собирает/готова к анализу» и «завершена».
  // Тарифная математика (targetsRemaining/sessionsAllocated) считается по
  // ВСЕМ неархивным в targets-data — завершённые тоже занимают ячейку лимита
  // (см. TODO про монетизацию), поэтому здесь только раскладываем по вкладкам.
  const completedTargets = props.activeTargets.filter(isCompleted)
  const collectingTargets = props.activeTargets.filter((t) => !isCompleted(t))

  // Ноль неархивных страниц → форма раскрыта сразу (первый заход).
  const [showForm, setShowForm] = useState(props.activeTargets.length === 0)
  const [activeTab, setActiveTab] = useState<TabKey>("active")

  function openForm() {
    setShowForm(true)
    // Дать форме отрендериться, затем прокрутить к ней.
    setTimeout(() => {
      document
        .getElementById("add-page-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 50)
  }

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "active", label: "Активные", count: collectingTargets.length },
    { key: "completed", label: "Завершённые", count: completedTargets.length },
    { key: "archived", label: "Архив", count: props.archivedTargets.length },
  ]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Тариф: {props.tier.name}</CardTitle>
          <CardDescription>
            Страниц: {props.activeTargets.length} / {props.tier.targetsLimit}
            {" • "}
            Сессий аллоцировано: {props.sessionsAllocated} /{" "}
            {props.tier.sessionsLimit}
            {" "}
            (свободно: {props.sessionsRemaining})
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="flex justify-end">
        <Button
          type="button"
          variant={showForm ? "outline" : "default"}
          onClick={() => (showForm ? setShowForm(false) : openForm())}
        >
          {showForm ? (
            "Скрыть форму"
          ) : (
            <>
              <Plus className="mr-1.5 h-4 w-4" />
              Добавить страницу
            </>
          )}
        </Button>
      </div>

      {showForm && (
      <Card id="add-page-form">
        <CardHeader>
          <CardTitle>Добавить страницу</CardTitle>
          <CardDescription>
            Укажите URL страницы вашего сайта — по ней Вебмонитор соберёт
            сессии и запустит AI-анализ.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!canCreate && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {props.targetsRemaining <= 0
                ? "Достигнут лимит страниц вашего тарифа. Архивируйте неиспользуемые."
                : `Недостаточно свободных сессий (нужно минимум ${props.minSessionsBudget}).`}
            </div>
          )}
          <form action={createAction} className="space-y-4">
            <input type="hidden" name="siteId" value={props.siteId} />

            <div className="space-y-2">
              <Label htmlFor="url">URL страницы</Label>
              <Input
                id="url"
                name="url"
                type="url"
                placeholder="https://site.ru/pricing"
                value={createUrl}
                onChange={(e) => setCreateUrl(e.target.value)}
                required
                disabled={!canCreate}
              />
              <p className="text-xs text-muted-foreground">
                Полный URL включая https:// и путь. Параметры query
                (?ref=...) игнорируются при сопоставлении сессий.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Название (необязательно)</Label>
              <Input
                id="name"
                name="name"
                type="text"
                placeholder="Страница цен"
                maxLength={100}
                disabled={!canCreate}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sessionsBudget">Бюджет сессий</Label>
              <Input
                id="sessionsBudget"
                name="sessionsBudget"
                type="number"
                min={props.minSessionsBudget}
                max={props.sessionsRemaining}
                step={1}
                defaultValue={props.minSessionsBudget}
                required
                disabled={!canCreate}
              />
              <p className="text-xs text-muted-foreground">
                Сколько сессий собрать перед AI-анализом. Минимум{" "}
                {props.minSessionsBudget}. Доступно: {props.sessionsRemaining}.
              </p>
            </div>

            {/* Целевое действие (опционально). Метрика считает конверсию по
                нему; без действия — обычный поведенческий анализ. */}
            <div className="space-y-2">
              <Label>Целевое действие (необязательно)</Label>
              <input type="hidden" name="goalId" value={createGoal?.id ?? ""} />
              {props.metrikaConfigured ? (
                <GoalSelect
                  siteId={props.siteId}
                  currentGoalId={createGoal?.id ?? null}
                  currentGoalName={createGoal?.name ?? null}
                  currentGoalType={createGoal?.type ?? null}
                  pageUrl={createUrl}
                  disabled={!canCreate}
                  onPick={setCreateGoal}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Чтобы измерять конверсию по целевому действию,{" "}
                  <Link
                    href="/dashboard/settings/metrika"
                    className="font-medium underline underline-offset-2"
                  >
                    подключите Яндекс.Метрику
                  </Link>
                  . Без неё страница анализируется по поведению.
                </p>
              )}
              {!props.metrikaConfigured && (
                <Link
                  href={guideHref("token")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <HelpCircle className="h-3.5 w-3.5 shrink-0" />
                  Как подключить и получить токен — гайд
                </Link>
              )}
              <p className="text-xs text-muted-foreground">
                Метрика посчитает, какой процент посетителей доходит до этого
                действия. Можно задать позже.
              </p>
            </div>

            {createState?.ok === false && createState.error && (
              <p className="text-sm text-destructive">{createState.error}</p>
            )}
            {createState?.ok === true && createState.message && (
              <p className="text-sm text-green-600">{createState.message}</p>
            )}

            <CreateButton />
          </form>
        </CardContent>
      </Card>
      )}

      {/* Вкладки со счётчиками. Активные = собирает/готова к анализу;
          Завершённые = полный бюджет И проанализирована (статична);
          Архив = убранные пользователем. */}
      <div className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}{" "}
            <span
              className={cn(
                "ml-1 rounded-full px-1.5 py-0.5 text-xs",
                activeTab === tab.key
                  ? "bg-primary/10 text-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {activeTab === "active" &&
        (collectingTargets.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card p-8 text-center">
            <p className="mb-1 font-medium">Нет активных страниц</p>
            <p className="mx-auto mb-4 max-w-md text-sm text-muted-foreground">
              Активные страницы собирают сессии и готовятся к AI-анализу.
              {completedTargets.length > 0 &&
                " Завершённые — на соседней вкладке."}{" "}
              Добавьте страницу, чтобы начать сбор.
            </p>
            <Button type="button" onClick={openForm}>
              <Plus className="mr-1.5 h-4 w-4" />
              Добавить страницу
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {collectingTargets.map((t) => (
              <TargetCard
                key={t.id}
                target={t}
                siteId={props.siteId}
                metrikaConfigured={props.metrikaConfigured}
                minSessionsBudget={props.minSessionsBudget}
              />
            ))}
          </div>
        ))}

      {activeTab === "completed" &&
        (completedTargets.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Пока нет завершённых страниц. Страница попадёт сюда, когда соберёт
            полный бюджет сессий и пройдёт AI-анализ.
          </p>
        ) : (
          <div className="space-y-3">
            {completedTargets.map((t) => (
              <TargetCard
                key={t.id}
                target={t}
                siteId={props.siteId}
                metrikaConfigured={props.metrikaConfigured}
                minSessionsBudget={props.minSessionsBudget}
              />
            ))}
          </div>
        ))}

      {activeTab === "archived" &&
        (props.archivedTargets.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Архив пуст.
          </p>
        ) : (
          <div className="space-y-3">
            {props.archivedTargets.map((t) => (
              <TargetCard
                key={t.id}
                target={t}
                archived
                siteId={props.siteId}
                metrikaConfigured={props.metrikaConfigured}
                minSessionsBudget={props.minSessionsBudget}
              />
            ))}
          </div>
        ))}
    </div>
  )
}

function pluralSession(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return "сессия"
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return "сессии"
  return "сессий"
}

// Состояние страницы одной строкой (без тройного дубля статус•N/N•%). Полоса
// = это и есть процент; отдельного числа % нет. При достигнутом бюджете и у
// проанализированной прогресс не показываем. Сигналы: analyzed (факт анализа,
// не status — COMPLETED в бою не выставляется), collected/budget, минимум для
// запуска (Модель B: collected>=5 → «можно запускать» не дожидаясь бюджета).
function TargetStatus({
  target,
  archived,
  minSessions,
}: {
  target: TargetWithStats
  archived: boolean
  minSessions: number
}) {
  const c = target.sessionsCollected
  const b = target.sessionsBudget

  if (archived) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        В архиве · собрано {c} {pluralSession(c)}
      </p>
    )
  }
  if (target.status === "ANALYZING") {
    return <p className="mt-1 text-xs text-muted-foreground">Идёт анализ…</p>
  }
  if (target.analyzed) {
    // Проанализирована И ещё не добита до бюджета → цель осталась ACTIVE и
    // ПРОДОЛЖАЕТ собирать (Модель B: анализ прошёл на частичном бюджете).
    // Показываем это явно + прогресс. На ПОЛНОМ бюджете страница замерла
    // навсегда (оба гейта закрыты) — badge «собирает» не показываем, она в
    // «Завершённых» и статична.
    if (c < b) {
      const pct = b > 0 ? Math.min(100, Math.round((c / b) * 100)) : 0
      return (
        <div className="mt-1 space-y-1">
          <p className="text-xs text-green-700">
            Проанализирована · собирает новые сессии
          </p>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-muted-foreground">
              {c} / {b}
            </span>
          </div>
        </div>
      )
    }
    return (
      <p className="mt-1 text-xs text-green-700">
        Проанализирована · сбор завершён
      </p>
    )
  }
  // Не анализировалась. Бюджет достигнут → без полосы и %.
  if (c >= b) {
    return (
      <p className="mt-1 text-xs text-amber-700">
        Сбор завершён — можно запускать · {c} {pluralSession(c)}
      </p>
    )
  }
  // Копит: полоса + «N / бюджет», без отдельного %.
  const canRun = c >= minSessions
  const pct = b > 0 ? Math.min(100, Math.round((c / b) * 100)) : 0
  return (
    <div className="mt-1 space-y-1">
      <p
        className={`text-xs ${canRun ? "text-amber-700" : "text-muted-foreground"}`}
      >
        {canRun ? "Можно запускать" : "Собираем сессии"}
      </p>
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-muted-foreground">
          {c} / {b}
        </span>
      </div>
    </div>
  )
}

// Клиентский таймаут запроса анализа. Норма ~55с; берём 150с — покрывает
// разброс, но ниже Gateway 300с (быстрее его 504). При аборте НЕ говорим
// «провал»: сервер мог довести анализ (свои гарды), результат появится в
// /recommendations — сообщение «идёт дольше, проверьте позже».
const ANALYZE_TIMEOUT_MS = 150_000

// Ретраибельные (временные) ошибки — показываем «Повторить». Остальные
// (no_interactions, not_enough_sessions, monthly_limit, provider_denied)
// не ретраить — нужны действия/время.
const RETRIABLE_ERRORS = new Set([
  "relay_unavailable",
  "claude_retriable",
  "claude_invalid",
  "collect_timeout",
  "race_condition",
  "internal",
])

function pluralRec(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return "рекомендация"
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return "рекомендации"
  return "рекомендаций"
}

// Инлайн-итог запуска (ЗАХОД 1, без модалки). null = ничего не показано.
type AnalyzeNotice =
  | { kind: "success"; recommendationsCount: number }
  | { kind: "timeout" }
  | { kind: "error"; message: string; retriable: boolean }

function TargetCard({
  target,
  archived = false,
  siteId,
  metrikaConfigured,
  minSessionsBudget,
}: {
  target: TargetWithStats
  archived?: boolean
  siteId: string
  metrikaConfigured: boolean
  minSessionsBudget: number
}) {
  const [archiveState, archiveAction] = useFormState(
    archiveTarget,
    initialState,
  )
  const [confirmMode, setConfirmMode] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [notice, setNotice] = useState<AnalyzeNotice | null>(null)
  const [goalPending, startGoalTransition] = useTransition()
  const [goalError, setGoalError] = useState<string | null>(null)
  const router = useRouter()

  function handleGoalPick(goal: PickedGoal) {
    setGoalError(null)
    startGoalTransition(async () => {
      const r = await setTargetGoal(target.id, goal?.id ?? "")
      if (r.ok) {
        router.refresh()
      } else {
        setGoalError(r.error ?? "Не удалось сохранить действие")
      }
    })
  }

  async function handleAnalyze() {
    setAnalyzing(true)
    setNotice(null)
    // Таймаут: не вечный спиннер. abort() → catch AbortError → «идёт дольше».
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS)
    try {
      const res = await fetch("/api/analysis/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: target.id }),
        // Same-origin → куки и так шлются (default), указываем явно.
        credentials: "same-origin",
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      const data = (await res.json().catch(() => ({}))) as {
        message?: string
        error?: string
        recommendationsCount?: number
      }
      setAnalyzing(false)
      if (!res.ok) {
        setNotice({
          kind: "error",
          message:
            data.message ??
            `Ошибка сервера (${res.status}). Попробуйте ещё раз.`,
          retriable: data.error
            ? RETRIABLE_ERRORS.has(data.error)
            : res.status >= 500,
        })
        return
      }
      // Успех: показываем итог + обновляем карточку (Модель B: цель
      // вернулась в сбор). await refresh — прогресс/статус перечитаются;
      // клиентский `notice` при этом сохраняется (тот же инстанс).
      setNotice({
        kind: "success",
        recommendationsCount: data.recommendationsCount ?? 0,
      })
      await router.refresh()
    } catch (err) {
      clearTimeout(timeoutId)
      setAnalyzing(false)
      if (err instanceof DOMException && err.name === "AbortError") {
        setNotice({ kind: "timeout" })
      } else {
        setNotice({
          kind: "error",
          message: "Ошибка сети. Проверьте соединение и повторите.",
          retriable: true,
        })
      }
    }
  }

  return (
    <Card id={`target-${target.id}`} className={archived ? "opacity-60" : ""}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {target.name && (
              <h4 className="truncate font-medium">{target.name}</h4>
            )}
            <p className="truncate text-sm text-muted-foreground">
              {target.url}
            </p>
            <TargetStatus
              target={target}
              archived={archived}
              minSessions={minSessionsBudget}
            />
          </div>
          {!archived && (
            <div className="flex flex-col items-end gap-2">
              {/* Завершённая (проанализирована + полный бюджет) замерла: новых
                  сессий не будет, повтор дал бы тот же результат и сжёг слот.
                  Поэтому вместо «Запустить анализ» — ссылка на её рекомендации
                  (серверный гейт в /api/analysis/run дублирует запрет). */}
              {isCompleted(target) ? (
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/dashboard/recommendations?targetId=${target.id}`}
                  >
                    Смотреть рекомендации
                  </Link>
                </Button>
              ) : (
                <AnalyzeButton
                  target={target}
                  analyzing={analyzing}
                  onAnalyze={handleAnalyze}
                  minSessionsBudget={minSessionsBudget}
                />
              )}
              <ArchiveControl
                target={target}
                analyzing={analyzing}
                confirmMode={confirmMode}
                setConfirmMode={setConfirmMode}
                archiveAction={archiveAction}
              />
            </div>
          )}
        </div>
        {/* Целевое действие (Path M). Архивные — read-only. Активные:
            GoalSelect для смены, если не зафиксировано (goalLocked). */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">
            Целевое действие:
          </span>
          {archived ? (
            <span className="text-sm">{target.metrikaGoalName ?? "—"}</span>
          ) : target.goalLocked ? (
            <span className="flex items-center gap-1 text-sm">
              <Lock className="h-3 w-3 opacity-60" />
              {target.metrikaGoalName ?? "—"}
              <span className="text-xs text-muted-foreground">
                (зафиксировано после первого анализа)
              </span>
            </span>
          ) : metrikaConfigured ? (
            <span className="flex items-center gap-2">
              <GoalSelect
                siteId={siteId}
                currentGoalId={target.metrikaGoalId}
                currentGoalName={target.metrikaGoalName}
                currentGoalType={target.metrikaGoalType}
                pageUrl={target.url}
                disabled={goalPending}
                onPick={handleGoalPick}
              />
              {goalPending && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              <Link
                href="/dashboard/settings/metrika"
                className="underline underline-offset-2"
              >
                Подключите Метрику
              </Link>
              , чтобы задать ·{" "}
              <Link
                href={guideHref("token")}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                как?
              </Link>
            </span>
          )}
          {goalError && (
            <span className="text-xs text-destructive">{goalError}</span>
          )}
        </div>
        {!archived && analyzing && (
          // Спиннер и «~1 минута» уже на кнопке — тут только уникальное
          // предупреждение (на кнопке места нет), без дубля и второго спиннера.
          <p className="mt-2 text-xs text-muted-foreground">
            Не закрывайте вкладку до завершения.
          </p>
        )}
        {notice?.kind === "timeout" && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
            Анализ идёт дольше обычного. Проверьте{" "}
            <Link
              href={`/dashboard/recommendations?targetId=${target.id}`}
              className="font-medium underline underline-offset-2 hover:no-underline"
            >
              «Рекомендации»
            </Link>{" "}
            через минуту или запустите снова.
          </p>
        )}
        {notice?.kind === "error" && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
            <span>{notice.message}</span>
            {notice.retriable && (
              <button
                type="button"
                onClick={handleAnalyze}
                className="font-medium underline underline-offset-2 hover:no-underline"
              >
                Повторить
              </button>
            )}
          </div>
        )}
        {archiveState?.ok === false && archiveState.error && (
          <p className="mt-2 text-sm text-destructive">{archiveState.error}</p>
        )}
      </CardContent>

      {/* Success — центральный модал (важное событие: акцент + переход к
          результату). Ошибки/timeout/loading остаются инлайн (заход 1). */}
      <Dialog
        open={notice?.kind === "success"}
        onOpenChange={(open) => !open && setNotice(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Анализ завершён
            </DialogTitle>
            <DialogDescription>
              {notice?.kind === "success" && (
                <>
                  Найдено {notice.recommendationsCount}{" "}
                  {pluralRec(notice.recommendationsCount)} по странице «
                  {target.name ?? target.url}».
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotice(null)}>
              Закрыть
            </Button>
            <Link href={`/dashboard/recommendations?targetId=${target.id}`}>
              <Button className="w-full sm:w-auto">
                Перейти к рекомендациям
              </Button>
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function AnalyzeButton({
  target,
  analyzing,
  onAnalyze,
  minSessionsBudget,
}: {
  target: TargetWithStats
  analyzing: boolean
  onAnalyze: () => void
  minSessionsBudget: number
}) {
  // ANALYZING — идёт анализ, запуск заблокирован.
  if (target.status === "ANALYZING") {
    return (
      <Button type="button" size="sm" disabled>
        Анализ идёт…
      </Button>
    )
  }
  // Модель B «полная свобода»: запуск доступен при collected >= минимума
  // (5), независимо от статуса ACTIVE/READY и от budget. budget — только
  // КАП сбора, не гейт запуска. Ниже минимума — кнопка неактивна с честным
  // прогрессом. Сбор продолжается и после запуска (цель возвращается в
  // ACTIVE/READY), повтор возможен — сервер догейтит (top-10 / лимит).
  const canRun = target.sessionsCollected >= minSessionsBudget
  if (!canRun) {
    return (
      <Button type="button" size="sm" disabled>
        {`Накоплено ${target.sessionsCollected}/${target.sessionsBudget} (для запуска нужно ≥${minSessionsBudget})`}
      </Button>
    )
  }
  return (
    <Button type="button" size="sm" disabled={analyzing} onClick={onAnalyze}>
      {analyzing ? (
        <>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          Анализируем… (~1 минута)
        </>
      ) : (
        "Запустить анализ"
      )}
    </Button>
  )
}

function ArchiveControl({
  target,
  analyzing,
  confirmMode,
  setConfirmMode,
  archiveAction,
}: {
  target: TargetWithStats
  analyzing: boolean
  confirmMode: boolean
  setConfirmMode: (v: boolean) => void
  archiveAction: (formData: FormData) => void
}) {
  // Единственный блок — идущий анализ (архивация оборвала бы прогон). Гейт
  // «сначала запустите анализ» СНЯТ: страницу можно убрать, не сжигая анализ.
  // Во время клиентского analyzing причину не показываем (экран занят
  // спиннером); при idle-ANALYZING — «Анализ идёт».
  if (target.status === "ANALYZING" || analyzing) {
    const showReason = target.status === "ANALYZING" && !analyzing
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          title={showReason ? "Анализ идёт" : ""}
        >
          Архивировать
        </Button>
        {showReason && (
          <span className="text-xs text-muted-foreground">Анализ идёт</span>
        )}
      </div>
    )
  }

  // Честное подтверждение: собранные, но НЕ проанализированные сессии пропадут
  // и в лимит не вернутся (архивация возвращает только НЕсобранный остаток).
  const warnUnanalyzed = target.sessionsCollected > 0 && !target.analyzed

  return (
    <form action={archiveAction}>
      <input type="hidden" name="targetId" value={target.id} />
      {!confirmMode ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setConfirmMode(true)
            setTimeout(() => setConfirmMode(false), 6000)
          }}
        >
          Архивировать
        </Button>
      ) : (
        <div className="flex flex-col items-end gap-1">
          {warnUnanalyzed && (
            <span className="max-w-[15rem] text-right text-xs text-muted-foreground">
              Собрано {target.sessionsCollected}{" "}
              {pluralSession(target.sessionsCollected)} — они не будут
              проанализированы и не вернутся в лимит.
            </span>
          )}
          <ArchiveSubmitButton />
        </div>
      )}
    </form>
  )
}
