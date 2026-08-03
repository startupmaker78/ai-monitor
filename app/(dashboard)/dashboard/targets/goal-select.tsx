"use client"

import { useEffect, useState } from "react"
import {
  Loader2,
  ChevronDown,
  Check,
  Target as TargetIcon,
  HelpCircle,
} from "lucide-react"
import Link from "next/link"
import { guideHref } from "@/lib/guide-anchors"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { loadSiteGoals, loadGoalRelevance } from "./actions"
import type { GoalWithReaches, SiteGoalsResult } from "@/lib/metrika-goals-data"
import type { GoalRelevance } from "@/lib/metrika-goals"

// Сквозные (футерные) авто-цели — конверсия по ним ~одинакова на всех
// страницах, не привязана к конкретной.
const FOOTER_TYPES = new Set([
  "social",
  "phone",
  "email",
  "messenger",
  "file",
  "form",
  "contact_data",
])

function pagePath(u: string): string | null {
  try {
    const p = new URL(u).pathname
    return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p
  } catch {
    return null
  }
}

// Путь из url-условия цели (для показа «про страницу X»).
function conditionPath(condUrl: string): string {
  try {
    return new URL(condUrl).pathname
  } catch {
    return condUrl
  }
}

// Совпадает ли url-цель с текущей страницей (по типу условия). true = релевантна
// (бейдж не нужен). Если страницу определить нельзя — не пугаем (true).
function urlGoalMatchesPage(
  cond: { type: string; url: string },
  pageUrl: string,
): boolean {
  const page = pagePath(pageUrl)
  if (!page) return true
  const c = conditionPath(cond.url).replace(/\/$/, "").toLowerCase() || "/"
  const p = page.toLowerCase()
  switch (cond.type) {
    case "exact":
      return p === c
    case "start":
      return p.startsWith(c)
    case "contain":
      return p.includes(c)
    case "regexp":
      try {
        return new RegExp(cond.url).test(pageUrl)
      } catch {
        return true
      }
    default:
      return true
  }
}

// Приглушённый инфо-бейдж для цели (детерминированно, 0 вызовов). null = нет.
function goalWarning(goal: GoalWithReaches, pageUrl?: string): string | null {
  // Сигнал объёма — раньше остальных: цель без единого достижения за период
  // = анализировать нечего (конверсия 0%/no_data) независимо от типа. Порог
  // ровно 0: «не срабатывала» факт-верно только при 0; 1-2 достижения ЦЕЛЬ
  // засчитала (тонкие данные ловит lowConfidence при анализе), их этим
  // бейджем не оговариваем.
  if (goal.reaches === 0) {
    return "за период не срабатывала — анализировать нечего"
  }
  if (goal.type === "visit_duration" || goal.type === "number") {
    return "вовлечённость, а не бизнес-действие — конверсия по ней мало что скажет"
  }
  if (goal.type === "url" && goal.urlCondition) {
    // Бейдж «про другую страницу» показываем только когда страница известна
    // (в форме url ещё пуст → молчим, чтобы не ляпнуть про несуществующую).
    if (!pageUrl) return null
    if (!urlGoalMatchesPage(goal.urlCondition, pageUrl)) {
      return `эта цель про страницу ${conditionPath(goal.urlCondition.url)} — здесь покажем, почему сюда не доходят`
    }
    return null
  }
  if (FOOTER_TYPES.has(goal.type)) {
    return "футерная — конверсия ~одинакова на всех страницах"
  }
  return null
}

// Ярус цели для сортировки:
//   0 — избранные ЖИВЫЕ (клиент отметил ключевой в Метрике — сильнее нашей
//       эвристики релевантности);
//   1 — обычные не-демотированные;
//   2 — демотированные нашими сигналами релевантности (duration/url-mismatch/
//       footer);
//   3 — МЁРТВЫЕ (reaches=0), включая избранные.
// Правило: звезда бьёт эвристики, но НЕ бьёт ноль — 0 достижений за период
// это факт (конверсия вернёт no_data), а не догадка. Мёртвая избранная всё
// равно сохраняет звезду и бейдж «не срабатывала» (честно объясняет, почему
// внизу). Внутри яруса — по достижениям.
function goalTier(g: GoalWithReaches, pageUrl?: string): number {
  if (g.reaches === 0) return 3
  if (g.isFavorite) return 0
  // reaches>0 здесь → goalWarning вернёт только не-dead сигналы.
  return goalWarning(g, pageUrl) ? 2 : 1
}

// Сортировка пользовательских целей по ярусам (0 вызовов, из списка).
function byRelevance(pageUrl?: string) {
  return (a: GoalWithReaches, b: GoalWithReaches): number => {
    const ta = goalTier(a, pageUrl)
    const tb = goalTier(b, pageUrl)
    if (ta !== tb) return ta - tb
    return b.reaches - a.reaches
  }
}

