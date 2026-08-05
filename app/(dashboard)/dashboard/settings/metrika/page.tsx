import Link from "next/link"
import { redirect } from "next/navigation"
import { HelpCircle } from "lucide-react"
import { auth } from "@/auth"
import { getOwnerSitesByUserId } from "@/lib/site-data"
import { getSelectedSiteId } from "@/lib/selected-site"
import { guideHref } from "@/lib/guide-anchors"
import { Button } from "@/components/ui/button"
import { SyncButton } from "@/components/dashboard/sync-button"
import { MetrikaForm } from "./metrika-form"

export const metadata = {
  title: "Яндекс.Метрика — Вебмонитор",
}

type PageProps = {
  searchParams: { site?: string }
}

export default async function MetrikaSettingsPage({ searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const sites = await getOwnerSitesByUserId(session.user.id)

  if (sites.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          Яндекс.Метрика
        </h2>
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="mb-4 text-muted-foreground">
            Сначала добавьте сайт — Метрика подключается к конкретному сайту.
          </p>
          <Button asChild>
            <Link href="/dashboard/settings/sites">Добавить сайт</Link>
          </Button>
        </div>
      </div>
    )
  }

  // Сайт из глобального селектора (cookie) — локальный переключатель убран.
  const selectedId = await getSelectedSiteId(session.user.id, searchParams.site)
  const selectedSite = sites.find((s) => s.id === selectedId) ?? sites[0]

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          Яндекс.Метрика
        </h2>
        <Link
          href={guideHref("token")}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <HelpCircle className="h-4 w-4 shrink-0" />
          Как получить токен — гайд
        </Link>
      </div>

      <MetrikaForm
        siteId={selectedSite.id}
        siteDomain={selectedSite.domain}
        isDemo={selectedSite.isDemo}
        initialCounterId={selectedSite.metrikaCounterId ?? ""}
        initialTokenSet={Boolean(selectedSite.metrikaToken)}
      />

      {/* Ручное обновление данных Метрики. Перенесено с главной (там было
          шумом): по смыслу — рядом с настройкой Метрики. Данные снапшотов
          (визиты/отказы/конверсия) идут в AI-анализ, поэтому кнопку не убираем,
          только переносим — ночного крона мало, нужен ручной триггер (например,
          сразу после подключения счётчика). Показываем только когда Метрика
          подключена (иначе кнопка вела бы «Настроить» на эту же страницу). */}
      {Boolean(selectedSite.metrikaCounterId && selectedSite.metrikaToken) && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">Данные Метрики</p>
              <p className="text-sm text-muted-foreground">
                Обновляются автоматически раз в сутки. Можно обновить вручную —
                например, сразу после подключения счётчика.
              </p>
            </div>
            <SyncButton siteId={selectedSite.id} metrikaConfigured />
          </div>
        </div>
      )}
    </div>
  )
}
