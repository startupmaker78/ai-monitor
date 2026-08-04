import Link from "next/link"
import type { SessionsForUser } from "@/lib/sessions-data"
import { GoalColumnInfo } from "./goal-column-info"
import { SessionRow } from "./session-row"

type Props = {
  sessions: SessionsForUser["sessions"]
  selectedSiteId: string | null
  selectedTargetId: string | null
  selectedGoal: string | null
  currentSort: "newest" | "oldest"
}

export function SessionsTable({
  sessions,
  selectedSiteId,
  selectedTargetId,
  selectedGoal,
  currentSort,
}: Props) {
  // «Страница» дублировалась бы в каждой строке при выбранном фильтре страницы
  // — прячем. При фильтре по действию страницы РАЗНЫЕ → колонку оставляем.
  const showTarget = selectedTargetId === null
  // «Целевое действие» постоянно и при фильтре страницы (одна страница), и при
  // фильтре действия (все = выбранное) — в обоих случаях колонка-дубль, прячем.
  const showGoal = selectedTargetId === null && selectedGoal === null

  function buildSortHref(targetSort: "newest" | "oldest"): string {
    const params = new URLSearchParams()
    if (selectedSiteId) params.set("site", selectedSiteId)
    if (selectedTargetId) params.set("targetId", selectedTargetId)
    if (selectedGoal) params.set("goal", selectedGoal)
    if (targetSort === "oldest") params.set("sort", "oldest")
    const qs = params.toString()
    return qs ? `?${qs}` : "/dashboard/sessions"
  }

  const nextSort: "newest" | "oldest" =
    currentSort === "newest" ? "oldest" : "newest"

  // Снимок серверного времени на момент рендера — для детерминированного
  // первого рендера SessionStatus (SSR===гидратация).
  const serverNowMs = Date.now()

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-3 font-medium">
              <Link
                href={buildSortHref(nextSort)}
                className="hover:text-foreground"
              >
                Дата начала {currentSort === "newest" ? "↓" : "↑"}
              </Link>
            </th>
            {/* «Устройство» — узкая колонка под иконку (w-px = по содержимому).
                Заголовок скрыт визуально, но остаётся для скринридеров. */}
            <th className="w-px px-3 py-3 font-medium">
              <span className="sr-only">Устройство</span>
            </th>
            <th className="px-3 py-3 font-medium">Длительность</th>
            <th className="px-3 py-3 font-medium">Активность</th>
            {showTarget && <th className="px-3 py-3 font-medium">Страница</th>}
            {showGoal && (
              <th className="px-3 py-3 font-medium">
                <span className="align-middle">Целевое действие страницы</span>
                <GoalColumnInfo />
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              s={s}
              showTarget={showTarget}
              showGoal={showGoal}
              serverNowMs={serverNowMs}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
