// Standalone smoke для lib/metrika-goals.ts. Read-only (боевой счётчик
// academy). Usage: dotenv -e .env.local -- tsx scripts/test-metrika-goals.ts
//
// Проверяет: список целей + сортировку, успешную конверсию, длинный путь
// (обрезка → glob), несуществующую цель (goal_deleted), искусственный
// mismatch (заведомо неверный путь при наличии наших сессий).
import * as dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { prisma } from "../lib/prisma"
import {
  fetchMetrikaGoals,
  fetchGoalReaches,
  sortAndGroupGoals,
  fetchGoalConversion,
} from "../lib/metrika-goals"

async function main() {
  const site = await prisma.site.findFirst({
    where: { domain: "academy.nolim.cc" },
    select: { id: true, metrikaCounterId: true, metrikaToken: true },
  })
  if (!site?.metrikaCounterId || !site.metrikaToken) {
    console.error("academy has no metrika creds")
    return
  }
  const counter = site.metrikaCounterId
  const token = site.metrikaToken
  const period = { from: "180daysAgo", to: "yesterday" }

  // 1) Список целей + сортировка
  console.log("=== 1) fetchMetrikaGoals + sort ===")
  const goalsRes = await fetchMetrikaGoals(counter, token)
  if (!goalsRes.ok) {
    console.error("goals failed:", goalsRes.reason)
    return
  }
  console.log(`goals total=${goalsRes.goals.length}`)
  const userIds = goalsRes.goals.filter((g) => g.source === "user").map((g) => g.id)
  const reaches = await fetchGoalReaches(counter, token, userIds, period)
  const grouped = sortAndGroupGoals(goalsRes.goals, reaches)
  console.log(`user=${grouped.user.length} auto=${grouped.auto.length}`)
  console.log("top-5 user by reaches:")
  for (const g of grouped.user.slice(0, 5)) {
    console.log(`  ${g.id} reaches=${reaches.get(g.id) ?? 0} [${g.type}] ${g.name}`)
  }

  // Целевые страницы из БД + наши числа
  const targets = await prisma.analysisTarget.findMany({
    where: { siteId: site.id, archivedAt: null },
    select: { id: true, url: true },
  })
  async function targetMeta(url: string) {
    const t = targets.find((x) => x.url === url)
    if (!t) return { start: new Date("2026-01-01"), count: 0 }
    const agg = await prisma.session.aggregate({
      where: { analysisTargetId: t.id },
      _min: { startedAt: true },
      _count: true,
    })
    return { start: agg._min.startedAt ?? new Date("2026-01-01"), count: agg._count }
  }

  const DUR_GOAL = "344662063" // visit_duration >1min — стреляет везде

  // 2) Успешная конверсия: короткий путь /tilda_free
  console.log("\n=== 2) success — /tilda_free (short path, exact) ===")
  {
    const m = await targetMeta("https://academy.nolim.cc/tilda_free")
    const c = await fetchGoalConversion(counter, token, {
      goalId: DUR_GOAL,
      targetUrl: "https://academy.nolim.cc/tilda_free",
      sessionWindowStart: m.start,
      ourSessionCount: m.count,
    })
    console.log(`ourSessions=${m.count} window=${m.start.toISOString().slice(0, 10)}..`)
    console.log("  result:", JSON.stringify(c))
  }

  // 3) Длинный путь с обрезкой → glob
  console.log("\n=== 3) long truncated path — /tpost/... (expect matchedBy=glob) ===")
  {
    const url = "https://academy.nolim.cc/tpost/ybya8n43e1-personalnii-lichnii-kabinet-dlya-klientov"
    const m = await targetMeta(url)
    const c = await fetchGoalConversion(counter, token, {
      goalId: DUR_GOAL,
      targetUrl: url,
      sessionWindowStart: m.start,
      ourSessionCount: m.count,
    })
    console.log(`ourSessions=${m.count} pathLen=${new URL(url).pathname.length}`)
    console.log("  result:", JSON.stringify(c))
  }

  // 4) Несуществующая цель → goal_deleted
  console.log("\n=== 4) nonexistent goal → goal_deleted ===")
  {
    const c = await fetchGoalConversion(counter, token, {
      goalId: "999999999",
      targetUrl: "https://academy.nolim.cc/tilda_free",
      sessionWindowStart: new Date("2026-07-15"),
      ourSessionCount: 30,
    })
    console.log("  result:", JSON.stringify(c))
  }

  // 5) Искусственный mismatch: заведомо несуществующий путь + наши сессии
  console.log("\n=== 5) artificial MISMATCH — bogus path, ourSessions=10 (expect reason=mismatch + log) ===")
  {
    const c = await fetchGoalConversion(counter, token, {
      goalId: DUR_GOAL,
      targetUrl: "https://academy.nolim.cc/this-page-definitely-does-not-exist-zzz",
      sessionWindowStart: new Date("2026-07-15"),
      ourSessionCount: 10,
    })
    console.log("  result:", JSON.stringify(c))
  }

  // 6) no_data: тот же bogus путь, но ourSessions=0 (expect no_data)
  console.log("\n=== 6) no_data — same bogus path, ourSessions=0 ===")
  {
    const c = await fetchGoalConversion(counter, token, {
      goalId: DUR_GOAL,
      targetUrl: "https://academy.nolim.cc/this-page-definitely-does-not-exist-zzz",
      sessionWindowStart: new Date("2026-07-15"),
      ourSessionCount: 0,
    })
    console.log("  result:", JSON.stringify(c))
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("FATAL:", e)
    await prisma.$disconnect().catch(() => {})
    process.exit(1)
  })
