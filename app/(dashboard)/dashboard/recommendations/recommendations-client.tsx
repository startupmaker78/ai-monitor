"use client"

import { useEffect, useState } from "react"
import type { Recommendation } from "@prisma/client"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LocalDateTime } from "@/components/ui/local-date-time"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { AnalysisWithRecs } from "@/lib/recommendations-data"
import type { TargetConversion } from "@/lib/goal-conversion-data"
import { ConversionBlock, ConversionPredatesGoal } from "./conversion-block"

const PRIORITY_META: Record<
  string,
  { label: string; variant: "destructive" | "default" | "secondary" }
> = {
  CRITICAL: { label: "Критично", variant: "destructive" },
  IMPORTANT: { label: "Важно", variant: "default" },
  GOOD: { label: "Хорошо", variant: "secondary" },
}

const CATEGORY_LABELS: Record<string, string> = {
  USABILITY: "Юзабилити",
  CONTENT: "Контент",
  MOBILE: "Мобильная версия",
  PERFORMANCE: "Скорость",
  TRUST: "Доверие",
}

const EFFORT_LABELS: Record<string, string> = {
  LOW: "малые",
  MEDIUM: "средние",
  HIGH: "высокие",
}

type Props = {
  analyses: AnalysisWithRecs[]
  conversion: TargetConversion
}

// Момент привязки текущего целевого действия — есть только у состояний, где
// цель вообще задана. not_set / not_configured / target_not_found цели не
// имеют, гейтить там нечего.
function goalAttachedAt(c: TargetConversion): Date | null {
  return c.state === "ok" || c.state === "error" ? c.goalAttachedAt : null
}

