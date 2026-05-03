import type { AnalysisTarget } from "@prisma/client"

// Виртуальный тариф для демо. В прод-сценарии эти данные придут из
// модели Subscription (создаётся при оплате — Этап 10).
export const DEMO_TIER = {
  name: "Стандартный",
  targetsLimit: 6,
  analysesPerMonth: 12,
  sessionsLimit: 2500,
  pricePerMonth: 4990,
} as const

export interface DemoTierUsage {
  targetsUsed: number
  targetsRemaining: number

  analysesUsedThisMonth: number
  analysesRemaining: number

  sessionsAllocated: number
  sessionsRemaining: number
}

export function calculateDemoUsage(
  targets: AnalysisTarget[],
  analysesThisMonth: number,
): DemoTierUsage {
  const activeTargets = targets.filter((t) => t.archivedAt === null)
  const targetsUsed = activeTargets.length
  const sessionsAllocated = activeTargets.reduce(
    (sum, t) => sum + t.sessionsBudget,
    0,
  )

  return {
    targetsUsed,
    targetsRemaining: DEMO_TIER.targetsLimit - targetsUsed,

    analysesUsedThisMonth: analysesThisMonth,
    analysesRemaining: DEMO_TIER.analysesPerMonth - analysesThisMonth,

    sessionsAllocated,
    sessionsRemaining: DEMO_TIER.sessionsLimit - sessionsAllocated,
  }
}
