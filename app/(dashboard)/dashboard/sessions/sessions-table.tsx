import Link from "next/link"
import type { SessionsForUser } from "@/lib/sessions-data"
import { LocalDateTime } from "@/components/ui/local-date-time"
import { SessionStatus } from "@/components/ui/session-status"

type Props = {
  sessions: SessionsForUser["sessions"]
  selectedSiteId: string | null
  currentSort: "newest" | "oldest"
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

export function SessionsTable({ sessions, selectedSiteId, currentSort }: Props) {
  function buildSortHref(targetSort: "newest" | "oldest"): string {
    const params = new URLSearchParams()
    if (selectedSiteId) params.set("site", selectedSiteId)
    if (targetSort === "oldest") params.set("sort", "oldest")
    const qs = params.toString()
    return qs ? `?${qs}` : "/dashboard/sessions"
  }

  const nextSort: "newest" | "oldest" = currentSort === "newest" ? "oldest" : "newest"

  // Снимок серверного времени на момент рендера — передаём в SessionStatus
  // для детерминированного первого рендера (SSR===гидратация). На клиенте
  // компонент дальше считает по своему Date.now().
  const serverNowMs = Date.now()

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">
              <Link href={buildSortHref(nextSort)} className="hover:text-foreground">
                Дата начала {currentSort === "newest" ? "↓" : "↑"}
              </Link>
            </th>
            <th className="px-4 py-3 font-medium">Длительность</th>
            <th className="px-4 py-3 font-medium">Сайт</th>
            <th className="px-4 py-3 font-medium">Цель</th>
            <th className="px-4 py-3 font-medium text-right">События</th>
            <th className="px-4 py-3 font-medium">Посетитель</th>
            <th className="px-4 py-3 font-medium text-right">Действие</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sessions.map((s) => (
            <tr key={s.id} className="hover:bg-muted/30">
              <td className="px-4 py-3 whitespace-nowrap">
                <LocalDateTime value={s.startedAt} />
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <SessionStatus
                  startedAtMs={s.startedAt.getTime()}
                  endedAtMs={s.endedAt ? s.endedAt.getTime() : null}
                  lastPacketAtMs={s.lastPacketAt ? s.lastPacketAt.getTime() : null}
                  serverNowMs={serverNowMs}
                />
              </td>
              <td className="px-4 py-3">
                <span>{s.site.domain}</span>
                {s.site.isDemo && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                    демо
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                {s.analysisTarget ? (
                  <span title={s.analysisTarget.url}>
                    {truncate(
                      s.analysisTarget.name ?? s.analysisTarget.url,
                      40,
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {s.eventsCount.toLocaleString("ru-RU")}
              </td>
              <td className="px-4 py-3">
                <span className="font-mono text-xs text-muted-foreground">
                  {s.ipHash.slice(-8)}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/dashboard/sessions/${s.id}`}
                  className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs hover:bg-accent"
                >
                  Воспроизвести
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
