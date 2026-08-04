import Link from "next/link"
import { Monitor, Smartphone, Tablet, Play } from "lucide-react"
import type { SessionsForUser, SessionListItem } from "@/lib/sessions-data"
import type { DeviceType } from "@/lib/device"
import { LocalDateTime } from "@/components/ui/local-date-time"
import { SessionStatus } from "@/components/ui/session-status"

type Props = {
  sessions: SessionsForUser["sessions"]
  selectedSiteId: string | null
  selectedTargetId: string | null
  currentSort: "newest" | "oldest"
  showSite: boolean
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

const DEVICE_META: Record<
  DeviceType,
  { Icon: typeof Monitor; label: string }
> = {
  desktop: { Icon: Monitor, label: "Компьютер" },
  mobile: { Icon: Smartphone, label: "Телефон" },
  tablet: { Icon: Tablet, label: "Планшет" },
}

function pluralAction(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return "действие"
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return "действия"
  return "действий"
}

// Активность = класс сессии (Фаза 1 вовлечённости). Несёт и «есть проблема»:
// bounce/passive = проблемная сессия. Не кричаще: только useful выделен.
function activity(s: SessionListItem): { text: string; className: string } {
  switch (s.sessionClass) {
    case "useful":
      return {
        text: `${s.interactionCount} ${pluralAction(s.interactionCount)}`,
        className: "text-foreground",
      }
    case "passive":
      return { text: "пассивный просмотр", className: "text-amber-700" }
    case "bounce":
      return { text: "отскок", className: "text-muted-foreground" }
    case "incomplete":
      return { text: "неполная запись", className: "text-muted-foreground" }
    default:
      return { text: "—", className: "text-muted-foreground" }
  }
}

export function SessionsTable({
  sessions,
  selectedSiteId,
  selectedTargetId,
  currentSort,
  showSite,
}: Props) {
  // Цель дублировала бы себя в каждой строке при выбранном фильтре — прячем.
  const showTarget = selectedTargetId === null

  function buildSortHref(targetSort: "newest" | "oldest"): string {
    const params = new URLSearchParams()
    if (selectedSiteId) params.set("site", selectedSiteId)
    if (selectedTargetId) params.set("targetId", selectedTargetId)
    if (targetSort === "oldest") params.set("sort", "oldest")
    const qs = params.toString()
    return qs ? `?${qs}` : "/dashboard/sessions"
  }

  const nextSort: "newest" | "oldest" =
    currentSort === "newest" ? "oldest" : "newest"

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
              <Link
                href={buildSortHref(nextSort)}
                className="hover:text-foreground"
              >
                Дата начала {currentSort === "newest" ? "↓" : "↑"}
              </Link>
            </th>
            <th className="px-4 py-3 font-medium">Устройство</th>
            <th className="px-4 py-3 font-medium">Длительность</th>
            <th className="px-4 py-3 font-medium">Активность</th>
            {showSite && <th className="px-4 py-3 font-medium">Сайт</th>}
            {showTarget && <th className="px-4 py-3 font-medium">Страница</th>}
            <th className="px-4 py-3 font-medium">Посетитель</th>
            <th className="px-4 py-3 font-medium text-right">Запись</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sessions.map((s) => {
            const device = DEVICE_META[s.deviceType]
            const act = activity(s)
            return (
              <tr key={s.id} className="hover:bg-muted/30">
                <td className="px-4 py-3 whitespace-nowrap">
                  <LocalDateTime value={s.startedAt} />
                </td>
                <td className="px-4 py-3">
                  <span title={device.label} className="inline-flex">
                    <device.Icon
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="sr-only">{device.label}</span>
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <SessionStatus
                    startedAtMs={s.startedAt.getTime()}
                    endedAtMs={s.endedAt ? s.endedAt.getTime() : null}
                    lastPacketAtMs={
                      s.lastPacketAt ? s.lastPacketAt.getTime() : null
                    }
                    serverNowMs={serverNowMs}
                  />
                </td>
                <td className={`px-4 py-3 whitespace-nowrap ${act.className}`}>
                  {act.text}
                </td>
                {showSite && (
                  <td className="px-4 py-3">
                    <span>{s.site.domain}</span>
                    {s.site.isDemo && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                        демо
                      </span>
                    )}
                  </td>
                )}
                {showTarget && (
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
                )}
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-muted-foreground">
                    {s.ipHash.slice(-8)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/dashboard/sessions/${s.id}`}
                    aria-label="Воспроизвести запись сессии"
                    title="Воспроизвести"
                    className="inline-flex items-center rounded-md border border-input bg-background p-1.5 hover:bg-accent"
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
