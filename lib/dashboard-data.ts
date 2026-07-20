import { prisma } from "@/lib/prisma"
import { DEMO_TIER, calculateDemoUsage } from "@/lib/demo-tier-info"
import {
  classifySession,
  type SessionClass,
} from "@/lib/session-classification"

export async function getDashboardData(userId: string) {
  const ownerProfile = await prisma.ownerProfile.findUnique({
    where: { userId },
    include: {
      sites: {
        // Defensive фильтр isDemo=false: после cleanup demo-Sites не должно
        // быть, но если что-то осталось — не показываем на дашборде.
        where: { isDemo: false },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  })

  if (!ownerProfile || ownerProfile.sites.length === 0) {
    return null
  }

  const site = ownerProfile.sites[0]

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7)
  sevenDaysAgo.setUTCHours(0, 0, 0, 0)

  const recentSnapshots = await prisma.metricsSnapshot.findMany({
    where: {
      siteId: site.id,
      date: { gte: sevenDaysAgo },
    },
    orderBy: { date: "asc" },
  })

  const totalVisits7d = recentSnapshots.reduce((sum, s) => sum + s.visits, 0)
  const totalConversions7d = recentSnapshots.reduce(
    (sum, s) => sum + s.conversions,
    0,
  )
  const avgConversionRate =
    totalVisits7d > 0 ? (totalConversions7d / totalVisits7d) * 100 : 0
  const avgDuration =
    recentSnapshots.length > 0
      ? Math.round(
          recentSnapshots.reduce((sum, s) => sum + s.avgSessionDuration, 0) /
            recentSnapshots.length,
        )
      : 0

  const allSnapshots = await prisma.metricsSnapshot.findMany({
    where: { siteId: site.id },
    orderBy: { date: "asc" },
    select: {
      date: true,
      visits: true,
      conversions: true,
    },
  })

  // NB: список `recommendations` (ниже) на РЕАЛЬНОМ дашборде больше не
  // показывается (блок «Топ-10» убран — врал: ≠10 и смешивал рекомендации
  // разных целей). Но `getDashboardData` разделяется с ДЕМО-страницей
  // (app/demo/page.tsx), которая всё ещё рендерит рекомендации как
  // showcase — поэтому запрос СОХРАНЁН. Место для реальных рекомендаций —
  // /dashboard/recommendations (per-target дропдаун).
  const topRecommendations = await prisma.recommendation.findMany({
    where: {
      analysis: { siteId: site.id },
      status: { in: ["NEW", "IN_PROGRESS"] },
    },
    orderBy: [{ priority: "asc" }, { sortOrder: "asc" }],
    take: 20,
    include: {
      analysis: {
        include: { target: true },
      },
    },
  })

  const priorityOrder: Record<string, number> = {
    CRITICAL: 0,
    IMPORTANT: 1,
    GOOD: 2,
  }
  topRecommendations.sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 99
    const pb = priorityOrder[b.priority] ?? 99
    if (pa !== pb) return pa - pb
    return a.sortOrder - b.sortOrder
  })

  const priorityCounts = await prisma.recommendation.groupBy({
    by: ["priority"],
    where: {
      analysis: { siteId: site.id },
      status: { in: ["NEW", "IN_PROGRESS"] },
    },
    _count: true,
  })

  const counts = {
    CRITICAL:
      priorityCounts.find((p) => p.priority === "CRITICAL")?._count ?? 0,
    IMPORTANT:
      priorityCounts.find((p) => p.priority === "IMPORTANT")?._count ?? 0,
    GOOD: priorityCounts.find((p) => p.priority === "GOOD")?._count ?? 0,
  }

  const totalActive = counts.CRITICAL + counts.IMPORTANT + counts.GOOD

  // archivedAt: null — на дашборде (и демо) показываем только АКТИВНЫЕ
  // цели. Архивные (напр. дубли «Главная» или цели с чужим URL) иначе
  // мешаются в общем списке без пометки. Полный список с секцией
  // «Архивированные» — на /dashboard/targets. Консистентно с
  // targets-data (activeTargets/archivedTargets split, фикс 2026-07-15).
  const targets = await prisma.analysisTarget.findMany({
    where: { siteId: site.id, archivedAt: null },
    orderBy: [{ status: "asc" }, { sessionsCollected: "desc" }],
  })

  // ── Вовлечённость страниц (Фаза 2). Классифицируем сессии активных
  // целей ПО ДЕНОРМАЛИЗОВАННЫМ ПОЛЯМ (interactionCount/hasFullSnapshot/
  // eventsCount, Фаза 1) — БЕЗ чтения S3. Через общий classifySession,
  // чтобы определение совпадало с collect/бэкфиллом. Вовлечённость% =
  // useful/(useful+passive+bounce) = доля РЕАЛЬНЫХ визитов (incomplete —
  // боты/мгновенный уход — исключены, показаны сноской в UI).
  // NB: тянем строки и считаем в JS (не raw-CASE), чтобы НЕ дублировать
  // определение classifySession в SQL. Для MVP-объёмов дёшево; на крупных
  // сайтах можно вынести в агрегат позже.
  const activeTargetIds = targets.map((t) => t.id)
  const engagementSessions =
    activeTargetIds.length > 0
      ? await prisma.session.findMany({
          where: {
            siteId: site.id,
            analysisTargetId: { in: activeTargetIds },
          },
          select: {
            analysisTargetId: true,
            interactionCount: true,
            hasFullSnapshot: true,
            eventsCount: true,
          },
        })
      : []

  const tallyByTarget = new Map<string, Record<SessionClass, number>>()
  for (const t of targets) {
    tallyByTarget.set(t.id, { useful: 0, passive: 0, bounce: 0, incomplete: 0 })
  }
  for (const s of engagementSessions) {
    if (!s.analysisTargetId) continue
    const tally = tallyByTarget.get(s.analysisTargetId)
    if (!tally) continue
    const cls = classifySession({
      interactionCount: s.interactionCount,
      hasFullSnapshot: s.hasFullSnapshot,
      eventsCount: s.eventsCount,
    })
    tally[cls]++
  }

  const engagement = targets.map((t) => {
    const c = tallyByTarget.get(t.id) ?? {
      useful: 0,
      passive: 0,
      bounce: 0,
      incomplete: 0,
    }
    const realVisits = c.useful + c.passive + c.bounce
    return {
      targetId: t.id,
      name: t.name,
      url: t.url,
      useful: c.useful,
      passive: c.passive,
      bounce: c.bounce,
      incomplete: c.incomplete,
      total: realVisits + c.incomplete,
      realVisits,
      // null = нет реальных визитов → «нет данных» в UI, а не «0%».
      engagementPct:
        realVisits > 0 ? Math.round((c.useful / realVisits) * 100) : null,
    }
  })

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const analysesThisMonth = await prisma.analysis.count({
    where: {
      siteId: site.id,
      createdAt: { gte: monthStart },
    },
  })

  const usage = calculateDemoUsage(targets, analysesThisMonth)

  return {
    site,
    // hasMetrics=false означает что Site есть, но MetricsSnapshot ещё не
    // накопились — Метрика не подключена либо первый sync не сработал.
    // Frontend показывает банер «Ждём первых данных» сверху дашборда.
    hasMetrics: allSnapshots.length > 0,
    kpi: {
      totalVisits7d,
      avgConversionRate,
      avgDuration,
      totalActive,
    },
    chart: allSnapshots.map((s) => ({
      date: s.date.toISOString().split("T")[0],
      visits: s.visits,
      conversions: s.conversions,
    })),
    recommendations: topRecommendations.slice(0, 10),
    priorityCounts: counts,
    targets,
    engagement,
    tier: {
      name: DEMO_TIER.name,
      price: DEMO_TIER.pricePerMonth,
    },
    usage,
  }
}
