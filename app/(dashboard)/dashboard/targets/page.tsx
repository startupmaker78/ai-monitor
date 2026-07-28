import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getTargetsPageData } from "@/lib/targets-data"
import { getMinSessionsBudget } from "@/lib/config"
import { TargetsClient } from "./targets-client"
import { SiteSelector } from "../settings/metrika/site-selector"

export const metadata = { title: "Цели анализа — Вебмонитор" }

type PageProps = {
  searchParams: { site?: string }
}

export default async function TargetsPage({ searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const data = await getTargetsPageData(session.user.id, searchParams.site)

  if (data.sites.length === 0 || !data.selectedSite) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          Цели анализа
        </h2>
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            У вас пока нет сайтов. Управление сайтами появится в следующих
            обновлениях.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          Цели анализа
        </h2>
        {data.sites.length > 1 && (
          <SiteSelector
            sites={data.sites}
            selectedSiteId={data.selectedSite.id}
          />
        )}
      </div>

      <TargetsClient
        siteId={data.selectedSite.id}
        metrikaConfigured={data.selectedSite.metrikaConfigured}
        tier={data.tier}
        activeTargets={data.activeTargets}
        archivedTargets={data.archivedTargets}
        sessionsAllocated={data.sessionsAllocated}
        sessionsRemaining={data.sessionsRemaining}
        targetsRemaining={data.targetsRemaining}
        minSessionsBudget={getMinSessionsBudget()}
      />
    </div>
  )
}
