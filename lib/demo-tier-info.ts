import type { AnalysisTarget } from "@prisma/client"
import { TIER_CONFIG } from "./tier-limits"

// Виртуальный тариф для демо. В прод-сценарии данные берутся из
// Subscription через getEffectiveTier (lib/tier-limits.ts).
export const DEMO_TIER = TIER_CONFIG.STANDARD

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
