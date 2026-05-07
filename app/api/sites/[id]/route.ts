import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

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
  const sessionsCount = await prisma.session.count({
    where: { siteId: site.id },
  })
  if (sessionsCount > 0) {
    return NextResponse.json(
      {
        error: "conflict",
        message:
          "Удаление сайтов с собранными сессиями пока не поддерживается. Удалите сайт после полной очистки сессий (через 30 дней).",
      },
      { status: 409 },
    )
  }
  await prisma.site.delete({ where: { id: site.id } })
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
