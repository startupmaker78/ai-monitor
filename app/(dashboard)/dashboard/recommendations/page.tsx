import { redirect } from "next/navigation"
import type { Recommendation } from "@prisma/client"
import { auth } from "@/auth"
import {
  loadRecommendationsForTarget,
  loadTargetsWithRecommendations,
} from "@/lib/recommendations-data"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TargetSelector } from "./target-selector"

export const metadata = { title: "Рекомендации — Вебмонитор" }

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
})

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

type PageProps = { searchParams: { targetId?: string } }

export default async function RecommendationsPage({ searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const userId = session.user.id

  const targets = await loadTargetsWithRecommendations(userId)

  if (targets.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Рекомендации</h2>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Пока нет готовых рекомендаций. Соберите сессии по цели и
              запустите анализ.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Default target: searchParams.targetId если он валиден и принадлежит
  // юзеру (то есть попадает в загруженный targets). Иначе первый в
  // списке — targets отсортирован «свежий DONE-анализ первым».
  const requestedId = searchParams.targetId
  const selectedId =
    requestedId && targets.some((t) => t.id === requestedId)
      ? requestedId
      : targets[0].id

  const data = await loadRecommendationsForTarget(userId, selectedId)
  if (!data) {
    // Не должно случаться: selectedId только что взят из targets. Если
    // случилось — race с удалением цели: отдаём empty state.
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Рекомендации</h2>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Цель не найдена или удалена. Выберите другую цель.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">Рекомендации</h2>
        <TargetSelector targets={targets} selectedId={selectedId} />
      </div>

      <div>
        <p className="text-sm text-muted-foreground">
          Цель:{" "}
          <span className="font-medium text-foreground">
            {data.target.name ?? data.target.url}
          </span>
          {data.analysis && (
            <>
              {" · "}Анализ от {dateFmt.format(data.analysis.createdAt)}
            </>
          )}
        </p>
      </div>

      {data.recommendations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              По этой цели пока нет рекомендаций.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data.recommendations.map((rec) => (
            <RecommendationDetailCard key={rec.id} rec={rec} />
          ))}
        </div>
      )}
    </div>
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
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
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
          {rec.lowConfidence && (
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
              низкая уверенность
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
