import Link from "next/link"
import { PlaySquare, Lightbulb } from "lucide-react"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getDashboardData } from "@/lib/dashboard-data"
import { getSelectedSiteId } from "@/lib/selected-site"
import { toUnicodeDomain } from "@/lib/domain-display"
import { DEMO_TIER } from "@/lib/demo-tier-info"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { FreshRecommendations } from "@/components/dashboard/fresh-recommendations"
import { SessionsChart } from "@/components/dashboard/sessions-chart"
import { TierBadge } from "@/components/dashboard/tier-badge"
import { UsageWidget } from "@/components/dashboard/usage-widget"
import { TargetsList } from "@/components/dashboard/targets-list"
import { EngagementBlock } from "@/components/dashboard/engagement-block"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export const metadata = {
  title: "Дашборд — Вебмонитор",
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { site?: string }
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  // Глобальный выбор сайта (cookie) + опциональный ?site= override.
  const siteId = await getSelectedSiteId(session.user.id, searchParams.site)
  const data = await getDashboardData(session.user.id, siteId ?? undefined)

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

  const trackerActive = data.kpi.sessionsRecorded > 0
  const metrikaConfigured = Boolean(
    data.site.metrikaCounterId && data.site.metrikaToken,
  )

  return (
    <div className="space-y-6">
      <div>
        {/* Приветствие убрано (место без смысла); подзаголовок «Сводка по
            сайту» стал заголовком. Цена убрана из бейджа — она на странице
            тарифа, а не ежедневным напоминанием о списании. Бейдж кликабельный
            → тарифы. Кнопка синка Метрики перенесена в Настройки → Метрика. */}
        <h2 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
          Сводка по сайту {toUnicodeDomain(data.site.domain)}
          {data.site.isDemo && (
            <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-700/10">
              Демо
            </span>
          )}
        </h2>
        <div className="mt-3">
          <TierBadge name={data.tier.name} href="/dashboard/settings/tariff" />
        </div>
      </div>

      <OnboardingBanner
        trackerActive={trackerActive}
        metrikaConfigured={metrikaConfigured}
        targetsActive={data.kpi.targetsActive}
        analysesTotal={data.analysesTotal}
        analysesRemaining={data.analysesRemaining}
        readyToAnalyze={data.readyToAnalyze}
      />

      {/* Два продуктовых KPI (крупнее). Цели и «анализов в этом месяце» УБРАНЫ:
          дублировали тарифный блок (там есть контекст лимита/остатка). */}
      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard
          title="Сессий записано"
          value={data.kpi.sessionsRecorded.toLocaleString("ru-RU")}
          description="Всего по сайту"
          icon={PlaySquare}
        />
        <Link
          href="/dashboard/recommendations"
          className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <KpiCard
            title="Рекомендаций получено"
            value={data.kpi.recommendationsReceived.toString()}
            description={`🔴 ${data.recPriorityReceived.CRITICAL} · 🟡 ${data.recPriorityReceived.IMPORTANT} · 🟢 ${data.recPriorityReceived.GOOD}`}
            icon={Lightbulb}
          />
        </Link>
      </div>

      {/* Порядок: KPI → тариф (остаток лимитов виден до упора) → свежие
          критичные → график. FreshCritical условный — чаще Usage сразу #2. */}
      <UsageWidget
        usage={data.usage}
        tierName={data.tier.name}
        tierLimits={{
          targetsLimit: DEMO_TIER.targetsLimit,
          analysesPerMonth: DEMO_TIER.analysesPerMonth,
          sessionsLimit: DEMO_TIER.sessionsLimit,
        }}
      />

      <FreshRecommendations items={data.freshCritical} />

      <SessionsChart data={data.sessionsChart} />

      <TargetsList
        targets={data.activePageTargets}
        readyTargetIds={data.readyTargetIds}
        completedCount={data.completedPagesCount}
      />

      <EngagementBlock engagement={data.engagement} />
    </div>
  )
}

// Пустое/переходное состояние продукта — 3 ветки, каждая ведёт к действию.
// Приоритет: подключение → цель → готовность к анализу. Иначе — молчим.
function OnboardingBanner({
  trackerActive,
  metrikaConfigured,
  targetsActive,
  analysesTotal,
  analysesRemaining,
  readyToAnalyze,
}: {
  trackerActive: boolean
  metrikaConfigured: boolean
  targetsActive: number
  analysesTotal: number
  analysesRemaining: number
  readyToAnalyze: { count: number; firstName: string | null }
}) {
  let title: string
  let text: string
  let href: string
  let cta: string

  const readyTitle = (name: string | null, count: number) =>
    count === 1 && name
      ? `Страница «${name}» готова к анализу`
      : `${count} ${count < 5 ? "страницы" : "страниц"} готовы к анализу`

  if (!trackerActive || !metrikaConfigured) {
    title = "Проверьте подключение сайта"
    text =
      "Пока не всё подключено — на экране сайтов видно, чего именно не хватает (трекер или Метрика)."
    href = "/dashboard/settings/sites"
    cta = "Проверить подключение"
  } else if (targetsActive === 0) {
    title = "Добавьте первую страницу"
    text =
      "Укажите страницу, к которой вы ведёте посетителей. По ней Вебмонитор соберёт сессии и найдёт, что мешает конверсии."
    href = "/dashboard/targets"
    cta = "Добавить страницу"
  } else if (analysesTotal === 0 && readyToAnalyze.count > 0) {
    // Новичок: первый анализ.
    title = readyTitle(readyToAnalyze.firstName, readyToAnalyze.count)
    text =
      "Набрано достаточно сессий — можно запускать анализ, не дожидаясь полного сбора."
    href = "/dashboard/recommendations"
    cta = "Запустить анализ"
  } else if (readyToAnalyze.count > 0 && analysesRemaining > 0) {
    // Зрелый (вариант A): ЕЩЁ НЕ проанализированные готовые цели + есть остаток
    // лимита. Уже проанализированные сюда НЕ попадают (readyToAnalyze их
    // исключает) — не толкаем жечь анализ повторно на тех же сессиях.
    title = readyTitle(readyToAnalyze.firstName, readyToAnalyze.count)
    text = `Набрано достаточно сессий. В этом месяце доступно анализов: ${analysesRemaining}.`
    href = "/dashboard/recommendations"
    cta = "Запустить анализ"
  } else {
    return null
  }

  return (
    <Card className="border-amber-200 bg-amber-50/60">
      <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href={href}>
            <Button size="sm" variant="outline">
              {cta}
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
