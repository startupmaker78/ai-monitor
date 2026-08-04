import { prisma } from "@/lib/prisma"
import { callClaude } from "@/lib/claude-client"
import {
  buildAnalysisPrompt,
  parseRecommendations,
  type AnalysisInput,
} from "@/lib/analysis-prompt"
import {
  collectSessionsForAnalysis,
  MAX_SESSIONS_PER_ANALYSIS,
  type CollectSessionsResult,
} from "@/lib/session-pre-processor"
import { getEffectiveTier } from "@/lib/tier-limits"
import { validateSiteOwnership } from "@/lib/site-data"
import { getMinSessionsBudget } from "@/lib/config"
import { getGoalConversionForTarget } from "@/lib/goal-conversion-data"

export type RunAnalysisError =
  | "unauthorized"
  | "target_not_found"
  | "not_enough_sessions"
  | "no_sessions"
  | "no_interactions"
  | "collect_timeout"
  | "monthly_limit"
  | "race_condition"
  | "provider_denied" // 403 провайдера
  | "proxy_error" // отказ нашего Fly-прокси (X-Webmon-Proxy), не провайдер
  | "provider_key_invalid" // 401 провайдера (ключ OpenRouter отклонён)
  | "provider_billing" // 402 (баланс/кредиты)
  | "relay_unavailable"
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
// Общий cap на сбор сессий из S3 (6.3d). Ниже Gateway-лимита 300с →
// падаем чисто до 504 и markFailed возвращает цель в ACTIVE.
const COLLECT_TIMEOUT_MS = 60_000

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

  // 3. Минимум сессий для запуска (Модель B «полная свобода»): анализ
  // доступен при sessionsCollected >= MIN независимо от budget и статуса.
  // budget — КАП сбора (collect стопается на нём), НЕ гейт запуска.
  // ACTIVE и READY оба допускают запуск; ANALYZING отсекается атомарным
  // переходом (шаг 6); ARCHIVED — гейтом archivedAt (шаг 2). Повтор
  // возможен: цель после анализа возвращается в сбор, а не в терминал.
  const minToRun = getMinSessionsBudget()
  if (target.sessionsCollected < minToRun) {
    return {
      ok: false,
      error: "not_enough_sessions",
      message: `Для запуска анализа нужно минимум ${minToRun} сессий, собрано ${target.sessionsCollected}.`,
    }
  }

  // 4. (Гейт «обработай top-10 предыдущего анализа» УБРАН 2026-07-15.)
  // Он требовал перевести top-10 рекомендаций последнего DONE-анализа в
  // DONE/REJECTED перед новым запуском. НО в приложении нет UI/API смены
  // статуса рекомендации — они создаются всегда `NEW` и никогда не
  // меняются → гейт был НЕУДОВЛЕТВОРИМ → любая цель блокировалась
  // НАВСЕГДА после первого DONE-анализа (дедлок; противоречил Модели B
  // «свобода запуска»). Экономический ограничитель остаётся — месячный
  // лимит анализов на сайт (шаг 5, ниже). Мягкий гейт (предупреждение,
  // не блок) можно вернуть ВМЕСТЕ с UI обработки рекомендаций — см. TODO
  // «UI управления рекомендациями».

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

  // 6. Атомарный переход ACTIVE|READY → ANALYZING. Защищает от двух
  // одновременных кликов: параллельный запрос увидит ANALYZING (не в
  // {ACTIVE,READY}) → count=0 → race_condition. Принимает ACTIVE (ранний
  // запуск до budget, Модель B), а не только READY.
  const transition = await prisma.analysisTarget.updateMany({
    where: { id: targetId, status: { in: ["ACTIVE", "READY"] } },
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

  // 9. Реальные rrweb-summary (этап 6.3d, замена моков). Пре-процессор
  // скачивает S3-пакеты сессий цели и дистиллирует каждую в SessionSummary.
  // Лимит 50 сессий/анализ (DECISIONS 2026-05-07) — через MAX_SESSIONS_
  // PER_ANALYSIS; сбор параллельный (concurrency в пре-процессоре).
  // `incomplete` (брошенная сессия) НЕ передаём в промпт — поведенческие
  // сигналы важнее чистого закрытия, а прайм-структуру не меняем; флаг
  // остаётся в ExtractResult для будущей observability.
  //
  // ── 152-ФЗ: ЧТО уходит в Claude через Fly-прокси (Франкфурт)→OpenRouter ──
  // В промпт (JSON.stringify sessionSummaries) идут ТОЛЬКО:
  //   • clicks[].text — публичный текст элементов страницы («Я согласен»,
  //     «Программы»); НЕ данные посетителя;
  //   • formInteractions[].field — placeholder/name полей («Email»,«phone»)
  //     = метаданные формы (публичный контент), НЕ введённые значения;
  //   • selector'ы (exit/rage/clicks), viewport, deviceType, duration,
  //     scrollDepth, rage/dead — поведенческие метрики.
  // НЕ уходит: FullSnapshot (весь DOM), ipHash, userAgent, ЗНАЧЕНИЯ полей
  // (rrweb маскирует + пре-процессор их не читает). URL цели — публичный
  // path (query срезан normalizeUrl).
  // На academy это публичный контент страницы, НЕ ПД посетителя.
  // ⚠️ ВЕКТОР НА БУДУЩЕЕ: clicks[].text безопасен на публичных/статичных
  // страницах, но на ПЕРСОНАЛИЗИРОВАННЫХ (ЛК, где в DOM имя/email юзера)
  // текст кликнутого элемента может содержать ПД → при подключении таких
  // сайтов: стрипать/резать clicks[].text или per-site-конфиг. Сейчас
  // (academy, публичные курсы) не актуально.
  // Таймаут сбора 60с + markFailed при сбое/зависании (защита от
  // инцидента 2026-07-15: S3-сбор завис >300с → Gateway 504 → цель
  // застряла в ANALYZING, т.к. процесс убит СНАРУЖИ до любого catch).
  // 60с < 300с Gateway → падаем чисто ДО 504, markFailed возвращает цель
  // в ACTIVE. Дополняет per-request S3-таймауты (lib/storage.ts): даже
  // если те не сработают — общий cap не даст зависнуть.
  let collected: CollectSessionsResult
  try {
    collected = await withTimeout(
      collectSessionsForAnalysis(targetId, {
        limit: MAX_SESSIONS_PER_ANALYSIS,
      }),
      COLLECT_TIMEOUT_MS,
      "session_collection",
    )
  } catch (err) {
    console.error("[analysis-runner] session collection failed/timed out", {
      analysisId: analysis.id,
      targetId,
      err: (err as Error).message,
    })
    await markFailed(analysis.id, targetId)
    return {
      ok: false,
      error: "collect_timeout",
      message:
        "Не удалось собрать сессии за отведённое время. Попробуйте ещё раз.",
      analysisId: analysis.id,
    }
  }

  const sessionSummaries = collected.summaries

  // Фолбэк (боевой путь): если ни одной СОДЕРЖАТЕЛЬНОЙ сессии не осталось —
  // анализировать нечего. Модель B: markFailed возвращает цель в сбор.
  // NB: сессий может быть <5 (часть отсеялась) — это НЕ ошибка, анализ
  // идёт на том что есть (гейт ≥5 отработал на уровне collected цели).
  if (sessionSummaries.length === 0) {
    console.error("[analysis-runner] no analyzable sessions", {
      analysisId: analysis.id,
      targetId,
      skipped: collected.skipped,
    })
    await markFailed(analysis.id, targetId)
    // Различаем причину пустоты: если сессии БЫЛИ, но все без действий
    // (bounce/пассивные, отсеяны фильтром) — это не поломка данных, а
    // отсутствие поведения. Отдельный отказ, чтобы юзер понял: данные
    // целы, но анализировать нечего (нужен активный трафик).
    if (collected.skipped.noInteractions > 0) {
      return {
        ok: false,
        error: "no_interactions",
        message:
          "Собранные сессии не содержат действий посетителей (клики, скролл, формы) — анализировать нечего. Как накопятся активные сессии, запустите снова.",
        analysisId: analysis.id,
      }
    }
    return {
      ok: false,
      error: "no_sessions",
      message:
        "Не удалось собрать сессии для анализа (данные повреждены или недоступны). Попробуйте позже.",
      analysisId: analysis.id,
    }
  }

  console.log("[analysis-runner] real sessions collected for analysis", {
    analysisId: analysis.id,
    targetId,
    sessionsCount: sessionSummaries.length,
  })

  // Path M: конверсия из Метрики (ГОТОВЫЙ ФАКТ) + смещение выборки. Всё
  // best-effort — НИКОГДА не блокирует анализ: цель без действия / Метрика
  // недоступна → поведенческий анализ ровно как раньше (goal/sample могут
  // быть undefined, buildAnalysisPrompt их просто опустит).
  let goalInput: AnalysisInput["goal"]
  let sampleInput: AnalysisInput["sample"]
  try {
    const conv = await getGoalConversionForTarget(userId, targetId)
    let coverage: NonNullable<AnalysisInput["sample"]>["coverage"]

    if (conv.state === "ok") {
      goalInput = {
        kind: "conversion",
        name: conv.goalName ?? "целевое действие",
        conversionRate: conv.conversionRate,
        sampleVisits: conv.sampleVisits,
        period: conv.period,
        lowConfidence: conv.lowConfidence,
      }
      // Покрытие считаем ТОЛЬКО когда есть период конверсии (иначе не с чем
      // сравнивать окно записей).
      const agg = await prisma.session.aggregate({
        where: { analysisTargetId: targetId },
        _min: { startedAt: true },
        _max: { startedAt: true },
      })
      if (agg._min.startedAt && agg._max.startedAt) {
        const dayMs = 86_400_000
        const recTo = agg._max.startedAt
        const recordDays =
          Math.round((recTo.getTime() - agg._min.startedAt.getTime()) / dayMs) + 1
        const convTo = new Date(conv.period.to + "T00:00:00Z")
        const uncovered = isNaN(convTo.getTime())
          ? 0
          : Math.max(0, Math.round((convTo.getTime() - recTo.getTime()) / dayMs))
        coverage = {
          recordsFrom: agg._min.startedAt.toISOString().slice(0, 10),
          recordsTo: recTo.toISOString().slice(0, 10),
          recordDays: Math.max(1, recordDays),
          uncoveredDaysAfterLastRecord: uncovered,
        }
      }
    } else if (conv.state === "error") {
      // Цель задана, но конверсия недоступна (mismatch/unavailable/…).
      goalInput = { kind: "unavailable", name: conv.goalName }
    }
    // not_set / not_configured / target_not_found → goalInput остаётся
    // undefined → блок ЦЕЛЕВОЕ ДЕЙСТВИЕ не добавляется.

    sampleInput = {
      analyzedCount: sessionSummaries.length,
      droppedNoAction: collected.skipped.noInteractions,
      coverage,
    }
  } catch (err) {
    console.warn(
      "[analysis-runner] goal/conversion enrichment skipped:",
      (err as Error).message,
    )
  }

  const input: AnalysisInput = {
    target: { url: target.url, name: target.name },
    site: { domain: target.site.domain, isDemo: target.site.isDemo },
    metrics: aggregateMetrics(snapshots),
    sessionsCount: sessionSummaries.length,
    sessionSummaries,
    goal: goalInput,
    sample: sampleInput,
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
      console.error("[analysis-runner] Claude returned invalid response", {
        analysisId: analysis.id,
        targetId,
        errorType: claudeResult.error,
        errorCategory: "claude_invalid",
        details: claudeResult.details,
      })
      // Запрос дошёл, токены потрачены, но ответ нечитаемый — бюджет цели
      // считаем потраченным.
      await markFailed(analysis.id, targetId)
      return {
        ok: false,
        error: "claude_invalid",
        message:
          "Анализ не удался — Claude вернул нечитаемый ответ. Попробуйте ещё раз.",
        analysisId: analysis.id,
      }
    }
    // Отказы прокси/провайдера — под-причины разведены по реальным телам (не
    // склеиваем в один текст). Все НЕ ретраибельны — нужна правка конфигурации/
    // баланса, не повтор. Санитизированную суть ответа (claudeResult.details)
    // кладём и в лог, и в сообщение — экономит разбор.
    const provider = claudeResult.details ?? ""
    if (claudeResult.error === "proxy_error") {
      // Отказ НАШЕГО Fly-прокси (X-Webmon-Proxy), не провайдера. Обычно плохой
      // X-Proxy-Auth / конфиг прокси. Не путается с 403 провайдера.
      console.error("[analysis-runner] AI proxy rejected request", {
        analysisId: analysis.id,
        targetId,
        errorType: claudeResult.error,
        errorCategory: "proxy_error",
        details: provider,
      })
      await markFailed(analysis.id, targetId)
      return {
        ok: false,
        error: "proxy_error",
        message: `Наш AI-прокси отклонил запрос (не провайдер) — проверьте X-Proxy-Auth / конфигурацию прокси. Ответ: ${provider}`,
        analysisId: analysis.id,
      }
    }
    if (claudeResult.error === "access_denied") {
      // 403 ПРОВАЙДЕРА (отказ прокси отсеян выше). Причину НЕ приписываем —
      // суть в details.
      console.error("[analysis-runner] provider denied request (403)", {
        analysisId: analysis.id,
        targetId,
        errorType: claudeResult.error,
        errorCategory: "provider_denied",
        details: provider,
      })
      await markFailed(analysis.id, targetId)
      return {
        ok: false,
        error: "provider_denied",
        message: `AI-провайдер отклонил запрос (403). Повтор не поможет — нужна проверка доступа/конфигурации. Ответ: ${provider}`,
        analysisId: analysis.id,
      }
    }
    if (claudeResult.error === "auth_failed") {
      // 401 ПРОВАЙДЕРА — ключ отклонён. Раньше уходило в claude_retriable
      // (ретраибельно) — это было неверно, повтор ключ не чинит.
      console.error("[analysis-runner] provider key rejected (401)", {
        analysisId: analysis.id,
        targetId,
        errorType: claudeResult.error,
        errorCategory: "provider_key_invalid",
        details: provider,
      })
      await markFailed(analysis.id, targetId)
      return {
        ok: false,
        error: "provider_key_invalid",
        message: `AI-провайдер отклонил ключ доступа (401). Проверьте OPENROUTER_API_KEY. Ответ: ${provider}`,
        analysisId: analysis.id,
      }
    }
    if (claudeResult.error === "insufficient_credits") {
      console.error("[analysis-runner] provider out of credits (402)", {
        analysisId: analysis.id,
        targetId,
        errorType: claudeResult.error,
        errorCategory: "provider_billing",
        details: provider,
      })
      await markFailed(analysis.id, targetId)
      return {
        ok: false,
        error: "provider_billing",
        message: `Исчерпан баланс/лимит AI-провайдера (402). Пополните аккаунт. Ответ: ${provider}`,
        analysisId: analysis.id,
      }
    }
    if (claudeResult.error === "relay_unavailable") {
      // 5xx от AI-шлюза/провайдера — наш путь лёг, не rate-limit.
      console.error("[analysis-runner] AI relay unavailable (5xx)", {
        analysisId: analysis.id,
        targetId,
        errorType: claudeResult.error,
        errorCategory: "relay_unavailable",
        details: claudeResult.details,
      })
      await markFailed(analysis.id, targetId)
      return {
        ok: false,
        error: "relay_unavailable",
        message: "AI-шлюз временно недоступен. Попробуйте позже.",
        analysisId: analysis.id,
      }
    }
    // network_error | rate_limit | auth_failed | api_error → ретрай возможен.
    console.error("[analysis-runner] Claude API failed", {
      analysisId: analysis.id,
      targetId,
      errorType: claudeResult.error,
      errorCategory: "claude_retriable",
      details: claudeResult.details,
    })
    await markFailed(analysis.id, targetId)
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
    // claudeResult.text содержит ответ Claude — может включать
    // рекомендации с PII при реальных данных. Логируем только длину
    // и первые 200 символов для диагностики формата.
    console.error("[analysis-runner] parseRecommendations failed", {
      analysisId: analysis.id,
      targetId,
      errorCategory: "claude_invalid",
      parseError: parsed.ok ? "zero_valid_recommendations" : parsed.error,
      validCount: parsed.ok ? parsed.recommendations.length : 0,
      textLength: claudeResult.text.length,
      textPreview: claudeResult.text.substring(0, 200),
      tokensUsed:
        claudeResult.usage.inputTokens + claudeResult.usage.outputTokens,
    })
    await markFailed(analysis.id, targetId)
    return {
      ok: false,
      error: "claude_invalid",
      message:
        "Анализ не удался — Claude вернул некорректные рекомендации. Попробуйте ещё раз.",
      analysisId: analysis.id,
    }
  }

  // 14. Финальная транзакция.
  // Модель B: после анализа цель возвращается в СБОР, не в терминальный
  // COMPLETED. READY если добрала budget, иначе ACTIVE (сбор продолжится
  // до budget). Повтор возможен — гейтится месячным лимитом + закрытием
  // top-10 предыдущего DONE. Сбор заморожен на время ANALYZING
  // (should-record матчит только ACTIVE/READY), поэтому свежее чтение
  // sessionsCollected точно отражает фактический сбор.
  const post = await prisma.analysisTarget.findUnique({
    where: { id: targetId },
    select: { sessionsCollected: true, sessionsBudget: true },
  })
  const recollectStatus: "READY" | "ACTIVE" =
    post && post.sessionsCollected >= post.sessionsBudget ? "READY" : "ACTIVE"
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
        data: { status: recollectStatus },
      }),
    ])
  } catch (err) {
    console.error(
      `[runAnalysis] final transaction failed for analysis ${analysis.id}:`,
      err,
    )
    await markFailed(analysis.id, targetId).catch(() => {})
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
  // Модель B: неудачный анализ тоже возвращает цель в СБОР (не терминал).
  // READY если добрала budget, иначе ACTIVE. FAILED-анализ не считается в
  // месячный лимит (status not FAILED) → повтор возможен.
  const t = await prisma.analysisTarget
    .findUnique({
      where: { id: targetId },
      select: { sessionsCollected: true, sessionsBudget: true },
    })
    .catch(() => null)
  const revertStatus: "READY" | "ACTIVE" =
    t && t.sessionsCollected >= t.sessionsBudget ? "READY" : "ACTIVE"
  await prisma.analysisTarget
    .update({
      where: { id: targetId },
      data: { status: revertStatus },
    })
    .catch((e) => {
      console.error(
        `[runAnalysis] failed to revert target ${targetId} to ${revertStatus}:`,
        e,
      )
    })
}

// Общий таймаут на промис: Promise.race с таймером. НЕ отменяет
// underlying-работу (S3-запросы завершатся по своим per-request
// таймаутам из lib/storage.ts), но гарантирует, что вызывающий не
// зависнет дольше ms. clearTimeout в finally — не течём таймерами.
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout:${label} after ${ms}ms`)),
      ms,
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