// Короткие RU-подписи типов целей Метрики (для читаемости в списке).
const GOAL_TYPE_LABELS: Record<string, string> = {
  action: "клик/событие",
  url: "посещение URL",
  button: "клик по кнопке",
  phone: "звонок",
  email: "email",
  file: "файл",
  social: "соцсети",
  messenger: "мессенджер",
  form: "форма",
  search: "поиск по сайту",
  contact_data: "контактные данные",
  payment_system: "платёжная система",
  e_purchase: "покупка",
  e_cart: "добавление в корзину",
  step: "составная цель",
  multi: "мультицель", // type:"multi" — до 10 подцелей через ИЛИ (children[])
  param: "цель по параметрам", // type:"param" — conditions по параметрам события
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
  // Тип выбранной цели — чтобы решить, тянуть ли релевантность (только action).
  currentGoalType?: string | null
  // URL страницы (карта=target.url, форма=вводимый url). Для url-бейджа и
  // релевантности. undefined/"" → эти подсказки не показываем.
  pageUrl?: string
  disabled?: boolean
  // Вызывается при выборе цели (null = сбросить). Родитель решает, что
  // делать: create-форма пишет в hidden-input, карточка зовёт setTargetGoal.
  onPick: (goal: { id: string; name: string; type: string } | null) => void
}

export function GoalSelect({
  siteId,
  currentGoalId,
  currentGoalName,
  currentGoalType,
  pageUrl,
  disabled,
  onPick,
}: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<SiteGoalsResult | null>(null)
  const [showAuto, setShowAuto] = useState(false)
  const [relevance, setRelevance] = useState<GoalRelevance | null>(null)

  // Релевантность (3 вызова) — ТОЛЬКО для выбранной action-цели при известной
  // странице. Не при открытии дропдауна, не для 30 целей разом.
  useEffect(() => {
    if (currentGoalType === "action" && currentGoalId && pageUrl) {
      let alive = true
      setRelevance(null)
      loadGoalRelevance(siteId, currentGoalId, pageUrl).then((r) => {
        if (alive) setRelevance(r)
      })
      return () => {
        alive = false
      }
    }
    setRelevance(null)
  }, [siteId, currentGoalId, currentGoalType, pageUrl])

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
    <div className="space-y-1">
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
            {/* Видимый список = пользовательские + ИЗБРАННЫЕ авто-цели (клиент
                отметил ключевыми — не прячем в свёрнутой группе). */}
            {[...data.user, ...data.auto.filter((g) => g.isFavorite)]
              .sort(byRelevance(pageUrl))
              .map((g) => (
                <GoalRow
                  key={g.id}
                  goal={g}
                  selected={g.id === currentGoalId}
                  pageUrl={pageUrl}
                  onPick={pick}
                />
              ))}

            {data.auto.filter((g) => !g.isFavorite).length > 0 && (
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
                    ▸ Автоцели Метрики (
                    {data.auto.filter((g) => !g.isFavorite).length}) — показать
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuLabel className="text-xs font-normal normal-case text-muted-foreground">
                      Автоцели — Метрика создала их сама (соцсети, телефон,
                      формы)
                    </DropdownMenuLabel>
                    {data.auto
                      .filter((g) => !g.isFavorite)
                      .map((g) => (
                        <GoalRow
                          key={g.id}
                          goal={g}
                          selected={g.id === currentGoalId}
                          pageUrl={pageUrl}
                          onPick={pick}
                        />
                      ))}
                  </>
                )}
              </>
            )}
          </>
        )}
        {/* Нейтральная help-ссылка (не бейдж-предупреждение): подвал меню, не
            DropdownMenuItem — Radix onSelect к ней не применяется, меню не
            закрывается, гайд открывается в новой вкладке (состояние выбора не
            теряется). Якорь на раздел про типы целей. */}
        <div className="sticky bottom-0 border-t bg-popover px-2 py-2">
          <Link
            href={guideHref("types")}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <HelpCircle className="h-3.5 w-3.5 shrink-0" />
            Какую цель выбрать? Открыть гайд
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
      {/* Релевантность выбранной action-цели (вариант C: обе меры viewed,
          сравнимы напрямую). Инфо + мягкая подсказка страницы (не указание). */}
      {relevance && relevance.total > 0 && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>
            Срабатывает у {relevance.onPage.pct}% открывавших эту страницу
            {relevance.topOther
              ? `; у ${relevance.topOther.pct}% открывавших «${
                  relevance.topOther.label ?? relevance.topOther.path
                }»`
              : ""}
            .
          </p>
          {/* Подсказка ТОЛЬКО при заметной разнице (порог 15 п.п. — гипотеза,
              см. DECISIONS). Помогаем выбрать, не отнимаем: клиент волен
              анализировать текущую страницу. */}
          {relevance.topOther &&
            relevance.topOther.pct > relevance.onPage.pct &&
            relevance.topOther.pct - relevance.onPage.pct >= 15 && (
              <p>
                Если интересно, где она срабатывает, — можно проанализировать и «
                {relevance.topOther.label ?? relevance.topOther.path}».
              </p>
            )}
        </div>
      )}
    </div>
  )
}

function GoalRow({
  goal,
  selected,
  pageUrl,
  onPick,
}: {
  goal: GoalWithReaches
  selected: boolean
  pageUrl?: string
  onPick: (g: GoalWithReaches) => void
}) {
  const warning = goalWarning(goal, pageUrl)
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
          {goal.isFavorite && (
            <span className="mt-0.5 block text-xs font-medium text-amber-700">
              ★ ключевая цель — отмечена в Метрике
            </span>
          )}
          {warning && (
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground/80">
              ⓘ {warning}
            </span>
          )}
        </span>
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {goal.reaches}
      </span>
    </DropdownMenuItem>
  )
}
