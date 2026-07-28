"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getEffectiveTier } from "@/lib/tier-limits"
import { validateSiteOwnership } from "@/lib/site-data"
import { getMinSessionsBudget } from "@/lib/config"
import { normalizeUrl } from "@/lib/url-normalize"
import {
  getGoalsForSite,
  resolveGoalForSite,
  type SiteGoalsResult,
} from "@/lib/metrika-goals-data"

export type ActionResult = {
  ok: boolean
  message?: string
  error?: string
  // Поле для специфичных ошибок валидации, чтобы UI мог фокусировать
  // нужное поле формы. Пока просто строка-индикатор.
  field?: "url" | "sessionsBudget" | "name" | null
}

export async function createTarget(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: "Не авторизован" }

  // Schema строится per-request, чтобы min sessionsBudget читался из
  // env на каждый вызов — так дефолт (100) можно поменять через
  // Lockbox + revision redeploy без rebuild кода.
  const minSessionsBudget = getMinSessionsBudget()
  const createSchema = z.object({
    siteId: z.string().min(1),
    url: z.string().url("Введите корректный URL вида https://site.ru/page"),
    name: z.string().max(100).optional().or(z.literal("")),
    sessionsBudget: z
      .coerce.number()
      .int()
      .min(minSessionsBudget, `Минимум ${minSessionsBudget} сессий`),
    // Целевое действие — опционально (цель без него = поведенческий анализ).
    goalId: z.string().max(40).optional().or(z.literal("")),
  })

  const parsed = createSchema.safeParse({
    siteId: formData.get("siteId"),
    url: formData.get("url"),
    name: formData.get("name") ?? "",
    sessionsBudget: formData.get("sessionsBudget"),
    goalId: formData.get("goalId") ?? "",
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path0 = issue.path[0]
    const field: ActionResult["field"] =
      path0 === "url" || path0 === "sessionsBudget" || path0 === "name"
        ? path0
        : null
    return { ok: false, error: issue.message, field }
  }

  const owns = await validateSiteOwnership(parsed.data.siteId, session.user.id)
  if (!owns) return { ok: false, error: "Сайт не найден" }

  const tier = await getEffectiveTier(session.user.id)

  // Все активные цели сайта (не архивированные). COMPLETED тоже считается
  // активной с точки зрения занятого слота и бюджета — DECISIONS.md
  // правило 5: COMPLETED цель уже потратила бюджет, но слот в targetsLimit
  // занимает.
  const activeTargets = await prisma.analysisTarget.findMany({
    where: { siteId: parsed.data.siteId, archivedAt: null },
    select: { id: true, url: true, sessionsBudget: true },
  })

  // 1. Лимит количества целей по тарифу.
  if (activeTargets.length >= tier.targetsLimit) {
    return {
      ok: false,
      error: `Достигнут лимит целей вашего тарифа (${tier.targetsLimit}). Архивируйте неиспользуемые цели или повысьте тариф.`,
    }
  }

  // 2. Дубль URL на сайте (siteId + url). Fallback на raw при невалидном
  // URL — сохраняет прежнее поведение старой локальной normalizeUrl,
  // которая возвращала raw для invalid; общий util в @/lib/url-normalize
  // возвращает null.
  const newUrlNormalized =
    normalizeUrl(parsed.data.url) ?? parsed.data.url
  const isDuplicate = activeTargets.some(
    (t) => (normalizeUrl(t.url) ?? t.url) === newUrlNormalized,
  )
  if (isDuplicate) {
    return {
      ok: false,
      error: "Цель с таким URL уже существует. Архивируйте её сначала.",
      field: "url",
    }
  }

  // 3. Бюджет сессий не превышает остаток.
  const sessionsAllocated = activeTargets.reduce(
    (sum, t) => sum + t.sessionsBudget,
    0,
  )
  const sessionsRemaining = tier.sessionsLimit - sessionsAllocated
  if (parsed.data.sessionsBudget > sessionsRemaining) {
    return {
      ok: false,
      error: `Свободно ${sessionsRemaining} сессий из ${tier.sessionsLimit}. Уменьшите бюджет цели или архивируйте другие.`,
      field: "sessionsBudget",
    }
  }

  // Целевое действие (опционально). Резолвим goalId в авторитетные name/type
  // из Метрики (не доверяем клиенту) — заодно валидируем, что цель есть в
  // счётчике и Метрика подключена. Иммутабельности тут нет: цель новая,
  // DONE-анализа быть не может.
  let goalData: {
    metrikaGoalId: string
    metrikaGoalName: string
    metrikaGoalType: string
    goalAttachedAt: Date
  } | null = null
  if (parsed.data.goalId) {
    const resolved = await resolveGoalForSite(
      session.user.id,
      parsed.data.siteId,
      parsed.data.goalId,
    )
    if (!resolved.ok) {
      return { ok: false, error: goalErrorMessage(resolved.reason) }
    }
    goalData = {
      metrikaGoalId: parsed.data.goalId,
      metrikaGoalName: resolved.name,
      metrikaGoalType: resolved.type,
      goalAttachedAt: new Date(),
    }
  }

  await prisma.analysisTarget.create({
    data: {
      siteId: parsed.data.siteId,
      url: parsed.data.url,
      name: parsed.data.name || null,
      sessionsBudget: parsed.data.sessionsBudget,
      ...(goalData ?? {}),
      // status default ACTIVE из schema.
    },
  })

  revalidatePath("/dashboard/targets")
  revalidatePath("/dashboard")

  return {
    ok: true,
    message: "Цель создана. Сбор сессий начнётся автоматически.",
  }
}

