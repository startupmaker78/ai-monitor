import { prisma } from "@/lib/prisma"
import { validateSiteOwnership } from "@/lib/site-data"
import {
  fetchMetrikaGoals,
  fetchGoalReaches,
  sortAndGroupGoals,
  type MetrikaGoal,
} from "@/lib/metrika-goals"

// Серверный data-слой над lib/metrika-goals: грузит цели счётчика для UI
// (дропдаун выбора действия) и резолвит одну цель при сохранении.
// ⚠️ Токен читается из БД ЗДЕСЬ и НИКОГДА не возвращается наружу — в клиент
// уходят только id/name/type/reaches (проверено grep'ом, см. отчёт Этапа 3).

// Цель + число достижений за период (для сортировки/показа в дропдауне).
export type GoalWithReaches = MetrikaGoal & { reaches: number }

export type SiteGoalsResult =
  | { ok: true; user: GoalWithReaches[]; auto: GoalWithReaches[] }
  | {
      ok: false
      reason:
        | "forbidden"
        | "not_configured"
        | "auth_failed"
        | "counter_forbidden"
        | "rate_limited"
        | "metrika_unavailable"
    }

const REACHES_PERIOD = { from: "180daysAgo", to: "yesterday" }

export async function getGoalsForSite(
  userId: string,
  siteId: string,
): Promise<SiteGoalsResult> {
  const owns = await validateSiteOwnership(siteId, userId)
  if (!owns) return { ok: false, reason: "forbidden" }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { metrikaCounterId: true, metrikaToken: true },
  })
  if (!site?.metrikaCounterId || !site.metrikaToken) {
    return { ok: false, reason: "not_configured" }
  }

  const goalsRes = await fetchMetrikaGoals(site.metrikaCounterId, site.metrikaToken)
  if (!goalsRes.ok) return { ok: false, reason: goalsRes.reason }

  const userIds = goalsRes.goals
    .filter((g) => g.source === "user")
    .map((g) => g.id)
  const reaches = await fetchGoalReaches(
    site.metrikaCounterId,
    site.metrikaToken,
    userIds,
    REACHES_PERIOD,
  )
  const grouped = sortAndGroupGoals(goalsRes.goals, reaches)
  const attach = (g: MetrikaGoal): GoalWithReaches => ({
    ...g,
    reaches: reaches.get(g.id) ?? 0,
  })
  return { ok: true, user: grouped.user.map(attach), auto: grouped.auto.map(attach) }
}

// Резолвит goalId в авторитетные name/type ИЗ Метрики (не доверяем клиенту).
// Используется при сохранении действия (setTargetGoal / createTarget).
export async function resolveGoalForSite(
  userId: string,
  siteId: string,
  goalId: string,
): Promise<
  | { ok: true; name: string; type: string }
  | { ok: false; reason: "forbidden" | "not_configured" | "goal_not_found" | "metrika_unavailable" | "auth_failed" | "counter_forbidden" | "rate_limited" }
> {
  const goals = await getGoalsForSite(userId, siteId)
  if (!goals.ok) {
    // forbidden/not_configured/auth_failed/... пробрасываем как есть.
    return { ok: false, reason: goals.reason }
  }
  const all = [...goals.user, ...goals.auto]
  const found = all.find((g) => g.id === goalId)
  if (!found) return { ok: false, reason: "goal_not_found" }
  return { ok: true, name: found.name, type: found.type }
}