export function RecommendationsClient({ analyses, conversion }: Props) {
  // Дефолт 0 = последний анализ (analyses отсортирован desc). Смена цели
  // = ремоунт (page.tsx даёт key={target.id}) → индекс сам сбрасывается
  // в 0, рекомендации чужой цели не «залипнут».
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Edge: цель без DONE-анализов. В норме не случается (target попадает в
  // список только с DONE+recs), но defensive — не падаем.
  if (analyses.length === 0) {
    // Блок конверсии тут прежний, без гейта: анализа, с датой которого можно
    // сравнивать, попросту нет.
    return (
      <div className="space-y-6">
        <ConversionBlock conversion={conversion} />
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              По этой странице пока нет рекомендаций.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const safeIndex = Math.min(selectedIndex, analyses.length - 1)
  const selected = analyses[safeIndex]
  const latest = analyses[0]
  const isLatest = safeIndex === 0

  // Сравниваем со СТАРТОМ анализа, не с завершением. Цель подтягивается по
  // ходу прогона (enrichment в analysis-runner уже после create), поэтому
  // истина лежит между createdAt и completedAt. createdAt ошибается только в
  // безопасную сторону — покажет честную строку анализу, который цель всё же
  // успел подхватить; completedAt ошибся бы в обратную, оставив неверную
  // подпись. Точный признак (блок «ЦЕЛЕВОЕ ДЕЙСТВИЕ» в Analysis.prompt) не
  // берём: он станет не нужен, когда Analysis начнёт хранить свою цель.
  const attachedAt = goalAttachedAt(conversion)
  const analysisPredatesGoal =
    attachedAt !== null && new Date(selected.createdAt) < new Date(attachedAt)

  return (
    // space-y-6 снаружи / space-y-4 внутри — ровно те отступы, что были, когда
    // блок конверсии стоял в page.tsx соседом сверху.
    <div className="space-y-6">
      {/* «Сколько» — Метрика, над анализом («почему»). Два слоя не смешиваем
          (Этап 0). Живёт здесь, а не в page.tsx, потому что видимость зависит
          от ВЫБРАННОГО анализа — а выбор это клиентский стейт. */}
      {analysisPredatesGoal ? (
        <ConversionPredatesGoal />
      ) : (
        <ConversionBlock conversion={conversion} />
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Анализ от{" "}
            <span className="font-medium text-foreground">
              <LocalDateTime value={selected.createdAt} />
            </span>
            {" · "}проанализировано{" "}
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className="cursor-help underline decoration-dotted underline-offset-2 outline-none"
                  >
                    {selected.sessionsAnalyzed} сессий с действиями
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs font-normal leading-relaxed">
                  Анализируются только сессии с действиями посетителя (клики,
                  скролл, формы). Пустые — bounce и пассивные просмотры —
                  пропускаются, поэтому число меньше, чем «собрано» у страницы.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {" · "}
            {selected.recommendationsCount} рек
          </p>
          {analyses.length > 1 && (
            <AnalysisSelector
              analyses={analyses}
              selectedIndex={safeIndex}
              onSelect={setSelectedIndex}
            />
          )}
        </div>

        {!isLatest && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span>Это предыдущий анализ.</span>
            <button
              type="button"
              onClick={() => setSelectedIndex(0)}
              className="font-medium underline underline-offset-2 hover:no-underline"
            >
              Показать последний (<LocalDateTime value={latest.createdAt} />)
            </button>
          </div>
        )}

        {selected.recommendations.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                В этом анализе нет рекомендаций.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {selected.recommendations.map((rec) => (
              <RecommendationDetailCard key={rec.id} rec={rec} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AnalysisSelector({
  analyses,
  selectedIndex,
  onSelect,
}: {
  analyses: AnalysisWithRecs[]
  selectedIndex: number
  onSelect: (index: number) => void
}) {
  // Детерминированный первый рендер (UTC) → после mount локальная зона.
  // Тот же приём, что LocalDateTime — <option> принимает только текст,
  // компонент туда не вставить, поэтому дату форматируем строкой сами.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  function label(a: AnalysisWithRecs, index: number): string {
    const d = new Date(a.createdAt)
    const date = d.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      ...(mounted ? {} : { timeZone: "UTC" }),
    })
    const suffix = index === 0 ? " (последний)" : ""
    return `${date} · ${a.sessionsAnalyzed} с действиями · ${a.recommendationsCount} рек${suffix}`
  }

  return (
    <select
      value={selectedIndex}
      onChange={(e) => onSelect(Number(e.target.value))}
      className="rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent"
      aria-label="Выбрать анализ"
    >
      {analyses.map((a, i) => (
        <option key={a.id} value={i}>
          {label(a, i)}
        </option>
      ))}
    </select>
  )
}

function RecommendationDetailCard({ rec }: { rec: Recommendation }) {
  const priority = PRIORITY_META[rec.priority] ?? {
    label: rec.priority,
    variant: "secondary" as const,
  }
  const categoryLabel = CATEGORY_LABELS[rec.category] ?? rec.category
  const effortLabel = EFFORT_LABELS[rec.effort] ?? rec.effort

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-lg leading-tight">{rec.title}</CardTitle>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Badge variant={priority.variant}>{priority.label}</Badge>
            <Badge variant="outline">{categoryLabel}</Badge>
            {rec.lowConfidence && (
              // Отдельная ось от приоритета: severity остаётся главным
              // бейджем, «мало данных» — вторичный, но заметный (амбер).
              // «Критично + мало данных» читается как противоречие,
              // разрешённое прозрачностью.
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-50 text-amber-800"
              >
                ⚠ Мало данных
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {/* Порядок: что нашли (evidence — конкретика + размер выборки) →
            почему проблема → что сделать → эффект. evidence раньше был
            скрыт, хотя содержит «в N из M сессий». */}
        {rec.evidence && <Section label="Что нашли" value={rec.evidence} />}
        <Section label="Проблема" value={rec.problem} />
        <Section label="Что сделать" value={rec.description} />
        <Section label="Ожидаемый эффект" value={rec.expectedImpact} />
        <div className="flex flex-wrap items-center gap-3 pt-2 text-xs text-muted-foreground">
          <span>
            Усилия:{" "}
            <span className="font-medium text-foreground">{effortLabel}</span>
          </span>
          {rec.metric && (
            <span>
              Метрика:{" "}
              <span className="font-medium text-foreground">{rec.metric}</span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Section({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="leading-relaxed">{value}</p>
    </div>
  )
}
