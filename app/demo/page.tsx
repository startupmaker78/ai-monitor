import Link from "next/link"
import { PlaySquare, Lightbulb, Sparkles } from "lucide-react"
import { getDashboardData } from "@/lib/dashboard-data"
import { DEMO_TIER } from "@/lib/demo-tier-info"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { SessionsChart } from "@/components/dashboard/sessions-chart"
import { RecommendationCard } from "@/components/dashboard/recommendation-card"
import { TierBadge } from "@/components/dashboard/tier-badge"
import { UsageWidget } from "@/components/dashboard/usage-widget"
import { TargetsList } from "@/components/dashboard/targets-list"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { YandexMetrika } from "@/components/yandex-metrika"
import { WebmonitorTracker } from "@/components/webmonitor-tracker"

export const metadata = {
  title: "Демо — Вебмонитор",
}

export const dynamic = "force-dynamic"

export default async function DemoPage() {
  const demoUserId = process.env.DEMO_USER_ID
  if (!demoUserId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* TEST: счётчик Метрики + наш трекер в фолбэк-ветках /demo. */}
        <YandexMetrika />
        <WebmonitorTracker />
        <Card>
          <CardContent className="max-w-md py-12 text-center">
            <p className="text-muted-foreground">
              Демо временно недоступно. Свяжитесь с поддержкой.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const data = await getDashboardData(demoUserId)

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* TEST: счётчик Метрики + наш трекер в фолбэк-ветках /demo. */}
        <YandexMetrika />
        <WebmonitorTracker />
        <Card>
          <CardContent className="max-w-md py-12 text-center">
            <p className="text-muted-foreground">
              Демо-данные не найдены. Запустите setup-public-demo скрипт.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* TEST: счётчик Метрики + наш трекер на публичном /demo. */}
      <YandexMetrika />
      <WebmonitorTracker />
      <div className="border-b bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-3 px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 shrink-0" />
            <p className="text-sm">
              <strong>Это демо-стенд Вебмонитора.</strong>{" "}
              Зарегистрируйтесь, чтобы получить персональный дашборд для своего сайта.
            </p>
          </div>
          <Button asChild variant="secondary" size="sm" className="shrink-0">
            <Link href="/signup">Зарегистрироваться</Link>
          </Button>
        </div>
      </div>

      <header className="border-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground">
              В
            </div>
            <span className="font-semibold">Вебмонитор</span>
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Войти</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Демо-дашборд</h1>
          <p className="mt-1 text-muted-foreground">
            Так выглядит ваш дашборд после подключения сайта. Сводка по {data.site.domain}.
          </p>
          <div className="mt-3">
            <TierBadge name={data.tier.name} price={data.tier.price} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <KpiCard
            title="Сессий записано"
            value={data.kpi.sessionsRecorded.toLocaleString("ru-RU")}
            description="Всего по сайту"
            icon={PlaySquare}
          />
          <KpiCard
            title="Рекомендаций получено"
            value={data.kpi.recommendationsReceived.toString()}
            description={`🔴 ${data.recPriorityReceived.CRITICAL} · 🟡 ${data.recPriorityReceived.IMPORTANT} · 🟢 ${data.recPriorityReceived.GOOD}`}
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

        <SessionsChart data={data.sessionsChart} />

        <TargetsList
          targets={data.activePageTargets}
          readyTargetIds={data.readyTargetIds}
          completedCount={data.completedPagesCount}
          canAddPage={data.canAddPage}
        />

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              Примеры рекомендаций
            </h2>
            <span className="text-sm text-muted-foreground">
              Что вебмонитор находит в поведении посетителей
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {data.recommendations.map((rec) => (
              <RecommendationCard key={rec.id} recommendation={rec} />
            ))}
          </div>
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-8 text-center">
            <h3 className="mb-2 text-xl font-semibold">
              Готовы получить такой дашборд для своего сайта?
            </h3>
            <p className="mb-4 text-muted-foreground">
              Бесплатная регистрация, демо-данные сразу после входа
            </p>
            <Button asChild size="lg">
              <Link href="/signup">Зарегистрироваться</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
