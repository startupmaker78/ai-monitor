import { NextRequest, NextResponse } from "next/server"
import { prisma, withDbRetry, isTransientDbError } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Safety net для сессий, чей финальный packet до сервера не дошёл (юзер
// force-close, краш браузера, network drop). Без этого Session.endedAt
// остаётся NULL навсегда и сессия не попадает в анализ.
//
// TODO: при следующей миграции Session добавить поле lastPacketAt
// (DateTime, обновляемое в /api/tracking/collect на каждом packet).
// Тогда staleness можно считать по «прошло >30 мин с последнего пакета»,
// а не по «прошло >60 мин с начала сессии». Сейчас fallback на
// startedAt означает что мы случайно финализируем длинные активные
// сессии (юзер реально на сайте >60 мин). Acceptable на MVP.
const STALE_FALLBACK_MINUTES = 60

// Yandex Timer Trigger doesn't allow custom HTTP headers, so the auth
// secret travels inside the message payload (see DECISIONS.md
// 2026-05-03 "CRON_SECRET в Timer Trigger payload").
function extractPayload(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const obj = body as Record<string, unknown>
  if (!Array.isArray(obj.messages) || obj.messages.length === 0) return null
  const first = obj.messages[0]
  if (typeof first !== "object" || first === null) return null
  const firstObj = first as Record<string, unknown>
  if (typeof firstObj.details !== "object" || firstObj.details === null) {
    return null
  }
  const details = firstObj.details as Record<string, unknown>
  return typeof details.payload === "string" ? details.payload : null
}

// Не запускаем computeDominantUrl/findMatchingTarget для этих сессий —
// финальный пакет не дошёл, URL stream может быть неполным. Лучше
// закрыть без target match'а: сессия просто не попадёт в зачёт анализа.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret) {
    console.error("[cron-finalize] CRON_SECRET env var not set")
    return NextResponse.json(
      { error: "server_misconfigured" },
      { status: 500 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const incoming = extractPayload(body)
  if (incoming !== expectedSecret) {
    console.warn("[cron-finalize] auth failed")
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const staleBefore = new Date(
    Date.now() - STALE_FALLBACK_MINUTES * 60 * 1000,
  )

  // withDbRetry: cron тикает раз в 15 мин. Сейчас контейнер на
  // scale-to-zero → каждый тик холодный старт → свежее pg-соединение,
  // поэтому stale-connection не проявляется. Но если контейнер станет
  // «тёплым» (min_instances>0 / рост трафика) — первый запрос после
  // idle поймает мёртвое idle-соединение из пула. Оборачиваем в общий
  // withDbRetry (1 повтор на transient) — единообразно с collect/
  // should-record. Критерий финализации не меняем.
  let result: { count: number }
  try {
    result = await withDbRetry(() =>
      prisma.session.updateMany({
        where: {
          endedAt: null,
          startedAt: { lt: staleBefore },
        },
        data: {
          endedAt: new Date(),
        },
      }),
    )
  } catch (err) {
    const e = err as Error
    const transient = isTransientDbError(err)
    console.error(
      "[cron-finalize] db " +
        (transient ? "retry exhausted" : "error") +
        " err=" + e.name + ":" + e.message,
    )
    // Не роняем голым throw: cron переживёт сбой и отработает на
    // следующем тике. Осмысленный ответ для наблюдаемости.
    return NextResponse.json(
      { finalized: 0, error: transient ? "db_unavailable" : "db_error" },
      { status: transient ? 503 : 500 },
    )
  }

  console.log(`[cron-finalize] Finalized ${result.count} stale sessions`)

  return NextResponse.json({
    finalized: result.count,
    timestamp: new Date().toISOString(),
  })
}
