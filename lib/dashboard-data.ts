import { prisma } from "@/lib/prisma"
import { DEMO_TIER, calculateDemoUsage } from "@/lib/demo-tier-info"
import { getMinSessionsBudget } from "@/lib/config"
import {
  classifySession,
  type SessionClass,
} from "@/lib/session-classification"

export async function getDashboardData(userId: string, selectedSiteId?: string) {
  const ownerProfile = await prisma.ownerProfile.findUnique({
    where: { userId },
    include: {
      sites: {
        // Defensive фильтр isDemo=false: после cleanup demo-Sites не должно
        // быть, но если что-то осталось — не показываем на дашборде.
        where: { isDemo: false },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!ownerProfile || ownerProfile.sites.length === 0) {
    return null
  }

  // Выбранный сайт (глобальный селектор, cookie). selectedSiteId уже
  // валидирован в getSelectedSiteId, но перепроверяем принадлежность здесь —
  // не доверяем; невалидный → первый сайт.
  const site =
    ownerProfile.sites.find((s) => s.id === selectedSiteId) ??
    ownerProfile.sites[0]

  // Дашборд теперь показывает МЕТРИКИ ПРОДУКТА (записали → отследили →
  // проанализировали → нашли), а не визиты/время из Метрики (клиент видел бы
  // копию Метрики). Метрика осталась для блока конверсии по цели (Path M) и
  // синка — но на главную визиты/время больше не выносим.

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

  // ── Продуктовые KPI (только DB, скоуп siteId). Окно графика — 30 дней.
  const chartStart = new Date()
  chartStart.setUTCDate(chartStart.getUTCDate() - 29)
  chartStart.setUTCHours(0, 0, 0, 0)

  const [
    sessionsRecorded,
    targetsTotal,
    analysesTotal,
    recommendationsReceived,
    recPriorityRaw,
    sessionRows,
    analysisRows,
    analyzedRows,
  ] = await Promise.all([
    prisma.session.count({ where: { siteId: site.id } }),
    prisma.analysisTarget.count({ where: { siteId: site.id } }),
    prisma.analysis.count({ where: { siteId: site.id } }),
    prisma.recommendation.count({ where: { analysis: { siteId: site.id } } }),
    prisma.recommendation.groupBy({
      by: ["priority"],
      where: { analysis: { siteId: site.id } },
      _count: true,
    }),
    prisma.session.findMany({
      where: { siteId: site.id, startedAt: { gte: chartStart } },
      select: { startedAt: true },
    }),
    prisma.analysis.findMany({
      where: { siteId: site.id, createdAt: { gte: chartStart } },
      select: { createdAt: true },
    }),
    // Какие цели УЖЕ анализировались (distinct targetId) — по факту анализов,
    // а не по target.status (он ненадёжен: у academy цели ACTIVE, хотя
    // проанализированы). Для честного «готова к анализу».
    prisma.analysis.findMany({
      where: { siteId: site.id },
      select: { targetId: true },
      distinct: ["targetId"],
    }),
  ])
  const analyzedTargetIds = new Set(analyzedRows.map((a) => a.targetId))

  const recReceivedByPriority = {
    CRITICAL: recPriorityRaw.find((p) => p.priority === "CRITICAL")?._count ?? 0,
    IMPORTANT:
      recPriorityRaw.find((p) => p.priority === "IMPORTANT")?._count ?? 0,
    GOOD: recPriorityRaw.find((p) => p.priority === "GOOD")?._count ?? 0,
  }

  // Непрерывный ряд из 30 дней (пропуски заполняем нулями) для графика.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10)
  const sessionsByDay = new Map<string, number>()
  for (const s of sessionRows) {
    const k = dayKey(s.startedAt)
    sessionsByDay.set(k, (sessionsByDay.get(k) ?? 0) + 1)
  }
  const analysesByDay = new Map<string, number>()
  for (const a of analysisRows) {
    const k = dayKey(a.createdAt)
    analysesByDay.set(k, (analysesByDay.get(k) ?? 0) + 1)
  }
  const sessionsChart: { date: string; sessions: number; analyses: number }[] =
    []
  for (let i = 0; i < 30; i++) {
    const d = new Date(chartStart)
    d.setUTCDate(chartStart.getUTCDate() + i)
    const k = dayKey(d)
    sessionsChart.push({
      date: k,
      sessions: sessionsByDay.get(k) ?? 0,
      analyses: analysesByDay.get(k) ?? 0, // счётчик анализов дня → точка-маркер
    })
  }

  // Готовые к анализу: цель с collected>=минимум, по которой ЕЩЁ НЕ было
  // анализа. Модель B разрешает запуск не дожидаясь бюджета — клиент об этом
  // не знает и ждёт зря. (Уже проанализированные не подсвечиваем как «можно
  // запускать» — иначе врали бы про academy, где цели проанализированы.)
  const minSessions = getMinSessionsBudget()
  const readyTargets = targets.filter(
    (t) => t.sessionsCollected >= minSessions && !analyzedTargetIds.has(t.id),
  )

  return {
    site,
    // Продуктовые KPI (воронка: записали → отследили → проанализировали →
    // нашли). Метрику Метрики (визиты/время) на главную не выносим.
    kpi: {
      sessionsRecorded,
      targetsActive: targets.length, // targets = archivedAt:null
      targetsTotal,
      analysesThisMonth,
      analysesLimit: DEMO_TIER.analysesPerMonth,
      recommendationsReceived,
      totalActive, // активные (NEW/IN_PROGRESS) — для ссылки на рекомендации
    },
    recPriorityReceived: recReceivedByPriority,
    readyToAnalyze: {
      count: readyTargets.length,
      firstName: readyTargets[0]?.name ?? readyTargets[0]?.url ?? null,
    },
    readyTargetIds: readyTargets.map((t) => t.id),
    analysesTotal,
    sessionsChart,
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
