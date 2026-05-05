"use client"

import { useFormState, useFormStatus } from "react-dom"
import { useState } from "react"
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
  const canCreate = props.targetsRemaining > 0 && props.sessionsRemaining >= 100

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
                : "Недостаточно свободных сессий (нужно минимум 100)."}
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
                min={100}
                max={props.sessionsRemaining}
                step={50}
                defaultValue={Math.min(500, props.sessionsRemaining)}
                required
                disabled={!canCreate}
              />
              <p className="text-xs text-muted-foreground">
                Сколько сессий собрать перед AI-анализом. Минимум 100.
                Доступно: {props.sessionsRemaining}.
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
              <TargetCard key={t.id} target={t} />
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
              <TargetCard key={t.id} target={t} archived />
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
}: {
  target: TargetWithStats
  archived?: boolean
}) {
  const [archiveState, archiveAction] = useFormState(
    archiveTarget,
    initialState,
  )
  const [confirmMode, setConfirmMode] = useState(false)

  const progress =
    target.sessionsBudget > 0
      ? Math.min(
          100,
          Math.round((target.sessionsCollected / target.sessionsBudget) * 100),
        )
      : 0

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
          {!archived &&
            (() => {
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
                    <input
                      type="hidden"
                      name="targetId"
                      value={target.id}
                    />
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
            })()}
        </div>
        {archiveState?.ok === false && archiveState.error && (
          <p className="mt-2 text-sm text-destructive">{archiveState.error}</p>
        )}
      </CardContent>
    </Card>
  )
}
