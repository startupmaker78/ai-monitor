import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getTargetsPageData } from "@/lib/targets-data"
import { getSelectedSiteId } from "@/lib/selected-site"
import { getMinSessionsBudget } from "@/lib/config"
import { Button } from "@/components/ui/button"
import { TargetsClient } from "./targets-client"

export const metadata = { title: "Цели анализа — Вебмонитор" }

type PageProps = {
  searchParams: { site?: string }
}

export default async function TargetsPage({ searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const siteId = await getSelectedSiteId(session.user.id, searchParams.site)
  const data = await getTargetsPageData(session.user.id, siteId ?? undefined)

  if (data.sites.length === 0 || !data.selectedSite) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          Цели анализа
        </h2>
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="mb-4 text-muted-foreground">
            Добавьте сайт, чтобы задавать цели анализа.
          </p>
          <Button asChild>
            <Link href="/dashboard/settings/sites">Добавить сайт</Link>
          </Button>
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
