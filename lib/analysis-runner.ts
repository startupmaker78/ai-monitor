import { prisma } from "@/lib/prisma"
import { callClaude } from "@/lib/claude-client"
import {
  buildAnalysisPrompt,
  parseRecommendations,
  type AnalysisInput,
} from "@/lib/analysis-prompt"
import { buildMockAnalysisInput } from "@/lib/mock-session-data"
import { getEffectiveTier } from "@/lib/tier-limits"
import { validateSiteOwnership } from "@/lib/site-data"

export type RunAnalysisError =
  | "unauthorized"
  | "target_not_found"
  | "target_not_ready"
  | "previous_recs_open"
  | "monthly_limit"
  | "race_condition"
  | "claude_retriable"
  | "claude_invalid"
  | "internal"

export type RunAnalysisResult =
  | { ok: true; analysisId: string; recommendationsCount: number }
  | {
      ok: false
      error: RunAnalysisError
      message: string
      analysisId?: string
    }

const MAX_TOKENS = 8000

export async function runAnalysis(
  userId: string,
  targetId: string,
): Promise<RunAnalysisResult> {
  // 1. Загрузить target с site.
  const target = await prisma.analysisTarget.findUnique({
    where: { id: targetId },
    include: {
      site: {
        select: { id: true, ownerId: true, domain: true, isDemo: true },
      },
    },
  })

  // 2. Проверки доступа. Все три ветки → target_not_found, чтобы не палить
  // существование чужих targets.
  if (!target || target.archivedAt) return notFoundResult()
  const owns = await validateSiteOwnership(target.siteId, userId)
  if (!owns) return notFoundResult()

  // 3. Состояние цели.
  if (target.status !== "READY") {
    return {
      ok: false,
      error: "target_not_ready",
      message: statusMessage(target.status),
    }
  }

  // 4. Топ-10 предыдущего DONE-анализа должны быть закрыты.
  const lastDone = await prisma.analysis.findFirst({
    where: { targetId, status: "DONE" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  })
  if (lastDone) {
    const openCount = await prisma.recommendation.count({
      where: {
        analysisId: lastDone.id,
        sortOrder: { lte: 10 },
        status: { in: ["NEW", "IN_PROGRESS"] },
      },
    })
    if (openCount > 0) {
      return {
        ok: false,
        error: "previous_recs_open",
        message: `Сначала обработайте ${openCount} ${pluralRecs(openCount)} из предыдущего анализа этой цели.`,
      }
    }
  }

  // 5. Месячный лимит анализов на сайт.
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const tier = await getEffectiveTier(userId)
  const monthCount = await prisma.analysis.count({
    where: {
      target: { siteId: target.siteId },
      createdAt: { gte: monthStart },
      status: { not: "FAILED" },
    },
  })
  if (monthCount >= tier.analysesPerMonth) {
    return {
      ok: false,
      error: "monthly_limit",
      message: `Достигнут месячный лимит анализов (${tier.analysesPerMonth} на тарифе «${tier.name}»). Лимит сбрасывается в начале нового месяца.`,
    }
  }

  // 6. Атомарный переход READY → ANALYZING. Защищает от двух
  // одновременных кликов.
  const transition = await prisma.analysisTarget.updateMany({
    where: { id: targetId, status: "READY" },
    data: { status: "ANALYZING" },
  })
  if (transition.count === 0) {
    return {
      ok: false,
      error: "race_condition",
      message: "Анализ уже запущен другим запросом. Обновите страницу.",
    }
  }

  // 7. Создать Analysis (RUNNING).
  const analysis = await prisma.analysis.create({
    data: {
      siteId: target.siteId,
      targetId,
      requestedById: userId,
      status: "RUNNING",
      prompt: "",
    },
  })

  // 8. Метрики 30 дней.
  const snapshots = await prisma.metricsSnapshot.findMany({
    where: { siteId: target.siteId },
    orderBy: { date: "desc" },
    take: 30,
    select: {
      visits: true,
      uniqueVisitors: true,
      bounceRate: true,
      avgSessionDuration: true,
    },
  })

  // 9. Сборка AnalysisInput: реальные target/site/metrics, mock сессии (6.4).
  // Реальные rrweb-summary появятся в 6.3.
  const mock = buildMockAnalysisInput()
  const input: AnalysisInput = {
    target: { url: target.url, name: target.name },
    site: { domain: target.site.domain, isDemo: target.site.isDemo },
    metrics: aggregateMetrics(snapshots),
    sessionsCount: mock.sessionSummaries.length,
    sessionSummaries: mock.sessionSummaries,
  }

  // 10. Промпт.
  const { system, messages } = buildAnalysisPrompt(input)
  await safeUpdateAnalysisPrompt(analysis.id, system, messages)

  // 11. Вызов Claude.
  const claudeResult = await callClaude({
    system,
    messages,
    maxTokens: MAX_TOKENS,
  })

  // 12. Ошибки Claude.
  if (!claudeResult.ok) {
    if (claudeResult.error === "invalid_response") {
      // Запрос дошёл, токены потрачены, но ответ нечитаемый — бюджет цели
      // считаем потраченным.
      await markFailed(analysis.id, targetId, "COMPLETED")
      return {
        ok: false,
        error: "claude_invalid",
        message:
          "Анализ не удался — Claude вернул нечитаемый ответ. Бюджет цели потрачен, повторный анализ — с нового периода.",
        analysisId: analysis.id,
      }
    }
    // network_error | rate_limit | auth_failed | api_error → ретрай возможен.
    await markFailed(analysis.id, targetId, "READY")
    return {
      ok: false,
      error: "claude_retriable",
      message: claudeRetriableMessage(claudeResult.error),
      analysisId: analysis.id,
    }
  }

  // 13. Парсинг.
  const parsed = parseRecommendations(claudeResult.text)
  if (!parsed.ok || parsed.recommendations.length === 0) {
    await markFailed(analysis.id, targetId, "COMPLETED")
    return {
      ok: false,
      error: "claude_invalid",
      message:
        "Анализ не удался — Claude вернул некорректные рекомендации. Бюджет цели потрачен.",
      analysisId: analysis.id,
    }
  }

  // 14. Финальная транзакция.
  try {
    await prisma.$transaction([
      prisma.recommendation.createMany({
        data: parsed.recommendations.map((r, idx) => ({
          analysisId: analysis.id,
          priority: r.priority,
          category: r.category,
          title: r.title,
          description: r.recommendation,
          problem: r.problem,
          evidence: r.evidence,
          expectedImpact: r.expectedImpact,
          effort: r.effort,
          lowConfidence: r.low_confidence ?? false,
          sortOrder: idx,
          status: "NEW",
        })),
      }),
      prisma.analysis.update({
        where: { id: analysis.id },
        data: {
          status: "DONE",
          completedAt: new Date(),
          sessionsAnalyzed: input.sessionsCount,
          tokensUsed:
            claudeResult.usage.inputTokens + claudeResult.usage.outputTokens,
          recommendationsCount: parsed.recommendations.length,
        },
      }),
      prisma.analysisTarget.update({
        where: { id: targetId },
        data: { status: "COMPLETED" },
      }),
    ])
  } catch (err) {
    console.error(
      `[runAnalysis] final transaction failed for analysis ${analysis.id}:`,
      err,
    )
    await markFailed(analysis.id, targetId, "COMPLETED").catch(() => {})
    return {
      ok: false,
      error: "internal",
      message: "Ошибка при сохранении рекомендаций. Свяжитесь с поддержкой.",
      analysisId: analysis.id,
    }
  }

  return {
    ok: true,
    analysisId: analysis.id,
    recommendationsCount: parsed.recommendations.length,
  }
}

function notFoundResult(): RunAnalysisResult {
  return { ok: false, error: "target_not_found", message: "Цель не найдена." }
}

function statusMessage(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "Цель ещё не накопила достаточно сессий (нужно ≥100)."
    case "ANALYZING":
      return "Для этой цели уже идёт анализ. Дождитесь завершения."
    case "COMPLETED":
      return "Анализ этой цели уже завершён в текущем периоде. Повторно — с нового периода."
    case "ARCHIVED":
      return "Цель архивирована."
    default:
      return `Цель в статусе ${status}, запуск невозможен.`
  }
}

