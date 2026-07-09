import { NextRequest, NextResponse } from "next/server"
import zlib from "node:zlib"
import { trackingPacketSchema } from "@/lib/tracking-schema"
import { prisma, withDbRetry, isTransientDbError } from "@/lib/prisma"
import { putJson } from "@/lib/storage"
import { hashIp, extractClientIp } from "@/lib/ip-hash"

// zlib.gunzipSync требует Node runtime (в Edge его нет). Route и так
// node-only (Prisma pg-adapter + aws-sdk), но раньше явного export'а не
// было — фиксируем, чтобы разжатие gzip не сломалось при смене дефолта.
export const runtime = "nodejs"

// Yandex Serverless proxy имеет hard architectural limit 3.5 MB на
// размер HTTP request (headers + body). Это не quota — поднять нельзя
// ни через support, ни через флаги deploy. Эмпирически подтверждено
// (2026-07-09): лимит считается по СЖАТОМУ телу на проводе — gzip-пакет
// 4.8 KB, распаковывающийся в 4.77 MB, проходит; сырые 4.77 MB режутся
// 413 на пороге 3670016 B (3.5 MiB). Ни API Gateway, ни контейнерный
// proxy НЕ разжимают Content-Encoding:gzip. Источник лимита:
// https://yandex.cloud/en/docs/serverless-containers/concepts/limits
//
// MAX_WIRE_BYTES — потолок тела как оно пришло по проводу (сжатого для
// gzip-ветки, сырого JSON для text-ветки). Оставляем ~500 KB на headers,
// body cap = 3 MiB. FullSnapshot rrweb в gzip укладывается с запасом.
const MAX_WIRE_BYTES = 3 * 1024 * 1024

// MAX_INFLATED_BYTES — потолок РАСПАКОВАННОГО тела (anti-zip-bomb).
// Маленький gzip может распаковаться в гигабайты и убить память
// контейнера. 8 MiB — с запасом на будущий рост снапшотов, но конечный.
// Enforced через zlib maxOutputLength (обрывает распаковку на пороге,
// не аллоцируя весь выход) — memory-safe, а не post-hoc проверка.
const MAX_INFLATED_BYTES = 8 * 1024 * 1024

// Динамический CORS: `sendBeacon` (используется трекером для финального
// sentinel-пакета) ВСЕГДА шлёт cross-origin с credentials:'include' по
// browser spec (отключить нельзя). Комбо wildcard '*' + credentials
// запрещено браузерами → beacon блокируется CORS → sentinel не долетает.
//
// Решение: если Origin передан в запросе — рефлектим его обратно и
// разрешаем credentials. Vary: Origin, чтобы CDN/прокси не смешивали
// ответы разных origin'ов. Если Origin нет (server-to-server, curl) —
// wildcard без credentials (безопасный fallback).
function corsHeaders(origin: string | null): Record<string, string> {
  if (origin) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    }
  }
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  }
}

