import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { TargetConversion } from "@/lib/goal-conversion-data"

// Блок «сколько» (Path M). Два слоя РАЗДЕЛЕНЫ: это Метрика, анализ («почему»)
// — отдельным блоком ниже. Формулировка «из открывавших страницу — N% за
// визит» (Этап 0). Никогда не показывает 0% вместо ошибки.

// Тексты 7 состояний ошибок. Каждый говорит, что делать; ни один не звучит
// как «у вас 0».
const ERROR_TEXT: Record<string, string> = {
  goal_deleted:
    "Целевое действие удалено в Яндекс.Метрике. Выберите другое в настройках цели.",
  rate_limited:
    "Слишком много обращений к Метрике. Данные появятся через пару минут — обновите страницу.",
  metrika_unavailable:
    "Яндекс.Метрика временно недоступна. Данные появятся позже — обновите страницу.",
  no_data:
    "За выбранный период у этой страницы нет визитов в Метрике — конверсию посчитать не на чем.",
  // mismatch: направление клиенту (правка Этапа 3), без обвинения и без
  // утверждения, что визитов не было.
  mismatch:
    "Данные Метрики по этой странице не сходятся с нашими записями — разбираемся. Проверьте, не исключена ли эта страница фильтрами вашего счётчика Метрики.",
}

function fmtDate(s: string): string {
  // s = "YYYY-MM-DD" (date-only из Метрики, уже в календаре счётчика).
  // Форматируем в UTC — иначе зона браузера сдвинула бы дату на день.
  const d = new Date(s + "T00:00:00Z")
  if (isNaN(d.getTime())) return s
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d)
}

function periodLabel(p: { from: string; to: string; widened: boolean }): string {
  if (p.widened) {
    return "последние 90 дней (период расширен — за окно цели мало данных)"
  }
  return `${fmtDate(p.from)} — ${fmtDate(p.to)}`
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Конверсия по цели · Яндекс.Метрика
        </p>
        {children}
      </CardContent>
    </Card>
  )
}

export function ConversionBlock({
  conversion,
}: {
  conversion: TargetConversion
}) {
  if (conversion.state === "target_not_found") return null

  if (conversion.state === "not_configured") {
    return (
      <Shell>
        <p className="text-sm">
          Чтобы видеть конверсию по цели,{" "}
          <Link
            href="/dashboard/settings/metrika"
            className="font-medium underline underline-offset-2"
          >
            подключите Яндекс.Метрику
          </Link>
          .
        </p>
      </Shell>
    )
  }

  if (conversion.state === "not_set") {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          Целевое действие не задано.{" "}
          <Link
            href={`/dashboard/targets?site=${conversion.siteId}#target-${conversion.targetId}`}
            className="font-medium text-foreground underline underline-offset-2"
          >
            Выбрать целевое действие
          </Link>
        </p>
      </Shell>
    )
  }

  if (conversion.state === "error") {
    return (
      <Shell>
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {conversion.reason === "auth_failed" ? (
            <span>
              Токен Яндекс.Метрики истёк или недействителен. Обновите его в{" "}
              <Link
                href="/dashboard/settings/metrika"
                className="font-medium underline underline-offset-2"
              >
                Настройках → Метрика
              </Link>
              .
            </span>
          ) : conversion.reason === "counter_forbidden" ? (
            <span>
              Метрика отклонила запрос — токен может быть недействителен или у
              него нет доступа к этому счётчику. Проверьте токен и права в{" "}
              <Link
                href="/dashboard/settings/metrika"
                className="font-medium underline underline-offset-2"
              >
                Настройках → Метрика
              </Link>
              .
            </span>
          ) : (
            (ERROR_TEXT[conversion.reason] ?? "Не удалось получить конверсию.")
          )}
        </div>
      </Shell>
    )
  }

  // ok
  return (
    <Shell>
      <p className="text-lg font-semibold">
        Из открывавших страницу — {conversion.conversionRate.toFixed(1)}% за
        визит
      </p>
      <p className="text-sm text-muted-foreground">
        совершили «{conversion.goalName ?? "целевое действие"}»
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
        <span>Период: {periodLabel(conversion.period)}</span>
        <span>·</span>
        <span>{conversion.sampleVisits} визитов</span>
        {conversion.lowConfidence && (
          <Badge
            variant="outline"
            className="border-amber-300 bg-amber-50 text-amber-800"
          >
            ⚠ Мало данных
          </Badge>
        )}
      </div>
    </Shell>
  )
}
