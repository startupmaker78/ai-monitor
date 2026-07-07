"use client"

import { useFormState, useFormStatus } from "react-dom"
import { useState } from "react"
import { useRouter } from "next/navigation"
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
                step={50}
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
  READY: "Готова к анализу",
  ANALYZING: "Анализируется",
  COMPLETED: "Анализ завершён",
  ARCHIVED: "Архив",
}

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
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
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
    setAnalyzeError(null)
    try {
      const res = await fetch("/api/analysis/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: target.id }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        message?: string
        error?: string
      }
      if (!res.ok) {
        setAnalyzeError(
          data.message ?? `Ошибка сервера (${res.status}). Попробуйте ещё раз.`,
        )
        setAnalyzing(false)
        return
      }
      // Успех: рефрешим страницу — server component перечитает данные,
      // карточка перерисуется со статусом COMPLETED.
      router.refresh()
      setAnalyzing(false)
    } catch (err) {
      setAnalyzeError(
        err instanceof Error ? err.message : "Ошибка сети.",
      )
      setAnalyzing(false)
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
              {STATUS_LABELS[target.status] ?? target.status}
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
          <p className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
            Идёт анализ, обычно ~1 минута. Не закрывайте вкладку.
          </p>
        )}
        {analyzeError && (
          <p className="mt-2 text-sm text-destructive">{analyzeError}</p>
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
  if (target.status === "ACTIVE") {
    return (
      <Button type="button" size="sm" disabled>
        {`Накоплено ${target.sessionsCollected}/${target.sessionsBudget} (нужно ≥${minSessionsBudget})`}
      </Button>
    )
  }
  if (target.status === "READY") {
    return (
      <Button
        type="button"
        size="sm"
        disabled={analyzing}
        onClick={onAnalyze}
      >
        {analyzing ? "Идёт анализ ~1 минута…" : "Запустить анализ"}
      </Button>
    )
  }
  if (target.status === "ANALYZING") {
    return (
      <Button type="button" size="sm" disabled>
        Анализ идёт…
      </Button>
    )
  }
  if (target.status === "COMPLETED") {
    return (
      <Button type="button" size="sm" disabled>
        Завершён в этом периоде
      </Button>
    )
  }
  return null
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
