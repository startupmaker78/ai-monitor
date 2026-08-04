import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getSessionsForUser } from "@/lib/sessions-data"
import { getSelectedSiteId } from "@/lib/selected-site"
import { SESSION_RETENTION_DAYS } from "@/lib/session-retention"
import { Button } from "@/components/ui/button"
import { SessionsTable } from "./sessions-table"
import { TargetFilter } from "./target-filter"
import { GoalFilter } from "./goal-filter"

export const metadata = {
  title: "Сессии — Вебмонитор",
}

type PageProps = {
  searchParams: { site?: string; targetId?: string; goal?: string; sort?: string }
}

export default async function SessionsPage({ searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const sort: "newest" | "oldest" =
    searchParams.sort === "oldest" ? "oldest" : "newest"

  // Сайт из глобального селектора (cookie) + опциональный ?site= override.
  const siteId = await getSelectedSiteId(session.user.id, searchParams.site)

  const data = await getSessionsForUser(session.user.id, {
    siteId: siteId ?? undefined,
    targetId: searchParams.targetId,
    goal: searchParams.goal,
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
          <TargetFilter
            targets={data.targets}
            selectedTargetId={data.selectedTargetId}
            selectedSiteId={data.selectedSiteId}
            selectedGoal={data.selectedGoal}
            currentSort={sort}
          />
          <GoalFilter
            goalActions={data.goalActions}
            selectedGoal={data.selectedGoal}
            selectedSiteId={data.selectedSiteId}
            selectedTargetId={data.selectedTargetId}
            currentSort={sort}
          />
        </div>
      </div>

      {data.sessions.length === 0 ? (
        <EmptyNoSessions />
      ) : (
        <>
          <SessionsTable
            sessions={data.sessions}
            selectedSiteId={data.selectedSiteId}
            selectedTargetId={data.selectedTargetId}
            selectedGoal={data.selectedGoal}
            currentSort={sort}
          />
          <p className="text-xs text-muted-foreground">
            Видеозаписи сессий хранятся {SESSION_RETENTION_DAYS} дней, затем
            удаляются автоматически. Рекомендации и метрики по сессиям
            сохраняются навсегда.
          </p>
        </>
      )}
    </div>
  )
}

function EmptyNoSites() {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold tracking-tight">Сессии</h2>
      <div className="rounded-lg border bg-card p-8 text-center">
        <p className="mb-4 text-muted-foreground">
          Добавьте сайт, чтобы Вебмонитор начал собирать сессии.
        </p>
        <Button asChild>
          <Link href="/dashboard/settings/sites">Добавить сайт</Link>
        </Button>
      </div>
    </div>
  )
}

function EmptyNoSessions() {
  return (
    <div className="rounded-lg border bg-card p-8 text-center">
      <p className="mb-2 text-muted-foreground">Сессий ещё нет.</p>
      <p className="mb-4 text-sm text-muted-foreground">
        Убедитесь, что код трекера установлен на ваш сайт.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/dashboard/settings/sites">Открыть код трекера</Link>
      </Button>
    </div>
  )
}
