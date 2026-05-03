import { Clock, Eye, Lightbulb, TrendingUp } from "lucide-react"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getDashboardData } from "@/lib/dashboard-data"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { VisitsChart } from "@/components/dashboard/visits-chart"
import { RecommendationCard } from "@/components/dashboard/recommendation-card"
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

  if (!data) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Дашборд</h2>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Нет данных для отображения. Свяжитесь с поддержкой.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
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
      </div>

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

      <VisitsChart data={data.chart} />

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
