import Link from "next/link"
import { Clock, Eye, Lightbulb, TrendingUp } from "lucide-react"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getDashboardData } from "@/lib/dashboard-data"
import { DEMO_TIER } from "@/lib/demo-tier-info"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { VisitsChart } from "@/components/dashboard/visits-chart"
import { RecommendationCard } from "@/components/dashboard/recommendation-card"
import { TierBadge } from "@/components/dashboard/tier-badge"
import { UsageWidget } from "@/components/dashboard/usage-widget"
import { TargetsList } from "@/components/dashboard/targets-list"
import { SyncButton } from "@/components/dashboard/sync-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export const metadata = {
  title: "Дашборд — Вебмонитор",
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const data = await getDashboardData(session.user.id)

  // 0 real sites — после сlean-up demo и моего фильтра isDemo=false в
  // dashboard-data getDashboardData возвращает null когда Sites нет.
  if (!data) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Дашборд</h2>
        <Card>
          <CardContent className="space-y-4 py-12 text-center">
            <h3 className="text-xl font-semibold">
              Подключите свой первый сайт
            </h3>
            <p className="mx-auto max-w-md text-muted-foreground">
              Добавьте сайт чтобы Вебмонитор начал собирать сессии и
              анализировать их с помощью AI.
            </p>
            <div>
              <Link href="/dashboard/settings/sites">
                <Button size="lg">Подключить сайт</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Привет, {session.user.name ?? "Пользователь"}!
          </h2>
          <p className="mt-1 text-muted-foreground">
            Сводка по сайту {data.site.domain}
            {data.site.isDemo && (
              <span className="ml-2 inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-700/10">
                Демо
              </span>
            )}
          </p>
          <div className="mt-3">
            <TierBadge name={data.tier.name} price={data.tier.price} />
          </div>
        </div>
        <SyncButton
          siteId={data.site.id}
          metrikaConfigured={Boolean(
            data.site.metrikaCounterId && data.site.metrikaToken,
          )}
        />
      </div>

      {!data.hasMetrics && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="flex flex-wrap items-start justify-between gap-4 py-4">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold">
                Ждём первых данных от вашего сайта
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Подключите Яндекс.Метрику или проверьте что трекер
                установлен на сайте — как только данные появятся, они
                автоматически отобразятся здесь.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Link href="/dashboard/settings/metrika">
                <Button size="sm" variant="outline">
                  Настроить Метрику
                </Button>
              </Link>
              <Link href="/dashboard/settings/sites">
                <Button size="sm" variant="outline">
                  Проверить трекер
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Визиты за 7 дней"
          value={data.kpi.totalVisits7d.toLocaleString("ru-RU")}
          description="Уникальные посещения"
          icon={Eye}
        />
        <KpiCard
          title="Конверсия"
          value={`${data.kpi.avgConversionRate.toFixed(1)}%`}
          description="Средняя за неделю"
          icon={TrendingUp}
        />
        <KpiCard
          title="Среднее время"
          value={formatDuration(data.kpi.avgDuration)}
          description="На сайте, мин:сек"
          icon={Clock}
        />
        <KpiCard
          title="Активные рекомендации"
          value={data.kpi.totalActive.toString()}
          description={`🔴 ${data.priorityCounts.CRITICAL} · 🟡 ${data.priorityCounts.IMPORTANT} · 🟢 ${data.priorityCounts.GOOD}`}
          icon={Lightbulb}
        />
      </div>

      <UsageWidget
        usage={data.usage}
        tierName={data.tier.name}
        tierLimits={{
          targetsLimit: DEMO_TIER.targetsLimit,
          analysesPerMonth: DEMO_TIER.analysesPerMonth,
          sessionsLimit: DEMO_TIER.sessionsLimit,
        }}
      />

      <VisitsChart data={data.chart} />

      <TargetsList targets={data.targets} />

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold tracking-tight">
            Топ-10 рекомендаций
          </h3>
          <span className="text-sm text-muted-foreground">
            Показаны самые приоритетные. Полный список — раздел «Рекомендации».
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {data.recommendations.map((rec) => (
            <RecommendationCard key={rec.id} recommendation={rec} />
          ))}
        </div>
      </div>
    </div>
  )
}
