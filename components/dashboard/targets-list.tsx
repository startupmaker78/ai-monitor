import Link from "next/link"
import type { AnalysisTarget } from "@prisma/client"
import type { LucideIcon } from "lucide-react"
import { Archive, CheckCircle2, Loader2, PlayCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const STATUS_BADGES: Record<
  string,
  {
    label: string
    variant: "default" | "secondary" | "outline"
    icon: LucideIcon | null
  }
> = {
  ACTIVE: { label: "Копит сессии", variant: "secondary", icon: Loader2 },
  READY: { label: "Готов к анализу", variant: "default", icon: PlayCircle },
  ANALYZING: { label: "Анализ идёт", variant: "default", icon: Loader2 },
  COMPLETED: { label: "Проанализировано", variant: "default", icon: CheckCircle2 },
  ARCHIVED: { label: "В архиве", variant: "outline", icon: Archive },
}

interface TargetsListProps {
  targets: AnalysisTarget[]
  // Цели, готовые к анализу (collected>=минимум, ещё не проанализированы).
  // Модель B: запуск возможен не дожидаясь бюджета — подсвечиваем + CTA.
  readyTargetIds?: string[]
}

export function TargetsList({ targets, readyTargetIds = [] }: TargetsListProps) {
  const readySet = new Set(readyTargetIds)
  if (targets.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">
            У вас пока нет добавленных страниц. Добавьте первую — обычно это
            главная или /pricing.
          </p>
          <Link
            href="/dashboard/targets"
            className="mt-4 inline-block text-primary hover:underline"
          >
            Перейти к управлению страницами →
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Страницы для анализа</CardTitle>
          <Link
            href="/dashboard/targets"
            className="shrink-0 text-sm text-primary hover:underline"
          >
            Управление страницами →
          </Link>
        </div>
        <CardDescription>
          AI анализирует поведение посетителей на выбранных страницах. Ниже —
          прогресс сбора сессий по каждой странице. Запуск анализа и управление
          — в разделе «Страницы».
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {targets.map((target) => {
          const isReady = readySet.has(target.id)
          const status = STATUS_BADGES[target.status] ?? STATUS_BADGES.ACTIVE
          const percent =
            target.sessionsBudget > 0
              ? (target.sessionsCollected / target.sessionsBudget) * 100
              : 0
          const StatusIcon = status.icon

          return (
            <div key={target.id} className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {target.name ?? target.url}
                    </span>
                    <span className="font-mono text-sm text-muted-foreground">
                      {target.url}
                    </span>
                  </div>
                </div>
                {isReady ? (
                  <Badge className="shrink-0 border-amber-300 bg-amber-100 text-amber-800">
                    <PlayCircle className="mr-1 h-3 w-3" />
                    Можно запускать
                  </Badge>
                ) : (
                  <Badge variant={status.variant} className="shrink-0">
                    {StatusIcon && <StatusIcon className="mr-1 h-3 w-3" />}
                    {status.label}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${Math.min(percent, 100)}%` }}
                  />
                </div>
                <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {target.sessionsCollected.toLocaleString("ru-RU")} /{" "}
                  {target.sessionsBudget.toLocaleString("ru-RU")}
                </span>
              </div>

              {isReady && (
                <p className="text-xs text-muted-foreground">
                  Набрано достаточно сессий —{" "}
                  <Link
                    href="/dashboard/recommendations"
                    className="font-medium text-amber-700 underline underline-offset-2"
                  >
                    запустить анализ
                  </Link>{" "}
                  можно не дожидаясь полного сбора.
                </p>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
