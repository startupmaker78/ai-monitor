import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import {
  loadRecommendationsForTarget,
  loadTargetsWithRecommendations,
} from "@/lib/recommendations-data"
import { getGoalConversionForTarget } from "@/lib/goal-conversion-data"
import { getSelectedSiteId } from "@/lib/selected-site"
import { Card, CardContent } from "@/components/ui/card"
import { TargetSelector } from "./target-selector"
import { RecommendationsClient } from "./recommendations-client"
import { ConversionBlock } from "./conversion-block"

export const metadata = { title: "Рекомендации — Вебмонитор" }

type PageProps = { searchParams: { targetId?: string; site?: string } }

export default async function RecommendationsPage({ searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const userId = session.user.id

  // Список целей доскоплен до выбранного сайта (глобальный селектор).
  const siteId = await getSelectedSiteId(userId, searchParams.site)
  const targets = await loadTargetsWithRecommendations(userId, siteId ?? undefined)

  if (targets.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Рекомендации</h2>
        <Card>
          <CardContent className="space-y-4 py-12 text-center">
            <p className="text-muted-foreground">
              Пока нет готовых рекомендаций. Добавьте страницу, соберите по ней
              сессии и запустите анализ.
            </p>
            <Link
              href="/dashboard/targets"
              className="inline-block font-medium text-primary underline underline-offset-2"
            >
              Перейти к страницам
            </Link>
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

  const [data, conversion] = await Promise.all([
    loadRecommendationsForTarget(userId, selectedId),
    getGoalConversionForTarget(userId, selectedId),
  ])
  if (!data) {
    // Не должно случаться: selectedId только что взят из targets. Если
    // случилось — race с удалением цели: отдаём empty state.
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Рекомендации</h2>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Страница не найдена или удалена. Выберите другую.
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
          Страница:{" "}
          <span className="font-medium text-foreground">
            {data.target.name ?? data.target.url}
          </span>
        </p>
      </div>

      {/* «Сколько» — Метрика, отдельным блоком над анализом («почему»).
          Два слоя не смешиваем (Этап 0). */}
      <ConversionBlock conversion={conversion} />

      {/* key={target.id}: смена цели = ремоунт → selectedAnalysisIndex
          сбрасывается в 0 (последний анализ новой цели). */}
      <RecommendationsClient key={data.target.id} analyses={data.analyses} />
    </div>
  )
}
