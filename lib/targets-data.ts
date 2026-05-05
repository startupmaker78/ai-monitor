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
      archivedAt: true,
      createdAt: true,
    },
  })

  const activeTargets = allTargets.filter((t) => t.archivedAt === null)
  const archivedTargets = allTargets.filter((t) => t.archivedAt !== null)

  // sessionsAllocated включает (a) все активные цели (archivedAt IS NULL)
  // и (b) архивированные COMPLETED цели. Бюджет COMPLETED цели считается
  // потраченным независимо от того архивирована она или нет
  // (DECISIONS.md правило 5).
  const allocatingTargets = allTargets.filter(
    (t) => t.archivedAt === null || t.status === "COMPLETED",
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
