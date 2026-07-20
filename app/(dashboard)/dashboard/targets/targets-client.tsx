"use client"

import { useFormState, useFormStatus } from "react-dom"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Loader2 } from "lucide-react"
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
  createTarget,
  archiveTarget,
  type ActionResult,
} from "./actions"
import type { TargetWithStats } from "@/lib/targets-data"
import type { TierConfig } from "@/lib/tier-limits"

type Props = {
  siteId: string
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
      {pending ? "Создание..." : "Создать цель"}
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

export function TargetsClient(props: Props) {
  const [createState, createAction] = useFormState(createTarget, initialState)
  const canCreate =
    props.targetsRemaining > 0 &&
    props.sessionsRemaining >= props.minSessionsBudget

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Тариф: {props.tier.name}</CardTitle>
          <CardDescription>
            Целей: {props.activeTargets.length} / {props.tier.targetsLimit}
            {" • "}
            Сессий аллоцировано: {props.sessionsAllocated} /{" "}
            {props.tier.sessionsLimit}
            {" "}
            (свободно: {props.sessionsRemaining})
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Добавить цель</CardTitle>
          <CardDescription>
            Цель — это URL страницы вашего сайта, для которой Вебмонитор
            соберёт сессии и запустит AI-анализ.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!canCreate && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {props.targetsRemaining <= 0
                ? "Достигнут лимит целей вашего тарифа. Архивируйте неиспользуемые."
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

      <div>
        <h3 className="mb-3 text-lg font-semibold">
          Активные цели ({props.activeTargets.length})
        </h3>
        {props.activeTargets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нет активных целей. Добавьте первую через форму выше.
          </p>
        ) : (
          <div className="space-y-3">
            {props.activeTargets.map((t) => (
              <TargetCard
                key={t.id}
                target={t}
                minSessionsBudget={props.minSessionsBudget}
              />
            ))}
          </div>
        )}
      </div>

      {props.archivedTargets.length > 0 && (
        <div>
          <h3 className="mb-3 text-lg font-semibold text-muted-foreground">
            Архивированные ({props.archivedTargets.length})
          </h3>
          <div className="space-y-3">
            {props.archivedTargets.map((t) => (
              <TargetCard
                key={t.id}
                target={t}
                archived
                minSessionsBudget={props.minSessionsBudget}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Сбор сессий",
  READY: "Цель достигнута",
  ANALYZING: "Анализируется",
  COMPLETED: "Анализ завершён",
  ARCHIVED: "Архив",
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
  minSessionsBudget,
}: {
  target: TargetWithStats
  archived?: boolean
  minSessionsBudget: number
}) {
  const [archiveState, archiveAction] = useFormState(
    archiveTarget,
    initialState,
  )
  const [confirmMode, setConfirmMode] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [notice, setNotice] = useState<AnalyzeNotice | null>(null)
  const router = useRouter()

  const progress =
    target.sessionsBudget > 0
      ? Math.min(
          100,
          Math.round((target.sessionsCollected / target.sessionsBudget) * 100),
        )
      : 0

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
    <Card className={archived ? "opacity-60" : ""}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {target.name && (
              <h4 className="truncate font-medium">{target.name}</h4>
            )}
            <p className="truncate text-sm text-muted-foreground">
              {target.url}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {archived ? "Архив" : (STATUS_LABELS[target.status] ?? target.status)}
              {" • "}
              Сессий: {target.sessionsCollected} / {target.sessionsBudget}
              {" • "}
              {progress}%
            </p>
          </div>
          {!archived && (
            <div className="flex flex-col items-end gap-2">
              <AnalyzeButton
                target={target}
                analyzing={analyzing}
                onAnalyze={handleAnalyze}
                minSessionsBudget={minSessionsBudget}
              />
              <ArchiveControl
                target={target}
                confirmMode={confirmMode}
                setConfirmMode={setConfirmMode}
                archiveAction={archiveAction}
              />
            </div>
          )}
        </div>
        {!archived && analyzing && (
          <p className="mt-3 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            Анализируем поведение посетителей… (~1 минута, не закрывайте
            вкладку).
          </p>
        )}
        {notice?.kind === "success" && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-green-200 bg-green-50 p-2 text-sm text-green-800">
            <span>
              Анализ завершён · {notice.recommendationsCount}{" "}
              {pluralRec(notice.recommendationsCount)}.
            </span>
            <Link
              href={`/dashboard/recommendations?targetId=${target.id}`}
              className="font-medium underline underline-offset-2 hover:no-underline"
            >
              Перейти к рекомендациям →
            </Link>
          </div>
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
  confirmMode,
  setConfirmMode,
  archiveAction,
}: {
  target: TargetWithStats
  confirmMode: boolean
  setConfirmMode: (v: boolean) => void
  archiveAction: (formData: FormData) => void
}) {
  // Финальная модель (DECISIONS.md hotfix 5):
  // - COMPLETED → можно архивировать (анализ завершён)
  // - ACTIVE/READY с collected=0 → можно (юзер передумал)
  // - ACTIVE/READY с collected>0 → НЕТ, нужен анализ
  // - ANALYZING → НЕТ, идёт анализ
  const canArchive =
    target.status === "COMPLETED" ||
    ((target.status === "ACTIVE" || target.status === "READY") &&
      target.sessionsCollected === 0)

  const archiveBlockedReason =
    target.status === "ANALYZING"
      ? "Анализ идёт"
      : target.sessionsCollected > 0
        ? "Сначала запустите анализ"
        : null

  if (canArchive) {
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
              setTimeout(() => setConfirmMode(false), 5000)
            }}
          >
            Архивировать
          </Button>
        ) : (
          <ArchiveSubmitButton />
        )}
      </form>
    )
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        title={archiveBlockedReason ?? ""}
      >
        Архивировать
      </Button>
      {archiveBlockedReason && (
        <span className="text-xs text-muted-foreground">
          {archiveBlockedReason}
        </span>
      )}
    </div>
  )
}
