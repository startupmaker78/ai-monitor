import { NextRequest, NextResponse } from "next/server"
import { trackingPacketSchema } from "@/lib/tracking-schema"
import { prisma } from "@/lib/prisma"
import { putJson } from "@/lib/storage"
import { hashIp, extractClientIp } from "@/lib/ip-hash"

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

  // Шаг 6: пакет в Object Storage. Ключ:
  //   sessions/{siteId}/{sessionToken}/{packetIndex}.json
  // Lifecycle policy на префикс sessions/ удаляет объекты старше 30 дней
  // (см. ROADMAP этап 0.a). При AI-анализе сессии достаём все пакеты
  // через listKeys('sessions/{siteId}/{sessionToken}/').
  const storageKey =
    `sessions/${site.id}/${packet.sessionToken}/${packet.packetIndex}.json`

  try {
    await putJson(storageKey, {
      sessionToken: packet.sessionToken,
      packetIndex: packet.packetIndex,
      isFinal: packet.isFinal,
      pageUrl: packet.pageUrl,
      userAgent: packet.userAgent,
      startedAt: packet.startedAt,
      receivedAt: Date.now(),
      events: packet.events,
    })
  } catch (err) {
    console.error(
      "[tracking] Object Storage write failed:",
      (err as Error).message,
    )
    return corsResponse({ error: "storage_failed" }, { status: 503 })
  }

  // Шаг 7: Session в PostgreSQL. Идемпотентно через upsert по sessionToken
  // (он @unique). Первый пакет создаёт ряд, последующие инкрементят
  // eventsCount. isFinal выставляет endedAt.
  const ipHash = hashIp(extractClientIp(req))
  const now = new Date()
  const sessionPrefix = `sessions/${site.id}/${packet.sessionToken}/`

  try {
    await prisma.session.upsert({
      where: { sessionToken: packet.sessionToken },
      create: {
        siteId: site.id,
        sessionToken: packet.sessionToken,
        ipHash,
        userAgent: packet.userAgent,
        startedAt: new Date(packet.startedAt),
        endedAt: packet.isFinal ? now : null,
        eventsCount: packet.events.length,
        storageKey: sessionPrefix,
        // analysisTargetId — null в этом коммите, выставится в 5/8
      },
      update: {
        // TODO: not idempotent on retry. eventsCount can drift if the client
        // retries the same packetIndex. Acceptable for MVP because eventsCount
        // is telemetry only — real session content lives in Object Storage
        // (idempotent: putJson overwrites by key). When we wire
        // Subscription.sessionsCollected to billing tariff limits, switch to
        // INSERT ... ON CONFLICT DO NOTHING via separate SessionPacketReceipt
        // table with UNIQUE (sessionToken, packetIndex).
        eventsCount: { increment: packet.events.length },
        ...(packet.isFinal ? { endedAt: now } : {}),
      },
    })
  } catch (err) {
    console.error(
      "[tracking] Session upsert failed:",
      (err as Error).message,
    )
    return corsResponse(
      { error: "session_upsert_failed" },
      { status: 500 },
    )
  }

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