// Тексты ошибок резолва/сохранения целевого действия. Ни один не показывает
// «0%» и каждый говорит, что делать (см. DECISIONS 2026-07-28, 2A.2).
function goalErrorMessage(
  reason:
    | "forbidden"
    | "not_configured"
    | "goal_not_found"
    | "metrika_unavailable"
    | "auth_failed"
    | "counter_forbidden"
    | "rate_limited",
): string {
  switch (reason) {
    case "not_configured":
      return "Сначала подключите Яндекс.Метрику в Настройках → Метрика."
    case "goal_not_found":
      return "Цель не найдена в счётчике Метрики. Обновите список и выберите заново."
    case "auth_failed":
      return "Токен Яндекс.Метрики истёк или недействителен. Обновите его в Настройках → Метрика."
    case "counter_forbidden":
      return "Метрика отклонила запрос — токен недействителен или нет доступа к счётчику. Проверьте токен и права в Настройках → Метрика."
    case "rate_limited":
      return "Слишком много обращений к Метрике. Подождите пару минут."
    case "forbidden":
      return "Сайт не найден."
    default:
      return "Яндекс.Метрика временно недоступна. Попробуйте позже."
  }
}

// Ленивая загрузка целей счётчика для дропдауна (вызывается при открытии,
// не на рендер страницы). Возвращает цели БЕЗ токена.
export async function loadSiteGoals(siteId: string): Promise<SiteGoalsResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, reason: "forbidden" }
  return getGoalsForSite(session.user.id, siteId)
}

