import { prisma } from "@/lib/prisma"
import type { Recommendation } from "@prisma/client"

export type TargetWithRecs = {
  id: string
  name: string | null
  url: string
}

// Список target'ов у которых есть хотя бы один DONE-анализ с
// рекомендациями. Для dropdown в /dashboard/recommendations.
// Сортировка: target с самым свежим DONE-анализом первым.
// Ownership через User → OwnerProfile → Site.
export async function loadTargetsWithRecommendations(
  userId: string,
): Promise<TargetWithRecs[]> {
  const op = await prisma.ownerProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (!op) return []

  const raw = await prisma.analysisTarget.findMany({
    where: {
      site: { ownerId: op.id },
      analyses: {
        some: {
          status: "DONE",
          recommendations: { some: {} },
        },
      },
    },
    select: {
      id: true,
      name: true,
      url: true,
      analyses: {
        where: { status: "DONE" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  })

  // Сортировка по последней DONE-analysis.createdAt (desc). Prisma не
  // умеет order by aggregate вложенного relation, делаем в JS.
  const sorted = raw
    .map((t) => ({
      target: { id: t.id, name: t.name, url: t.url },
      lastAnalysisAt: t.analyses[0]?.createdAt.getTime() ?? 0,
    }))
    .sort((a, b) => b.lastAnalysisAt - a.lastAnalysisAt)

  return sorted.map((s) => s.target)
}

export type AnalysisWithRecs = {
  id: string
  createdAt: Date
  sessionsAnalyzed: number
  recommendationsCount: number
  recommendations: Recommendation[]
}

export type LoadedRecommendations = {
  target: { id: string; name: string | null; url: string }
  // ВСЕ DONE-анализы цели, новейший первым. Каждый со своими
  // рекомендациями — история доступна в UI (селектор анализа) без доп.
  // запросов. Дёшево: rec на анализ единицы (6-8), анализов на цель — тоже
  // единицы (растёт при Модели B, но остаётся мало). Пустой массив если
  // DONE-анализов нет.
  analyses: AnalysisWithRecs[]
}

// Загружает target + ВСЕ его DONE-анализы с рекомендациями (новейший
// первым). null если target не найден или не принадлежит юзеру
// (caller → notFound / empty state).
export async function loadRecommendationsForTarget(
  userId: string,
  targetId: string,
): Promise<LoadedRecommendations | null> {
  const op = await prisma.ownerProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (!op) return null

  const target = await prisma.analysisTarget.findUnique({
    where: { id: targetId },
    include: { site: { select: { ownerId: true } } },
  })
  if (!target || target.site.ownerId !== op.id) return null

  const analyses = await prisma.analysis.findMany({
    where: { targetId, status: "DONE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      sessionsAnalyzed: true,
      recommendationsCount: true,
      recommendations: { orderBy: { sortOrder: "asc" } },
    },
  })

  return {
    target: { id: target.id, name: target.name, url: target.url },
    analyses,
  }
}
