import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getSessionsForUser } from "@/lib/sessions-data"
import { SessionsTable } from "./sessions-table"
import { SiteFilter } from "./site-filter"
import { TargetFilter } from "./target-filter"

export const metadata = {
  title: "Сессии — Вебмонитор",
}

type PageProps = {
  searchParams: { site?: string; targetId?: string; sort?: string }
}

export default async function SessionsPage({ searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const sort: "newest" | "oldest" =
    searchParams.sort === "oldest" ? "oldest" : "newest"

  const data = await getSessionsForUser(session.user.id, {
    siteId: searchParams.site,
    targetId: searchParams.targetId,
    sort,
  })

  if (data.sites.length === 0) {
    return <EmptyNoSites />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">Сессии</h2>
        <div className="flex flex-wrap items-center gap-2">
          {data.sites.length > 1 && (
            <SiteFilter
              sites={data.sites}
              selectedSiteId={data.selectedSiteId}
              currentSort={sort}
            />
          )}
          <TargetFilter
            targets={data.targets}
            selectedTargetId={data.selectedTargetId}
            selectedSiteId={data.selectedSiteId}
            currentSort={sort}
          />
        </div>
      </div>

      {data.sessions.length === 0 ? (
        <EmptyNoSessions />
      ) : (
        <SessionsTable
          sessions={data.sessions}
          selectedSiteId={data.selectedSiteId}
          selectedTargetId={data.selectedTargetId}
          currentSort={sort}
          showSite={data.sites.length > 1}
        />
      )}
    </div>
  )
}

function EmptyNoSites() {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold tracking-tight">Сессии</h2>
      <div className="rounded-lg border bg-card p-8 text-center">
        <p className="text-muted-foreground">
          У вас пока нет сайтов. Управление сайтами появится в
          следующих обновлениях.
        </p>
      </div>
    </div>
  )
}

function EmptyNoSessions() {
  return (
    <div className="rounded-lg border bg-card p-8 text-center">
      <p className="mb-2 text-muted-foreground">Сессий ещё нет.</p>
      <p className="text-sm text-muted-foreground">
        Убедитесь, что трекер установлен на ваш сайт.
      </p>
    </div>
  )
}
