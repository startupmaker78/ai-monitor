"use client"

import { useState } from "react"
import { Loader2, ChevronDown, Check, Target as TargetIcon } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { loadSiteGoals } from "./actions"
import type { GoalWithReaches, SiteGoalsResult } from "@/lib/metrika-goals-data"

// Короткие RU-подписи типов целей Метрики (для читаемости в списке).
const GOAL_TYPE_LABELS: Record<string, string> = {
  action: "клик/событие",
  url: "посещение URL",
  phone: "звонок",
  email: "email",
  file: "файл",
  social: "соцсети",
  messenger: "мессенджер",
  form: "форма",
  visit_duration: "время на сайте",
  number: "глубина",
}

function typeLabel(t: string): string {
  return GOAL_TYPE_LABELS[t] ?? t
}

// Тексты ошибок загрузки списка целей (не показываем «пусто» молча).
const LOAD_ERROR: Record<string, string> = {
  auth_failed: "Токен Метрики истёк. Обновите в Настройках → Метрика.",
  counter_forbidden:
    "Метрика отклонила запрос — токен недействителен или нет доступа к счётчику.",
  rate_limited: "Слишком много обращений к Метрике. Подождите пару минут.",
  metrika_unavailable: "Метрика временно недоступна. Попробуйте позже.",
  forbidden: "Сайт не найден.",
}

type Props = {
  siteId: string
  currentGoalId: string | null
  currentGoalName: string | null
  disabled?: boolean
  // Вызывается при выборе цели (null = сбросить). Родитель решает, что
  // делать: create-форма пишет в hidden-input, карточка зовёт setTargetGoal.
  onPick: (goal: { id: string; name: string; type: string } | null) => void
}

export function GoalSelect({
  siteId,
  currentGoalId,
  currentGoalName,
  disabled,
  onPick,
}: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<SiteGoalsResult | null>(null)
  const [showAuto, setShowAuto] = useState(false)

  async function handleOpenChange(next: boolean) {
    setOpen(next)
    // Ленивая загрузка при первом открытии (не на рендер страницы).
    if (next && data === null && !loading) {
      setLoading(true)
      const res = await loadSiteGoals(siteId)
      setData(res)
      setLoading(false)
    }
  }

  function pick(g: GoalWithReaches | null) {
    onPick(g ? { id: g.id, name: g.name, type: g.type } : null)
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-between gap-2"
          disabled={disabled}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <TargetIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="truncate">
              {currentGoalName ?? "Выбрать целевое действие"}
            </span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-80 overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка целей Метрики…
          </div>
        )}

        {!loading && data && !data.ok && (
          <div className="px-2 py-3 text-sm text-amber-800">
            {data.reason === "not_configured" ? (
              <span>
                Сначала подключите Яндекс.Метрику.{" "}
                <Link
                  href="/dashboard/settings/metrika"
                  className="font-medium underline underline-offset-2"
                >
                  Настройки → Метрика
                </Link>
              </span>
            ) : (
              (LOAD_ERROR[data.reason] ?? "Не удалось загрузить цели.")
            )}
          </div>
        )}

        {!loading && data && data.ok && (
          <>
            {currentGoalId && (
              <>
                <DropdownMenuItem
                  onSelect={() => pick(null)}
                  className="text-muted-foreground"
                >
                  Убрать целевое действие
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}

            <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
              Ваши цели
            </DropdownMenuLabel>
            {data.user.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                В счётчике нет пользовательских целей.
              </div>
            )}
            {data.user.map((g) => (
              <GoalRow
                key={g.id}
                goal={g}
                selected={g.id === currentGoalId}
                onPick={pick}
              />
            ))}

            {data.auto.length > 0 && (
              <>
                <DropdownMenuSeparator />
                {!showAuto ? (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault() // не закрывать меню — просто раскрыть
                      setShowAuto(true)
                    }}
                    className="text-sm text-muted-foreground"
                  >
                    ▸ Автоцели Метрики ({data.auto.length}) — показать
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuLabel className="text-xs font-normal normal-case text-muted-foreground">
                      Автоцели — Метрика создала их сама (соцсети, телефон,
                      формы)
                    </DropdownMenuLabel>
                    {data.auto.map((g) => (
                      <GoalRow
                        key={g.id}
                        goal={g}
                        selected={g.id === currentGoalId}
                        onPick={pick}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function GoalRow({
  goal,
  selected,
  onPick,
}: {
  goal: GoalWithReaches
  selected: boolean
  onPick: (g: GoalWithReaches) => void
}) {
  return (
    <DropdownMenuItem
      onSelect={() => onPick(goal)}
      className="flex items-start justify-between gap-2"
    >
      <span className="flex min-w-0 items-start gap-1.5">
        <Check
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`}
        />
        <span className="min-w-0">
          <span className="block truncate">{goal.name}</span>
          <span className="block text-xs text-muted-foreground">
            {typeLabel(goal.type)}
          </span>
        </span>
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {goal.reaches}
      </span>
    </DropdownMenuItem>
  )
}
