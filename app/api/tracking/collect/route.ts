import { NextRequest, NextResponse } from "next/server"
import { trackingPacketSchema } from "@/lib/tracking-schema"
import { prisma } from "@/lib/prisma"

const MAX_BODY_BYTES = 1024 * 1024

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const

function corsResponse(
  body: unknown,
  init: ResponseInit = {},
): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...init.headers },
  })
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const contentLength = req.headers.get("content-length")
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return corsResponse(
      { error: "payload_too_large", maxBytes: MAX_BODY_BYTES },
      { status: 413 },
    )
  }

  let raw: string
  try {
    raw = await req.text()
  } catch {
    return corsResponse({ error: "cannot_read_body" }, { status: 400 })
  }
  if (raw.length > MAX_BODY_BYTES) {
    return corsResponse(
      { error: "payload_too_large", maxBytes: MAX_BODY_BYTES },
      { status: 413 },
    )
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return corsResponse({ error: "invalid_json" }, { status: 400 })
  }

  const parsed = trackingPacketSchema.safeParse(json)
  if (!parsed.success) {
    return corsResponse(
      { error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const packet = parsed.data

  const site = await prisma.site.findUnique({
    where: { trackingToken: packet.siteToken },
    select: { id: true, domain: true, isDemo: true },
  })
  if (!site) {
    return corsResponse({ error: "unknown_site" }, { status: 401 })
  }

  // TODO etap 4 part 4/8: write packet to Object Storage and create/update
  // Session in PostgreSQL. For now we just acknowledge.
  console.log(
    "[tracking] siteId=" + site.id +
      " session=" + packet.sessionToken.slice(0, 8) +
      " packet=" + packet.packetIndex +
      " events=" + packet.events.length +
      " final=" + (packet.isFinal ? "Y" : "N") +
      " bytes=" + raw.length,
  )

  return corsResponse(
    { ok: true, accepted: packet.events.length },
    { status: 200 },
  )
}
