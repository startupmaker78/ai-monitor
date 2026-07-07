import { NextRequest, NextResponse } from "next/server"
import { trackingPacketSchema } from "@/lib/tracking-schema"
import { prisma } from "@/lib/prisma"
import { putJson } from "@/lib/storage"
import { hashIp, extractClientIp } from "@/lib/ip-hash"

// Yandex Serverless Containers имеет hard architectural limit 3.5 MB на
// размер HTTP request (headers + body). Это не quota — поднять нельзя
// ни через support, ни через флаги deploy. Источник:
// https://yandex.cloud/en/docs/serverless-containers/concepts/limits
//
// Оставляем ~500 KB на headers (Cookie, User-Agent, Content-Type, etc),
// body cap = 3 MiB. FullSnapshot rrweb с inlineStylesheet:true для
// типичной Tilda-страницы укладывается в этот размер. Outliers >3 MiB
// будут чанковаться в трекере (TODO в DECISIONS 2026-05-08, не в этом
// коммите).
const MAX_BODY_BYTES = 3 * 1024 * 1024

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

  // Serverside validation packet.targetId. Клиенту НЕ доверяем — он мог
  // прислать чужой/архивированный/несуществующий target. Не reject'им
  // весь packet, а просто сбрасываем targetId → сессия становится
  // orphan (analysisTargetId=null, sessionsCollected не тронут). Это
  // совместимо со старым tracker.js (тоже без targetId → orphan).
  //
  // archivedAt=null ЕДИНСТВЕННЫЙ жёсткий гейт. Статус (ACTIVE/READY/
  // ANALYZING/COMPLETED) намеренно не проверяется: между первым и
  // последующими packet'ами target мог перейти в ANALYZING/COMPLETED
  // (юзер запустил анализ) — in-flight сессия должна дописаться.
  let validatedTargetId: string | null = null
  if (packet.targetId) {
    const target = await prisma.analysisTarget.findUnique({
      where: { id: packet.targetId },
      select: { id: true, siteId: true, archivedAt: true },
    })
    if (target && target.siteId === site.id && target.archivedAt === null) {
      validatedTargetId = target.id
    } else {
      console.warn(
        "[tracking] rejecting targetId=" + packet.targetId +
          " for site=" + site.id + ": not owned or archived",
      )
    }
  }

  // Packet в Object Storage. Ключ:
  //   sessions/{siteId}/{sessionToken}/{packetIndex}.json
  // Lifecycle policy на префикс sessions/ удаляет объекты старше 30 дней.
  const storageKey =
    "sessions/" + site.id + "/" + packet.sessionToken + "/" +
    packet.packetIndex + ".json"

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

  // Session в PostgreSQL. См. DECISIONS 2026-05-08 / plans/
  // record-only-on-target-plan.md C.3 — атомарный createMany +
  // skipDuplicates + branching:
  //   FIRST packet (createMany.count === 1):
  //     — Session row создан с eventsCount = packet.events.length,
  //       analysisTargetId = validatedTargetId,
  //       endedAt = packet.isFinal ? now : null
  //     — Если есть validatedTargetId → инкремент sessionsCollected
  //       (ровно один раз за жизнь сессии)
  //   SUBSEQUENT packet (count === 0):
  //     — Session уже существует, обновляем eventsCount (increment) и
  //       опционально endedAt (если isFinal). analysisTargetId
  //       immutable — targetId, попавший в create, остаётся навсегда.
  //
  // Race двух concurrent packets того же sessionToken разруливается
  // unique-constraint на Session.sessionToken (@unique в schema).
  const prefix = "sessions/" + site.id + "/" + packet.sessionToken + "/"
  const nowDate = new Date()
  const startedAtDate = new Date(packet.startedAt)
  const ipHash = hashIp(extractClientIp(req))

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.session.createMany({
        data: [
          {
            siteId: site.id,
            sessionToken: packet.sessionToken,
            ipHash,
            userAgent: packet.userAgent,
            startedAt: startedAtDate,
            endedAt: packet.isFinal ? nowDate : null,
            eventsCount: packet.events.length,
            storageKey: prefix,
            analysisTargetId: validatedTargetId,
          },
        ],
        skipDuplicates: true,
      })

      const isFirstPacket = created.count === 1

      if (!isFirstPacket) {
        // TODO: eventsCount increment всё ещё не идемпотентен на retry
        // одного packetIndex (DECISIONS 2026-05-03 «acceptable»).
        // Проблема out of scope этого коммита.
        await tx.session.update({
          where: { sessionToken: packet.sessionToken },
          data: {
            eventsCount: { increment: packet.events.length },
            ...(packet.isFinal ? { endedAt: nowDate } : {}),
          },
        })
      }

      if (isFirstPacket && validatedTargetId) {
        await tx.analysisTarget.update({
          where: { id: validatedTargetId },
          data: { sessionsCollected: { increment: 1 } },
        })
      }
    })
  } catch (err) {
    console.error(
      "[tracking] Session transaction failed:",
      (err as Error).message,
    )
    return corsResponse(
      { error: "session_transaction_failed" },
      { status: 500 },
    )
  }

  console.log(
    "[tracking] siteId=" + site.id +
      " session=" + packet.sessionToken.slice(0, 8) +
      " packet=" + packet.packetIndex +
      " events=" + packet.events.length +
      " target=" + (validatedTargetId ? validatedTargetId.slice(0, 8) : "-") +
      " final=" + (packet.isFinal ? "Y" : "N") +
      " bytes=" + raw.length,
  )

  return corsResponse(
    { ok: true, accepted: packet.events.length },
    { status: 200 },
  )
}
