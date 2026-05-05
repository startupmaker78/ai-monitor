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

  // sessionsAllocated (DECISIONS.md "2026-05-05 — Hotfix 5"):
  // - Активные цели (archivedAt IS NULL): полный sessionsBudget
  //   (резерв на сбор + анализ)
  // - Архивированные цели: только sessionsCollected
  //   (что реально использовано — остальное возвращено при архивации;
  //   архивация ACTIVE/READY с collected>0 запрещена, поэтому архив
  //   всегда отражает финальное использование).
  const sessionsAllocated = allTargets.reduce((sum, t) => {
    if (t.archivedAt === null) {
      return sum + t.sessionsBudget
    }
    return sum + t.sessionsCollected
  }, 0)

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
