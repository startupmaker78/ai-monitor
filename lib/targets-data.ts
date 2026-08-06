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
  // Целевое действие (Path M). Имя/тип — локальный дубль из Метрики (UI не
  // падает, когда Метрика недоступна/цель удалена).
  metrikaGoalId: string | null
  metrikaGoalName: string | null
  metrikaGoalType: string | null
  // Иммутабельность действия: true если действие ЗАДАНО И есть DONE-анализ —
  // сменить его уже нельзя (иначе прежние рекомендации противоречили бы новой
  // цифре). ПЕРВАЯ установка на цель с анализами (действие ещё не задано) —
  // разрешена (противоречить нечему). Гейт дублируется в setTargetGoal.
  goalLocked: boolean
  // Была ли хоть раз проанализирована (есть DONE-анализ). Статус для этого не
  // годится: после анализа цель возвращается в READY/ACTIVE (recollect), а
  // COMPLETED в бою не выставляется.
  analyzed: boolean
}

export type TargetsPageData = {
  sites: Array<{ id: string; domain: string; isDemo: boolean }>
  // metrikaConfigured — факт наличия токена (сам токен в клиент НЕ уходит).
  // Гейтит дропдаун выбора действия.
  selectedSite: { id: string; domain: string; isDemo: boolean; metrikaConfigured: boolean } | null
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

  const allTargetsRaw = await prisma.analysisTarget.findMany({
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
      metrikaGoalId: true,
      metrikaGoalName: true,
      metrikaGoalType: true,
      // Наличие хотя бы одного DONE-анализа → goalLocked. take:1 — нам нужен
      // только факт, не список.
      analyses: { where: { status: "DONE" }, select: { id: true }, take: 1 },
    },
  })

  const allTargets: TargetWithStats[] = allTargetsRaw.map((t) => ({
    id: t.id,
    url: t.url,
    name: t.name,
    status: t.status,
    sessionsCollected: t.sessionsCollected,
    sessionsBudget: t.sessionsBudget,
    archivedAt: t.archivedAt,
    createdAt: t.createdAt,
    metrikaGoalId: t.metrikaGoalId,
    metrikaGoalName: t.metrikaGoalName,
    metrikaGoalType: t.metrikaGoalType,
    goalLocked: t.metrikaGoalId !== null && t.analyses.length > 0,
    analyzed: t.analyses.length > 0,
  }))

  const activeTargets = allTargets.filter((t) => t.archivedAt === null)
  const archivedTargets = allTargets.filter((t) => t.archivedAt !== null)

  // sessionsAllocated (формула B): только АКТИВНЫЕ цели по полному
  // sessionsBudget. Совпадает 1-в-1 с серверным гейтом create-цели
  // (actions.ts) и с UsageWidget на Главной/Тарифах/demo (calculateDemoUsage).
  // Архивные НЕ учитываем — гейт их не считает. Раньше тут была формула A
  // (active budget + архивный collected) — расходилась с гейтом на Σ архивных
  // collected (виджет «Страницы» показывал 150 при гейтовых 140). Политика
  // «должен ли гейт учитывать архивный collected» — вопрос тарифной
  // математики, решается отдельно, не здесь.
  const sessionsAllocated = activeTargets.reduce(
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
      // Токен НЕ отдаём в клиент — только факт его наличия.
      metrikaConfigured: Boolean(selectedSite.metrikaToken),
    },
    tier,
    activeTargets,
    archivedTargets,
    sessionsAllocated,
    sessionsRemaining: tier.sessionsLimit - sessionsAllocated,
    targetsRemaining: tier.targetsLimit - activeTargets.length,
  }
}
