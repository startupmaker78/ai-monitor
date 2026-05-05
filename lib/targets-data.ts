import { prisma } from "@/lib/prisma"
import { getOwnerSitesByUserId } from "@/lib/site-data"
import { getEffectiveTier, type TierConfig } from "@/lib/tier-limits"

export type TargetWithStats = {
  id: string
  url: string
  name: string | null
  status: string
  sessionsCollected: number
  sessionsBudget: number
  budgetSpent: boolean
  archivedAt: Date | null
  createdAt: Date
}

export type TargetsPageData = {
  sites: Array<{ id: string; domain: string; isDemo: boolean }>
  selectedSite: { id: string; domain: string; isDemo: boolean } | null
  tier: TierConfig
  activeTargets: TargetWithStats[]
  archivedTargets: TargetWithStats[]
  // Расчётные значения для header'а формы.
  sessionsAllocated: number
  sessionsRemaining: number
  targetsRemaining: number
}

export async function getTargetsPageData(
  userId: string,
  requestedSiteId?: string,
): Promise<TargetsPageData> {
  const sites = await getOwnerSitesByUserId(userId)
  const tier = await getEffectiveTier(userId)

  if (sites.length === 0) {
    return {
      sites: [],
      selectedSite: null,
      tier,
      activeTargets: [],
      archivedTargets: [],
      sessionsAllocated: 0,
      sessionsRemaining: tier.sessionsLimit,
      targetsRemaining: tier.targetsLimit,
    }
  }

  const selectedSite =
    sites.find((s) => s.id === requestedSiteId) ?? sites[0]

  const allTargets = await prisma.analysisTarget.findMany({
    where: { siteId: selectedSite.id },
    orderBy: [
      { archivedAt: "asc" }, // null (active) выше
      { createdAt: "desc" },
    ],
    select: {
      id: true,
      url: true,
      name: true,
      status: true,
      sessionsCollected: true,
      sessionsBudget: true,
      budgetSpent: true,
      archivedAt: true,
      createdAt: true,
    },
  })

  const activeTargets = allTargets.filter((t) => t.archivedAt === null)
  const archivedTargets = allTargets.filter((t) => t.archivedAt !== null)

  // Бюджет занят если: цель активна (archivedAt IS NULL) ИЛИ анализ уже
  // был запущен (budgetSpent=true). budgetSpent ставится при запуске
  // анализа (status → ANALYZING) и больше никогда не снимается.
  // Архивация цели где budgetSpent=true НЕ возвращает бюджет (анализ уже
  // потрачен). См. DECISIONS.md "2026-05-05 — Hotfix 4: AnalysisTarget
  // .budgetSpent — правильная модель бюджета".
  const allocatingTargets = allTargets.filter(
    (t) => t.archivedAt === null || t.budgetSpent === true,
  )
  const sessionsAllocated = allocatingTargets.reduce(
    (sum, t) => sum + t.sessionsBudget,
    0,
  )

  return {
    sites: sites.map((s) => ({
      id: s.id,
      domain: s.domain,
      isDemo: s.isDemo,
    })),
    selectedSite: {
      id: selectedSite.id,
      domain: selectedSite.domain,
      isDemo: selectedSite.isDemo,
    },
    tier,
    activeTargets,
    archivedTargets,
    sessionsAllocated,
    sessionsRemaining: tier.sessionsLimit - sessionsAllocated,
    targetsRemaining: tier.targetsLimit - activeTargets.length,
  }
}
