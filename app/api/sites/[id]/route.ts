import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { listKeys, deleteObjects } from "@/lib/storage"

const S3_BATCH_SIZE = 1000 // хардкод из S3 DeleteObjects API

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SITE_SELECT = {
  id: true,
  domain: true,
  name: true,
  trackingToken: true,
  isDemo: true,
  createdAt: true,
} as const

// Проверка ownership: сайт принадлежит юзеру через OwnerProfile. На любую
// проблему (нет OwnerProfile, чужой site) возвращаем null — caller
// отдаёт 404 без раскрытия существования чужих сайтов.
async function loadOwnedSite(siteId: string, userId: string) {
  const op = await prisma.ownerProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (!op) return null
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, ownerId: true, isDemo: true, domain: true },
  })
  if (!site || site.ownerId !== op.id) return null
  return site
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "unauthorized", message: "Не авторизован" },
      { status: 401 },
    )
  }
  const site = await loadOwnedSite(params.id, session.user.id)
  if (!site) {
    return NextResponse.json(
      { error: "not_found", message: "Сайт не найден" },
      { status: 404 },
    )
  }
  if (site.isDemo) {
    return NextResponse.json(
      { error: "forbidden", message: "Демо-сайт нельзя удалить" },
      { status: 403 },
    )
  }

  // 1. S3 cleanup ПЕРЕД транзакцией. S3 не транзакционен, а транзакция
  // Prisma должна быть атомарной — оставляем S3 отдельно. Если что-то
  // не удалилось в S3, не блокируем DB deletion: orphaned объекты
  // уберёт lifecycle policy на префикс sessions/ (30 дней).
  try {
    const keys = await listKeys(`sessions/${site.id}/`)
    if (keys.length > 0) {
      let totalFailed = 0
      for (let i = 0; i < keys.length; i += S3_BATCH_SIZE) {
        const batch = keys.slice(i, i + S3_BATCH_SIZE)
        const failed = await deleteObjects(batch)
        totalFailed += failed.length
      }
      if (totalFailed > 0) {
        console.warn(
          `[site-delete] S3 cleanup: ${totalFailed} keys failed for site ${site.id}`,
        )
      }
    }
  } catch (err) {
    console.warn(
      `[site-delete] S3 cleanup failed for site ${site.id}: ${(err as Error).message}`,
    )
  }

  // 2. DB cleanup в транзакции. Порядок важен из-за Restrict FKs:
  //  - Analysis (Restrict-refs Site и AnalysisTarget) → удаляем первым;
  //    Recommendation cascade'ит автоматически (onDelete: Cascade)
  //  - Session (Restrict-refs Site, SetNull-refs AnalysisTarget) →
  //    SetNull не срабатывает, потому что мы уже не выходим из
  //    транзакции; безопасно удалять раньше AnalysisTarget
  //  - AnalysisTarget (Restrict-refs Site) → теперь ничто на неё
  //    не Restrict-ссылается
  //  - MetricsSnapshot (Restrict-refs Site)
  //  - Site last
  try {
    await prisma.$transaction([
      prisma.analysis.deleteMany({ where: { siteId: site.id } }),
      prisma.session.deleteMany({ where: { siteId: site.id } }),
      prisma.analysisTarget.deleteMany({ where: { siteId: site.id } }),
      prisma.metricsSnapshot.deleteMany({ where: { siteId: site.id } }),
      prisma.site.delete({ where: { id: site.id } }),
    ])
  } catch (err) {
    console.error(
      `[site-delete] DB transaction failed for site ${site.id}:`,
      (err as Error).message,
    )
    return NextResponse.json(
      { error: "delete_failed", message: "Не удалось удалить сайт" },
      { status: 500 },
    )
  }

  return new NextResponse(null, { status: 204 })
}

const patchSchema = z.object({ name: z.string().max(100).nullable() })

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "unauthorized", message: "Не авторизован" },
      { status: 401 },
    )
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "Невалидный JSON" },
      { status: 400 },
    )
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", message: "Невалидное name" },
      { status: 400 },
    )
  }
  const site = await loadOwnedSite(params.id, session.user.id)
  if (!site) {
    return NextResponse.json(
      { error: "not_found", message: "Сайт не найден" },
      { status: 404 },
    )
  }
  if (site.isDemo) {
    return NextResponse.json(
      { error: "forbidden", message: "Демо-сайт нельзя редактировать" },
      { status: 403 },
    )
  }
  const trimmed = parsed.data.name?.trim()
  const updated = await prisma.site.update({
    where: { id: site.id },
    data: { name: trimmed || null },
    select: SITE_SELECT,
  })
  return NextResponse.json(updated)
}
