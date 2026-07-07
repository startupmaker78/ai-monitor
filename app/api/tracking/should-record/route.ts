import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { normalizeUrl } from "@/lib/url-normalize"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Динамический CORS: reflect Origin + Access-Control-Allow-Credentials,
// если Origin передан (нужно для совместимости с sendBeacon, который
// шлёт credentials:'include' безусловно — см. collect route). Wildcard
// как fallback для server-to-server / curl запросов.
function corsHeaders(origin: string | null): Record<string, string> {
  if (origin) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    }
  }
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  }
}

// no-store: target может появиться/архивироваться в моменте, и любой
// кеш создаст «сессия не пишется N секунд после создания цели» — плохой
// UX для юзера, только что подключившего target. Один запрос на
// pageload дёшев, кешировать нет смысла.
const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const

function corsResponse(
  body: unknown,
  origin: string | null,
  init: ResponseInit = {},
): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...corsHeaders(origin),
      ...NO_CACHE_HEADERS,
      ...init.headers,
    },
  })
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  })
}

const querySchema = z.object({
  token: z.string().min(1).max(200),
  url: z.string().min(1).max(2048),
})

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin")

  const parsed = querySchema.safeParse({
    token: req.nextUrl.searchParams.get("token"),
    url: req.nextUrl.searchParams.get("url"),
  })
  if (!parsed.success) {
    return corsResponse(
      { record: false, reason: "bad_request" },
      origin,
      { status: 400 },
    )
  }

  const normalized = normalizeUrl(parsed.data.url)
  if (!normalized) {
    return corsResponse(
      { record: false, reason: "invalid_url" },
      origin,
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
      origin,
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
    return corsResponse({ record: false, reason: "no_target" }, origin)
  }

  if (matched.sessionsCollected >= matched.sessionsBudget) {
    return corsResponse(
      { record: false, reason: "budget_exhausted" },
      origin,
    )
  }

  return corsResponse({ record: true, targetId: matched.id }, origin)
}
