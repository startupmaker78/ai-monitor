import { prisma } from "@/lib/prisma"
import { validateSiteOwnership } from "@/lib/site-data"
import {
  fetchGoalConversion,
  type ConversionErrorReason,
} from "@/lib/metrika-goals"

// Серверный data-слой для блока конверсии на /recommendations. Даёт
// fetchGoalConversion недостающие ИЗ БД параметры (ourSessionCount +
// sessionWindowStart) — сама lib в БД не лезет (решено в 2B). Токен читается
// здесь, наружу не уходит.

export type TargetConversion =
  | {
      state: "ok"
      goalName: string | null
      goalType: string | null
      conversionRate: number
      sampleVisits: number
      period: { from: string; to: string; widened: boolean }
      lowConfidence: boolean
    }
  | {
      state: "error"
      reason: ConversionErrorReason
      goalName: string | null
    }
  // siteId — чтобы блок конверсии вёл на КОНКРЕТНУЮ цель (?site=…#target-…),
  // а не на общий список.
  | { state: "not_set"; siteId: string; targetId: string }
  | { state: "not_configured" }
  | { state: "target_not_found" }

export async function getGoalConversionForTarget(
  userId: string,
  targetId: string,
): Promise<TargetConversion> {
  const target = await prisma.analysisTarget.findUnique({
    where: { id: targetId },
    select: {
      siteId: true,
      url: true,
      metrikaGoalId: true,
      metrikaGoalName: true,
      metrikaGoalType: true,
    },
  })
  if (!target) return { state: "target_not_found" }

  const owns = await validateSiteOwnership(target.siteId, userId)
  if (!owns) return { state: "target_not_found" } // не палим существование чужой цели

  if (!target.metrikaGoalId) {
    return { state: "not_set", siteId: target.siteId, targetId }
  }

  const site = await prisma.site.findUnique({
    where: { id: target.siteId },
    select: { metrikaCounterId: true, metrikaToken: true },
  })
  if (!site?.metrikaCounterId || !site.metrikaToken) {
    return { state: "not_configured" }
  }

  // Окно сбора + число собранных сессий цели — для метода B и развода
  // no_data/mismatch. sessionWindowStart = первая собранная сессия; если
  // сессий нет — fallback на 90daysAgo решит сама lib через порог визитов.
  const agg = await prisma.session.aggregate({
    where: { analysisTargetId: targetId },
    _min: { startedAt: true },
    _count: true,
  })
  const sessionWindowStart = agg._min.startedAt ?? new Date(Date.now() - 90 * 86400000)

  const conv = await fetchGoalConversion(site.metrikaCounterId, site.metrikaToken, {
    goalId: target.metrikaGoalId,
    targetUrl: target.url,
    sessionWindowStart,
    ourSessionCount: agg._count,
  })

  if (conv.ok) {
    return {
      state: "ok",
      goalName: target.metrikaGoalName,
      goalType: target.metrikaGoalType,
      conversionRate: conv.conversionRate,
      sampleVisits: conv.sampleVisits,
      period: conv.period,
      lowConfidence: conv.lowConfidence,
    }
  }
  return { state: "error", reason: conv.reason, goalName: target.metrikaGoalName }
}
