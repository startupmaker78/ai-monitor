import { prisma } from "@/lib/prisma"
import { DEMO_TIER, calculateDemoUsage } from "@/lib/demo-tier-info"

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

  const targets = await prisma.analysisTarget.findMany({
    where: { siteId: site.id },
    orderBy: [{ status: "asc" }, { sessionsCollected: "desc" }],
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
    tier: {
      name: DEMO_TIER.name,
      price: DEMO_TIER.pricePerMonth,
    },
    usage,
  }
}
