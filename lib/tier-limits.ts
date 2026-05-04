import type { SubscriptionTier } from "@prisma/client"
import { prisma } from "./prisma"

export type TierConfig = {
  name: string
  pricePerMonth: number
  targetsLimit: number
  analysesPerMonth: number
  sessionsLimit: number
}

export const TIER_CONFIG: Record<SubscriptionTier, TierConfig> = {
  BASIC: {
    name: "Базовый",
    pricePerMonth: 2990,
    targetsLimit: 2,
    analysesPerMonth: 4,
    sessionsLimit: 1000,
  },
  STANDARD: {
    name: "Стандартный",
    pricePerMonth: 4990,
    targetsLimit: 6,
    analysesPerMonth: 12,
    sessionsLimit: 2500,
  },
  PROFESSIONAL: {
    name: "Профессиональный",
    pricePerMonth: 8990,
    targetsLimit: 12,
    analysesPerMonth: 24,
    sessionsLimit: 5000,
  },
  CORPORATE: {
    name: "Корпоративный",
    pricePerMonth: 12990,
    targetsLimit: 24,
    analysesPerMonth: 48,
    sessionsLimit: 10000,
  },
}

// Возвращает effective тариф для юзера через OwnerProfile.subscription.
// На MVP до этапа 10 Subscription не создаётся — fallback на STANDARD.
export async function getEffectiveTier(userId: string): Promise<TierConfig> {
  const op = await prisma.ownerProfile.findUnique({
    where: { userId },
    select: { subscription: { select: { tier: true } } },
  })
  const tier = op?.subscription?.tier ?? "STANDARD"
  return TIER_CONFIG[tier]
}