function claudeRetriableMessage(error: string): string {
  switch (error) {
    case "rate_limit":
      return "Claude временно перегружен (rate limit). Попробуйте через минуту."
    case "auth_failed":
      return "Ошибка авторизации Claude API. Свяжитесь с поддержкой."
    case "network_error":
      return "Ошибка сети при обращении к Claude. Попробуйте ещё раз."
    case "api_error":
    default:
      return "Claude API временно недоступен. Попробуйте через минуту."
  }
}

function pluralRecs(n: number): string {
  const abs = Math.abs(n) % 100
  if (abs > 10 && abs < 20) return "рекомендаций"
  const last = abs % 10
  if (last === 1) return "рекомендацию"
  if (last >= 2 && last <= 4) return "рекомендации"
  return "рекомендаций"
}

// MetricsSnapshot.bounceRate — Prisma Decimal. В Prisma 7 selected scalar
// Decimal приходит как объект с .toNumber(). Если когда-то поле будет
// number — fallback тоже работает.
type SnapshotForAggregate = {
  visits: number
  uniqueVisitors: number
  bounceRate: { toNumber: () => number } | number
  avgSessionDuration: number
}

function aggregateMetrics(
  snapshots: SnapshotForAggregate[],
): AnalysisInput["metrics"] {
  if (snapshots.length === 0) return null
  const totalVisits = snapshots.reduce((s, x) => s + x.visits, 0)
  const totalUniques = snapshots.reduce((s, x) => s + x.uniqueVisitors, 0)
  const bounceRates = snapshots.map((x) =>
    typeof x.bounceRate === "number" ? x.bounceRate : x.bounceRate.toNumber(),
  )
  const avgBounce =
    bounceRates.reduce((s, x) => s + x, 0) / bounceRates.length
  const avgDuration =
    snapshots.reduce((s, x) => s + x.avgSessionDuration, 0) / snapshots.length
  return {
    visits: totalVisits,
    uniqueVisitors: totalUniques,
    bounceRate: avgBounce,
    avgSessionDuration: Math.round(avgDuration),
  }
}

async function safeUpdateAnalysisPrompt(
  analysisId: string,
  system: string,
  messages: unknown[],
): Promise<void> {
  try {
    await prisma.analysis.update({
      where: { id: analysisId },
      data: { prompt: JSON.stringify({ system, messages }) },
    })
  } catch (err) {
    console.warn(
      `[runAnalysis] failed to persist prompt for analysis ${analysisId}:`,
      err,
    )
  }
}

async function markFailed(
  analysisId: string,
  targetId: string,
  newTargetStatus: "READY" | "COMPLETED",
): Promise<void> {
  await prisma.analysis
    .update({
      where: { id: analysisId },
      data: { status: "FAILED", completedAt: new Date() },
    })
    .catch((e) => {
      console.error(
        `[runAnalysis] failed to mark analysis ${analysisId} FAILED:`,
        e,
      )
    })
  await prisma.analysisTarget
    .update({
      where: { id: targetId },
      data: { status: newTargetStatus },
    })
    .catch((e) => {
      console.error(
        `[runAnalysis] failed to revert target ${targetId} to ${newTargetStatus}:`,
        e,
      )
    })
}
