import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { loadOwnedSession } from "@/lib/sessions-data"
import { LocalDateTime } from "@/components/ui/local-date-time"
import { SessionStatus } from "@/components/ui/session-status"
import { SessionPlayer } from "./session-player"

export const metadata = { title: "Воспроизведение сессии — Вебмонитор" }

type PageProps = { params: { id: string } }

export default async function SessionPlayerPage({ params }: PageProps) {
  const sessionAuth = await auth()
  if (!sessionAuth?.user?.id) redirect("/login")

  const owned = await loadOwnedSession(params.id, sessionAuth.user.id)
  if (!owned || !owned.storageKey) notFound()

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/sessions"
        className="inline-flex text-sm text-muted-foreground hover:text-foreground"
      >
        ← Назад к сессиям
      </Link>

      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Воспроизведение сессии
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <LocalDateTime value={owned.startedAt} /> ·{" "}
          <SessionStatus
            startedAtMs={owned.startedAt.getTime()}
            endedAtMs={owned.endedAt ? owned.endedAt.getTime() : null}
            lastPacketAtMs={owned.lastPacketAt ? owned.lastPacketAt.getTime() : null}
            serverNowMs={Date.now()}
          />{" "}
          · {owned.eventsCount.toLocaleString("ru-RU")} событий ·{" "}
          сайт {owned.site.domain} ·{" "}
          посетитель …{owned.ipHash.slice(-8)}
          {owned.analysisTarget && (
            <>
              {" · "}страница:{" "}
              <span className="font-mono text-xs">
                {owned.analysisTarget.url}
              </span>
            </>
          )}
        </p>
      </div>

      <SessionPlayer
        sessionId={owned.id}
        active={owned.endedAt === null}
      />
    </div>
  )
}
