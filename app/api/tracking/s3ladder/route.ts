// ⚠️ TEMP ДИАГНОСТИЧЕСКИЙ РОУТ — УДАЛИТЬ ПОСЛЕ ЗАМЕРА.
// Лесенка concurrency параллельного S3-чтения ИЗ КОНТЕЙНЕРА через наш
// s3Client (с текущим requestHandler). Находит порог, на котором
// параллельный getJson виснет (инцидент 2026-07-15: сбор 10-50 parallel
// зависает, запись 1-за-раз работает). Guard по CRON_SECRET. Использует
// РЕАЛЬНЫЕ ключи пакетов academy. НЕ ОСТАВЛЯТЬ В ПРОДЕ.
import { NextRequest, NextResponse } from "next/server"
import { listKeys, getJson } from "@/lib/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SITE = "cmrat2wcs00002u3cdg15w2t6"
const LEVELS = [1, 3, 5, 10, 25, 50]
const LEVEL_TIMEOUT_MS = 15000

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Promise.race с таймаутом — НЕ отменяет underlying (зависшие getJson
// продолжат висеть в фоне, temp-роут это переживёт), но не даёт уровню
// заблокировать замер.
async function raceTimeout<T>(
  p: Promise<T>,
  ms: number,
): Promise<{ done: true; value: T } | { done: false }> {
  return Promise.race([
    p.then((value) => ({ done: true as const, value })),
    sleep(ms).then(() => ({ done: false as const })),
  ])
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.nextUrl.searchParams.get("secret") !== cronSecret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  try {
    // 1) единичный listKeys (сам по себе read — если ЗАВИСНЕТ, это находка).
    const lt0 = Date.now()
    const listRes = await raceTimeout(
      listKeys(`sessions/${SITE}/`),
      LEVEL_TIMEOUT_MS,
    )
    const listMs = Date.now() - lt0
    if (!listRes.done) {
      return NextResponse.json({
        listKeys: { ok: false, timedOut: true, ms: listMs },
        note: "listKeys(single) завис >15с — read виснет даже для одного list",
      })
    }
    const keys = listRes.value.slice(0, 60)
    if (keys.length === 0) {
      return NextResponse.json({ error: "no_keys", listMs })
    }

    // 2) лесенка getJson concurrency.
    const ladder: Array<{
      n: number
      ok: boolean
      timedOut: boolean
      ms: number
      succeeded?: number
      failed?: number
    }> = []
    for (const n of LEVELS) {
      const picked = Array.from({ length: n }, (_, i) => keys[i % keys.length])
      const t0 = Date.now()
      const res = await raceTimeout(
        Promise.allSettled(picked.map((k) => getJson(k))),
        LEVEL_TIMEOUT_MS,
      )
      const ms = Date.now() - t0
      if (res.done) {
        const succeeded = res.value.filter((x) => x.status === "fulfilled").length
        ladder.push({
          n,
          ok: succeeded === n,
          timedOut: false,
          ms,
          succeeded,
          failed: n - succeeded,
        })
      } else {
        ladder.push({ n, ok: false, timedOut: true, ms })
      }
      await sleep(1000) // дать egress остыть между уровнями
    }

    return NextResponse.json({
      keysAvailable: keys.length,
      listKeys: { ok: true, ms: listMs },
      requestHandler: "requestTimeout=10s, connectionTimeout=3s, maxSockets=64 (throwOnRequestTimeout НЕ задан → только WARN)",
      ladder,
    })
  } catch (e) {
    return NextResponse.json(
      { error: "handler_error", message: (e as Error).message.slice(0, 300) },
      { status: 200 },
    )
  }
}
