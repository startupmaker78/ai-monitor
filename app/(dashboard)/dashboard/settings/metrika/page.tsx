import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getOwnerSitesByUserId } from "@/lib/site-data"
import { getSelectedSiteId } from "@/lib/selected-site"
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
          <p className="text-muted-foreground">
            У вас пока нет сайтов. Управление сайтами появится в
            следующих обновлениях.
          </p>
        </div>
      </div>
    )
  }

  // Сайт из глобального селектора (cookie) — локальный переключатель убран.
  const selectedId = await getSelectedSiteId(session.user.id, searchParams.site)
  const selectedSite = sites.find((s) => s.id === selectedId) ?? sites[0]

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          Яндекс.Метрика
        </h2>
      </div>

      <MetrikaForm
        siteId={selectedSite.id}
        siteDomain={selectedSite.domain}
        isDemo={selectedSite.isDemo}
        initialCounterId={selectedSite.metrikaCounterId ?? ""}
        initialTokenSet={Boolean(selectedSite.metrikaToken)}
      />
    </div>
  )
}