function corsResponse(
  body: unknown,
  origin: string | null,
  init: ResponseInit = {},
): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { ...corsHeaders(origin), ...init.headers },
  })
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin")

  const contentLength = req.headers.get("content-length")
  if (contentLength && parseInt(contentLength, 10) > MAX_WIRE_BYTES) {
    return corsResponse(
      { error: "payload_too_large", maxBytes: MAX_WIRE_BYTES },
      origin,
      { status: 413 },
    )
  }

  // Развилка по Content-Encoding. Новый tracker.js шлёт gzip
  // (CompressionStream) на пути sendPacket; старый tracker.js и
  // beacon-sentinel (events=[]) шлют голый JSON без заголовка. Оба
  // варианта принимаем — backward compat гарантируется этой развилкой.
  const contentEncoding = req.headers.get("content-encoding")
  let raw: string
  if (contentEncoding === "gzip") {
    let buf: Buffer
    try {
      buf = Buffer.from(await req.arrayBuffer())
    } catch {
      return corsResponse({ error: "cannot_read_body" }, origin, { status: 400 })
    }
    // Wire-size guard на СЖАТЫХ байтах — Content-Length может
    // отсутствовать (chunked) или быть подделан, buf.length надёжен.
    if (buf.length > MAX_WIRE_BYTES) {
      return corsResponse(
        { error: "payload_too_large", maxBytes: MAX_WIRE_BYTES },
        origin,
        { status: 413 },
      )
    }
    // maxOutputLength обрывает распаковку на MAX_INFLATED_BYTES, НЕ
    // аллоцируя весь выход — защита от gzip-бомбы memory-safe.
    let inflated: Buffer
    try {
      inflated = zlib.gunzipSync(buf, { maxOutputLength: MAX_INFLATED_BYTES })
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      // Превышение maxOutputLength → anti-zip-bomb trip → 413.
      // Иначе битый/невалидный gzip-поток → 400 invalid_encoding (не 500).
      if (
        e.code === "ERR_BUFFER_TOO_LARGE" ||
        /maxOutputLength|larger than|exceed/i.test(e.message ?? "")
      ) {
        return corsResponse(
          { error: "payload_too_large", maxBytes: MAX_INFLATED_BYTES },
          origin,
          { status: 413 },
        )
      }
      return corsResponse({ error: "invalid_encoding" }, origin, { status: 400 })
    }
    raw = inflated.toString("utf8")
  } else {
    try {
      raw = await req.text()
    } catch {
      return corsResponse({ error: "cannot_read_body" }, origin, { status: 400 })
    }
    if (raw.length > MAX_WIRE_BYTES) {
      return corsResponse(
        { error: "payload_too_large", maxBytes: MAX_WIRE_BYTES },
        origin,
        { status: 413 },
      )
    }
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return corsResponse({ error: "invalid_json" }, origin, { status: 400 })
  }

  const parsed = trackingPacketSchema.safeParse(json)
  if (!parsed.success) {
    return corsResponse(
      { error: "invalid_payload", issues: parsed.error.issues },
      origin,
      { status: 400 },
    )
  }

  const packet = parsed.data

  const sessionTail = packet.sessionToken.slice(-4)

  let site: { id: string; domain: string; isDemo: boolean } | null
  try {
    site = await withDbRetry(() =>
      prisma.site.findUnique({
        where: { trackingToken: packet.siteToken },
        select: { id: true, domain: true, isDemo: true },
      }),
    )
  } catch (err) {
    const e = err as Error
    console.error(
      "[tracking] site.findUnique DB " +
        (isTransientDbError(err) ? "retry exhausted" : "error") +
        " sessionTail=..." + sessionTail +
        " err=" + e.name + ":" + e.message,
    )
    return corsResponse({ error: "db_unavailable" }, origin, { status: 503 })
  }
  if (!site) {
    return corsResponse({ error: "unknown_site" }, origin, { status: 401 })
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
    let target:
      | { id: string; siteId: string; archivedAt: Date | null }
      | null
    try {
      target = await withDbRetry(() =>
        prisma.analysisTarget.findUnique({
          where: { id: packet.targetId! },
          select: { id: true, siteId: true, archivedAt: true },
        }),
      )
    } catch (err) {
      const e = err as Error
      console.error(
        "[tracking] target.findUnique DB " +
          (isTransientDbError(err) ? "retry exhausted" : "error") +
          " sessionTail=..." + sessionTail +
          " err=" + e.name + ":" + e.message,
      )
      return corsResponse({ error: "db_unavailable" }, origin, { status: 503 })
    }
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
    return corsResponse({ error: "storage_failed" }, origin, { status: 503 })
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
    // withDbRetry вокруг ВСЕЙ транзакции: при разрыве TCP до commit'а
    // сервер откатит транзакцию, повтор безопасно создаст с нуля.
    // При разрыве ПОСЛЕ commit'а (клиент не получил ack) — createMany
    // с skipDuplicates во втором вызове увидит уже созданный row →
    // count=0 → isFirstPacket=false → sessionsCollected НЕ инкрементится
    // повторно (гейт `isFirstPacket && validatedTargetId`). Порядок
    // счётчика target'а корректен независимо от повтора.
    // Известный компромисс: eventsCount может удвоиться в edge-case
    // post-commit disconnect'а (session уже создана с
    // eventsCount=packet.events.length, повтор пойдёт в
    // SUBSEQUENT-ветку с increment); задокументировано как acceptable
    // в DECISIONS 2026-05-03. Не блокер, sessionsCollected приоритет.
    await withDbRetry(() => prisma.$transaction(async (tx) => {
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
        const updated = await tx.analysisTarget.update({
          where: { id: validatedTargetId },
          data: { sessionsCollected: { increment: 1 } },
          select: {
            sessionsCollected: true,
            sessionsBudget: true,
            status: true,
          },
        })

        // Budget filled → цель становится analysable. Гейт `status:
        // "ACTIVE"` внутри updateMany делает переход атомарно-once:
        // если другая параллельная транзакция уже flipла в READY (или
        // юзер вручную запустил анализ и цель уже ANALYZING/COMPLETED),
        // count вернётся 0 — no-op. updateMany вместо update, потому
        // что `{id, status}` — non-unique compound, Prisma update
        // такой where не принимает.
        //
        // Логика восстанавливает поведение, потерянное с удалением
        // matcher'а в pivot 2026-07-07 (record-only-on-target).
        if (
          updated.status === "ACTIVE" &&
          updated.sessionsCollected >= updated.sessionsBudget
        ) {
          await tx.analysisTarget.updateMany({
            where: { id: validatedTargetId, status: "ACTIVE" },
            data: { status: "READY" },
          })
        }
      }
    }))
  } catch (err) {
    const e = err as Error
    const transient = isTransientDbError(err)
    console.error(
      "[tracking] Session transaction " +
        (transient ? "retry exhausted" : "failed") +
        " sessionTail=..." + sessionTail +
        " err=" + e.name + ":" + e.message,
    )
    return corsResponse(
      { error: transient ? "db_unavailable" : "session_transaction_failed" },
      origin,
      { status: transient ? 503 : 500 },
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
    origin,
    { status: 200 },
  )
}
