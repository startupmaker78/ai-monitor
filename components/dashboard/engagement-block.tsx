import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { EngagementInfo } from "./engagement-info"

// Строка вовлечённости одной цели (форма из lib/dashboard-data.ts).
type EngagementRow = {
  targetId: string
  name: string | null
  url: string
  useful: number
  passive: number
  bounce: number
  incomplete: number
  total: number
  realVisits: number
  engagementPct: number | null
}

// Пороговые эвристики (стартовые, легко тюнить). <75% → ⚠️: больше 1 из 4
// реальных визитов уходит без единого действия. ≥90% → ✅: страница
// удерживает почти всех (эталон). Между — нейтрально.
const WARN_BELOW = 75
const GOOD_AT_OR_ABOVE = 90

function widthPct(count: number, total: number): string {
  if (total <= 0) return "0%"
  return `${(count / total) * 100}%`
}

export function EngagementBlock({
  engagement,
}: {
  engagement: EngagementRow[]
}) {
  // Только цели с сессиями — пустые (0 всего) не шумят.
  const rows = engagement.filter((e) => e.total > 0)
  if (rows.length === 0) return null

  // По убыванию вовлечённости (эталон сверху, проблема снизу — как в
  // примере); n/d в конец. ⚠️-акцент выделяет низкие независимо от позиции.
  const sorted = [...rows].sort((a, b) => {
    if (a.engagementPct === null) return 1
    if (b.engagementPct === null) return -1
    return b.engagementPct - a.engagementPct
  })

  const totalIncomplete = rows.reduce((s, e) => s + e.incomplete, 0)
  const totalAll = rows.reduce((s, e) => s + e.total, 0)
  const incompletePct =
    totalAll > 0 ? Math.round((totalIncomplete / totalAll) * 100) : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <CardTitle>Вовлечённость страниц</CardTitle>
            <EngagementInfo />
          </div>
          <Legend />
        </div>
        <CardDescription>
          Доля посетителей, совершивших действие (клик, скролл, ввод), от
          реальных визитов на каждой странице. Видно, где теряете внимание.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sorted.map((e) => {
          const pct = e.engagementPct
          const tone =
            pct === null
              ? "text-muted-foreground"
              : pct < WARN_BELOW
                ? "text-amber-600"
                : pct >= GOOD_AT_OR_ABOVE
                  ? "text-green-600"
                  : "text-foreground"
          const icon =
            pct === null
              ? ""
              : pct < WARN_BELOW
                ? " ⚠️"
                : pct >= GOOD_AT_OR_ABOVE
                  ? " ✅"
                  : ""
          const title =
            `${e.useful} с действием · ${e.passive} пассивных · ` +
            `${e.bounce} отскок · ${e.incomplete} неполных (не в счёте)`
          return (
            <div key={e.targetId} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{e.name ?? e.url}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {e.url}
                  </span>
                </div>
                <span
                  className={`shrink-0 whitespace-nowrap font-mono text-sm ${tone}`}
                >
                  {pct === null ? "нет данных" : `${pct}%`}
                  {icon}
                </span>
              </div>
              <div
                className="flex h-2 overflow-hidden rounded-full bg-muted"
                title={title}
              >
                <div
                  className="bg-green-500"
                  style={{ width: widthPct(e.useful, e.total) }}
                />
                <div
                  className="bg-amber-400"
                  style={{ width: widthPct(e.passive, e.total) }}
                />
                <div
                  className="bg-gray-400"
                  style={{ width: widthPct(e.bounce, e.total) }}
                />
                <div
                  className="bg-muted-foreground/20"
                  style={{ width: widthPct(e.incomplete, e.total) }}
                />
              </div>
            </div>
          )
        })}
        <p className="text-xs text-muted-foreground">
          Вовлечённость считается от реальных визитов. Неполные визиты (боты,
          мгновенный уход, 0–1 событие
          {totalIncomplete > 0 ? ` — ${incompletePct}% сессий` : ""}) в расчёт
          не входят — это светлый сегмент полосы.
        </p>
      </CardContent>
    </Card>
  )
}

function Legend() {
  const items: Array<{ cls: string; label: string }> = [
    { cls: "bg-green-500", label: "действие" },
    { cls: "bg-amber-400", label: "пассивно" },
    { cls: "bg-gray-400", label: "отскок" },
    { cls: "bg-muted-foreground/20", label: "неполное" },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1">
          <span className={`h-2 w-2 rounded-sm ${i.cls}`} />
          {i.label}
        </span>
      ))}
    </div>
  )
}
