import Link from "next/link"
import { redirect } from "next/navigation"
import { CheckCircle2 } from "lucide-react"
import { auth } from "@/auth"
import { getDashboardData } from "@/lib/dashboard-data"
import { getSelectedSiteId } from "@/lib/selected-site"
import { DEMO_TIER } from "@/lib/demo-tier-info"
import { SESSION_RETENTION_DAYS } from "@/lib/session-retention"
import { UsageWidget } from "@/components/dashboard/usage-widget"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export const metadata = { title: "Тарифы — Вебмонитор" }

// Состав тарифа ПО СМЫСЛУ (что покупает клиент), а не счётчики штук — числа
// отдельно, в UsageWidget ниже. Ретеншн назван явно: это часть того, за что
// платят (записи не вечны). 30 берём из общего источника, не хардкодим.
const INCLUDED = [
  "Запись сессий посетителей на выбранных страницах — видно, как они кликают, скроллят и заполняют формы.",
  "AI-анализ поведения и рекомендации: что мешает конверсии и что конкретно исправить.",
  "Метрика вовлечённости страниц — доля осмысленных визитов против отказов и ботов.",
  "Конверсия по целевому действию из Яндекс.Метрики — какой процент посетителей доходит до цели.",
  `Записи сессий хранятся ${SESSION_RETENTION_DAYS} дней; рекомендации и метрики — бессрочно.`,
]

export default async function TariffPage({
  searchParams,
}: {
  searchParams: { site?: string }
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  // Тот же источник, что на главной (getDashboardData) — счётчики сойдутся.
  const siteId = await getSelectedSiteId(session.user.id, searchParams.site)
  const data = await getDashboardData(session.user.id, siteId ?? undefined)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href="/dashboard/settings"
          className="inline-flex text-sm text-muted-foreground hover:text-foreground"
        >
          ← Настройки
        </Link>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Тарифы</h2>
      </div>

      {/* Тариф + СОСТАВ (что входит). Не зависит от сайта — виден всегда. */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Тариф «{DEMO_TIER.name}»</CardTitle>
            <span className="text-lg font-semibold">
              {DEMO_TIER.pricePerMonth.toLocaleString("ru-RU")} ₽/мес
            </span>
          </div>
          <CardDescription>Что входит в тариф</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2.5">
            {INCLUDED.map((line) => (
              <li key={line} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Счётчики с остатками — ТОТ ЖЕ UsageWidget, что на главной. */}
      {data ? (
        <UsageWidget
          usage={data.usage}
          tierName={data.tier.name}
          tierLimits={{
            targetsLimit: DEMO_TIER.targetsLimit,
            analysesPerMonth: DEMO_TIER.analysesPerMonth,
            sessionsLimit: DEMO_TIER.sessionsLimit,
          }}
        />
      ) : (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Подключите сайт, чтобы увидеть остаток лимитов.{" "}
            <Link
              href="/dashboard/settings/sites"
              className="font-medium text-primary hover:underline"
            >
              Добавить сайт →
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
