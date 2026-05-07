import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { randomUUID } from "crypto"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { normalizeDomain } from "@/lib/site-utils"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const createSchema = z.object({
  domain: z.string().min(1).max(255),
  name: z.string().max(100).nullable().optional(),
})

async function getOwnerProfileId(userId: string): Promise<string | null> {
  const op = await prisma.ownerProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  return op?.id ?? null
}

const SITE_SELECT = {
  id: true,
  domain: true,
  name: true,
  trackingToken: true,
  isDemo: true,
  createdAt: true,
} as const

export async function GET(): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "unauthorized", message: "Не авторизован" },
      { status: 401 },
    )
  }
  const ownerProfileId = await getOwnerProfileId(session.user.id)
  if (!ownerProfileId) {
    return NextResponse.json({ sites: [] })
  }
  const sites = await prisma.site.findMany({
    where: { ownerId: ownerProfileId },
    orderBy: [{ isDemo: "desc" }, { createdAt: "desc" }],
    select: SITE_SELECT,
  })
  return NextResponse.json({ sites })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
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
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", message: "Введите корректный домен" },
      { status: 400 },
    )
  }

  const normalizedDomain = normalizeDomain(parsed.data.domain)
  if (!normalizedDomain) {
    return NextResponse.json(
      { error: "bad_request", message: "Введите корректный домен" },
      { status: 400 },
    )
  }

  const ownerProfileId = await getOwnerProfileId(session.user.id)
  if (!ownerProfileId) {
    return NextResponse.json(
      { error: "unauthorized", message: "Не авторизован" },
      { status: 401 },
    )
  }

  // Программная проверка дубля. В schema нет @@unique([ownerId, domain]) —
  // полагаемся на findFirst, миграция добавится отдельным коммитом если
  // потребуется усилить гарантию.
  const existing = await prisma.site.findFirst({
    where: { ownerId: ownerProfileId, domain: normalizedDomain },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json(
      { error: "conflict", message: "Сайт уже добавлен" },
      { status: 409 },
    )
  }

  // TODO: при реализации этапа 10 (тарифы) — добавить sitesLimit в
  // TIER_CONFIG (lib/tier-limits.ts) и проверять количество активных
  // Sites владельца перед созданием. На MVP лимит = Infinity.

  const trimmedName = parsed.data.name?.trim()
  const created = await prisma.site.create({
    data: {
      ownerId: ownerProfileId,
      domain: normalizedDomain,
      name: trimmedName || null,
      trackingToken: randomUUID().replace(/-/g, ""),
      isDemo: false,
    },
    select: SITE_SELECT,
  })
  return NextResponse.json(created, { status: 201 })
}
