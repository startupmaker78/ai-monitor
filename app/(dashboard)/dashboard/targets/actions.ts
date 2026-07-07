"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getEffectiveTier } from "@/lib/tier-limits"
import { validateSiteOwnership } from "@/lib/site-data"
import { getMinSessionsBudget } from "@/lib/config"

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
  })

  const parsed = createSchema.safeParse({
    siteId: formData.get("siteId"),
    url: formData.get("url"),
    name: formData.get("name") ?? "",
    sessionsBudget: formData.get("sessionsBudget"),
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

  // 2. Дубль URL на сайте (siteId + url).
  const newUrlNormalized = normalizeUrl(parsed.data.url)
  const isDuplicate = activeTargets.some(
    (t) => normalizeUrl(t.url) === newUrlNormalized,
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

  await prisma.analysisTarget.create({
    data: {
      siteId: parsed.data.siteId,
      url: parsed.data.url,
      name: parsed.data.name || null,
      sessionsBudget: parsed.data.sessionsBudget,
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

// Нормализация URL для проверки дублей. Дублирует логику
// lib/analysis-target-matcher.ts намеренно — локальная ответственность,
// вынесем в общий util если будет третий callsite.
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.search = ""
    u.hash = ""
    u.hostname = u.hostname.toLowerCase()
    let path = u.pathname
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1)
    }
    return `${u.protocol}//${u.host}${path}`
  } catch {
    return raw
  }
}
