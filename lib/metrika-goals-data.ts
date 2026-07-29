import { prisma } from "@/lib/prisma"
import { validateSiteOwnership } from "@/lib/site-data"
import { normalizeUrl } from "@/lib/url-normalize"
import {
  fetchMetrikaGoals,
  fetchGoalReaches,
  fetchGoalRelevance,
  sortAndGroupGoals,
  type MetrikaGoal,
  type GoalRelevance,
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

  // Достижения тянем для user-целей + ИЗБРАННЫХ авто (они поднимаются в
  // видимый список → нужны для сортировки и честного числа). Авто-не-избранные
  // (свёрнутая группа) — не считаем. ⚠️ TODO: на счётчике под лимит 200 целей
  // это до ~10 батчей (≤20 метрик/запрос) при открытии — держим в уме, при
  // появлении таких счётчиков перейти на ленивый/параллельный подсчёт.
  const reachIds = goalsRes.goals
    .filter((g) => g.source === "user" || g.isFavorite)
    .map((g) => g.id)
  const reaches = await fetchGoalReaches(
    site.metrikaCounterId,
    site.metrikaToken,
    reachIds,
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

// Релевантность цели странице (вариант C, 3 вызова Метрики). Токен не наружу.
// Возвращает null при отсутствии доступа/конфигурации/ошибке Метрики — UI
// тогда просто не показывает инфо-строку (это доп. данные, не критично).
export async function getGoalRelevance(
  userId: string,
  siteId: string,
  goalId: string,
  pageUrl: string,
): Promise<GoalRelevance | null> {
  const owns = await validateSiteOwnership(siteId, userId)
  if (!owns) return null
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { metrikaCounterId: true, metrikaToken: true },
  })
  if (!site?.metrikaCounterId || !site.metrikaToken) return null
  const normalized = normalizeUrl(pageUrl)
  if (!normalized) return null
  let path: string
  try {
    path = new URL(normalized).pathname
  } catch {
    return null
  }
  const rel = await fetchGoalRelevance(
    site.metrikaCounterId,
    site.metrikaToken,
    goalId,
    path,
  )
  // Читаемое имя topOther: название цели сайта, если topOther совпал с её URL
  // (в т.ч. по префиксу — Метрика обрезает длинные пути), иначе последний
  // сегмент slug (честнее выдуманного). Закрывает TODO про длинный путь.
  if (rel?.topOther) {
    rel.topOther.label = await resolveTopOtherLabel(siteId, rel.topOther.path)
  }
  return rel
}

function normPathLocal(p: string): string {
  const b = p.split("#")[0].split("?")[0].toLowerCase()
  return b.length > 1 && b.endsWith("/") ? b.slice(0, -1) : b
}

function lastSegment(path: string): string {
  const segs = normPathLocal(path).split("/").filter(Boolean)
  return segs.length ? segs[segs.length - 1] : path
}

async function resolveTopOtherLabel(
  siteId: string,
  otherPath: string,
): Promise<string> {
  const op = normPathLocal(otherPath)
  const targets = await prisma.analysisTarget.findMany({
    where: { siteId, name: { not: null } },
    select: { url: true, name: true },
  })
  for (const t of targets) {
    const n = normalizeUrl(t.url)
    if (!n) continue
    let tp: string
    try {
      tp = normPathLocal(new URL(n).pathname)
    } catch {
      continue
    }
    // exact или префикс (наш полный путь начинается с обрезанного Метрикой).
    if ((tp === op || tp.startsWith(op)) && t.name) return t.name
  }
  return lastSegment(otherPath)
}
