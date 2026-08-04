"use client"

import { useRouter } from "next/navigation"
import { Monitor, Smartphone, Tablet } from "lucide-react"
import type { SessionListItem } from "@/lib/sessions-data"
import type { DeviceType } from "@/lib/device"
import { LocalDateTime } from "@/components/ui/local-date-time"
import { SessionStatus } from "@/components/ui/session-status"

const DEVICE_META: Record<DeviceType, { Icon: typeof Monitor; label: string }> =
  {
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

function activity(s: SessionListItem): { text: string; className: string } {
  switch (s.sessionClass) {
    case "useful":
      return {
        text: `${s.interactionCount} ${pluralAction(s.interactionCount)}`,
        className: "text-foreground",
      }
    case "passive":
      return { text: "пассивно", className: "text-amber-700" }
    case "bounce":
      return { text: "отскок", className: "text-muted-foreground" }
    case "incomplete":
      return { text: "неполная", className: "text-muted-foreground" }
    default:
      return { text: "—", className: "text-muted-foreground" }
  }
}

// Клик по всей строке открывает запись (отдельной колонки-кнопки нет). role +
// tabIndex + Enter/Space — доступность как у ссылки.
export function SessionRow({
  s,
  showTarget,
  showGoal,
  serverNowMs,
}: {
  s: SessionListItem
  showTarget: boolean
  showGoal: boolean
  serverNowMs: number
}) {
  const router = useRouter()
  const href = `/dashboard/sessions/${s.id}`
  const device = DEVICE_META[s.deviceType]
  const act = activity(s)

  return (
    <tr
      role="link"
      tabIndex={0}
      aria-label="Открыть запись сессии"
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          router.push(href)
        }
      }}
      className="cursor-pointer hover:bg-muted/30 focus:bg-muted/40 focus:outline-none"
    >
      <td className="px-3 py-3 whitespace-nowrap">
        <LocalDateTime value={s.startedAt} />
      </td>
      <td className="w-px px-3 py-3">
        <span title={device.label} className="inline-flex">
          <device.Icon
            className="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="sr-only">{device.label}</span>
        </span>
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <SessionStatus
          startedAtMs={s.startedAt.getTime()}
          endedAtMs={s.endedAt ? s.endedAt.getTime() : null}
          lastPacketAtMs={s.lastPacketAt ? s.lastPacketAt.getTime() : null}
          serverNowMs={serverNowMs}
        />
      </td>
      <td className={`px-3 py-3 whitespace-nowrap ${act.className}`}>
        {act.text}
      </td>
      {showTarget && (
        <td className="px-3 py-3">
          {s.analysisTarget ? (
            <span
              title={s.analysisTarget.name ?? s.analysisTarget.url}
              className="block max-w-[16rem] truncate"
            >
              {s.analysisTarget.name ?? s.analysisTarget.url}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      )}
      {showGoal && (
        <td className="px-3 py-3">
          {s.analysisTarget?.metrikaGoalName ? (
            <span
              title={s.analysisTarget.metrikaGoalName}
              className="block max-w-[11rem] truncate text-muted-foreground"
            >
              {s.analysisTarget.metrikaGoalName}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      )}
    </tr>
  )
}