// Установка/смена/сброс целевого действия у цели. Гейты: ownership +
// иммутабельность (нет DONE-анализа) + (при установке) валидность goalId в
// счётчике. Дублирует клиентский гейт goalLocked — клиенту не доверяем.
export async function setTargetGoal(
  targetId: string,
  goalId: string, // "" = сбросить
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: "Не авторизован" }

  const target = await prisma.analysisTarget.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      siteId: true,
      metrikaGoalId: true,
      analyses: { where: { status: "DONE" }, select: { id: true }, take: 1 },
    },
  })
  if (!target) return { ok: false, error: "Цель не найдена" }

  const owns = await validateSiteOwnership(target.siteId, session.user.id)
  if (!owns) return { ok: false, error: "Цель не найдена" }

  // Иммутабельность: менять/сбрасывать УЖЕ ЗАДАННОЕ действие после DONE-анализа
  // нельзя (прежние рекомендации противоречили бы новой цифре). ПЕРВАЯ
  // установка на цель с анализами (действие ещё не задано) — РАЗРЕШЕНА:
  // противоречить нечему, старые поведенческие рекомендации ни на какой
  // процент не опирались.
  if (target.metrikaGoalId !== null && target.analyses.length > 0) {
    return {
      ok: false,
      error:
        "Целевое действие зафиксировано после первого анализа — сменить его нельзя.",
    }
  }

  // Сброс.
  if (!goalId) {
    await prisma.analysisTarget.update({
      where: { id: targetId },
      data: {
        metrikaGoalId: null,
        metrikaGoalName: null,
        metrikaGoalType: null,
        goalAttachedAt: null,
      },
    })
    revalidatePath("/dashboard/targets")
    return { ok: true, message: "Целевое действие сброшено" }
  }

  // Установка: резолвим авторитетные name/type из Метрики.
  const resolved = await resolveGoalForSite(session.user.id, target.siteId, goalId)
  if (!resolved.ok) return { ok: false, error: goalErrorMessage(resolved.reason) }

  await prisma.analysisTarget.update({
    where: { id: targetId },
    data: {
      metrikaGoalId: goalId,
      metrikaGoalName: resolved.name,
      metrikaGoalType: resolved.type,
      goalAttachedAt: new Date(),
    },
  })
  revalidatePath("/dashboard/targets")
  revalidatePath("/dashboard/recommendations")
  return { ok: true, message: `Целевое действие: ${resolved.name}` }
}

const archiveSchema = z.object({
  targetId: z.string().min(1),
})

export async function archiveTarget(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: "Не авторизован" }

  const parsed = archiveSchema.safeParse({
    targetId: formData.get("targetId"),
  })
  if (!parsed.success) return { ok: false, error: "Неверные данные" }

  const target = await prisma.analysisTarget.findUnique({
    where: { id: parsed.data.targetId },
    select: {
      id: true,
      siteId: true,
      status: true,
      sessionsBudget: true,
      sessionsCollected: true,
      archivedAt: true,
    },
  })
  if (!target) return { ok: false, error: "Цель не найдена" }
  if (target.archivedAt) return { ok: false, error: "Цель уже архивирована" }
  if (target.status === "ANALYZING") {
    return {
      ok: false,
      error:
        "Нельзя архивировать цель пока идёт AI-анализ. Дождитесь завершения.",
    }
  }
  if (
    (target.status === "ACTIVE" || target.status === "READY") &&
    target.sessionsCollected > 0
  ) {
    return {
      ok: false,
      error:
        "Сначала запустите анализ собранных сессий. Нельзя архивировать цель с собранными данными до AI-анализа.",
    }
  }

  const owns = await validateSiteOwnership(target.siteId, session.user.id)
  if (!owns) return { ok: false, error: "Цель не найдена" }

  // DECISIONS.md "2026-05-05 — Hotfix 5: финальная модель архивации".
  // Status НЕ перезаписываем. Если был ACTIVE с collected=0 — остаётся
  // ACTIVE+archived (юзер передумал до сбора). Если был COMPLETED —
  // остаётся COMPLETED+archived (анализ был завершён). sessionsAllocated
  // в targets-data.ts учитывает архивированные через sessionsCollected,
  // что автоматически возвращает разницу (sessionsBudget - collected)
  // на свободный баланс.
  await prisma.analysisTarget.update({
    where: { id: target.id },
    data: { archivedAt: new Date() },
  })

  revalidatePath("/dashboard/targets")
  revalidatePath("/dashboard")

  return { ok: true, message: "Цель архивирована" }
}

