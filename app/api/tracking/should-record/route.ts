import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { normalizeUrl } from "@/lib/url-normalize"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const

// no-store: target может появиться/архивироваться в моменте, и любой
// кеш создаст «сессия не пишется N секунд после создания цели» — плохой
// UX для юзера, только что подключившего target. Один запрос на
// pageload дёшев, кешировать нет смысла.
const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const

function corsResponse(
  body: unknown,
  init: ResponseInit = {},
): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...NO_CACHE_HEADERS, ...init.headers },
  })
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

const querySchema = z.object({
  token: z.string().min(1).max(200),
  url: z.string().min(1).max(2048),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const parsed = querySchema.safeParse({
    token: req.nextUrl.searchParams.get("token"),
    url: req.nextUrl.searchParams.get("url"),
  })
  if (!parsed.success) {
    return corsResponse(
      { record: false, reason: "bad_request" },
      { status: 400 },
    )
  }

  const normalized = normalizeUrl(parsed.data.url)
  if (!normalized) {
    return corsResponse(
      { record: false, reason: "invalid_url" },
      { status: 400 },
    )
  }

  const site = await prisma.site.findUnique({
    where: { trackingToken: parsed.data.token },
    select: { id: true },
  })
  if (!site) {
    return corsResponse(
      { record: false, reason: "unknown_site" },
      { status: 404 },
    )
  }

  // ACTIVE и READY — оба продолжают собирать сессии.
  // ANALYZING/COMPLETED — цель закрыта для новых сессий в этом периоде.
  // archivedAt=null — юзер не удалил цель.
  const targets = await prisma.analysisTarget.findMany({
    where: {
      siteId: site.id,
      archivedAt: null,
      status: { in: ["ACTIVE", "READY"] },
    },
    select: {
      id: true,
      url: true,
      sessionsBudget: true,
      sessionsCollected: true,
    },
    // Defensive: если каким-то образом просочилось несколько ACTIVE
    // target'ов с одним normalized URL (actions.ts блокирует дубли на
    // create — этот путь не должен срабатывать в норме), берём старейший.
    orderBy: { createdAt: "asc" },
  })

  let matched: (typeof targets)[number] | null = null
  for (const t of targets) {
    const tn = normalizeUrl(t.url)
    if (tn && tn === normalized) {
      matched = t
      break
    }
  }

  if (!matched) {
    return corsResponse({ record: false, reason: "no_target" })
  }

  if (matched.sessionsCollected >= matched.sessionsBudget) {
    return corsResponse({ record: false, reason: "budget_exhausted" })
  }

  return corsResponse({ record: true, targetId: matched.id })
}
