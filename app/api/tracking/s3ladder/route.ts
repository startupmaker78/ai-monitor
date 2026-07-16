// ⚠️ TEMP ДИАГНОСТИЧЕСКИЙ РОУТ — УДАЛИТЬ ПОСЛЕ ЗАМЕРА.
// v2: getJson-ладдер показал что параллельный getJson OK до N=50. Теперь
// проверяем (а) параллельный listKeys и (б) ПРЯМОЙ collectSessionsForAnalysis
// в контейнере (воспроизведение зависона сбора). Guard CRON_SECRET.
import { NextRequest, NextResponse } from "next/server"
import { listKeys, getJson } from "@/lib/storage"
import { collectSessionsForAnalysis } from "@/lib/session-pre-processor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SITE = "cmrat2wcs00002u3cdg15w2t6"
const TARGET = "cmrcbpgcs0000o1lbihsba88g"
const LEVEL_TIMEOUT_MS = 15000

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

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
    const allKeys = await listKeys(`sessions/${SITE}/`)
    // distinct session prefixes: sessions/{SITE}/{token}/
    const prefixes = Array.from(
      new Set(
        allKeys
          .map((k) => k.match(new RegExp(`^(sessions/${SITE}/[^/]+/)`))?.[1])
          .filter((x): x is string => Boolean(x)),
      ),
    )

    // (а) ПАРАЛЛЕЛЬНЫЙ listKeys — по N разным session-префиксам одновременно.
    const listLadder: Array<{ n: number; ok: boolean; timedOut: boolean; ms: number; succeeded?: number }> = []
    for (const n of [1, 3, 5, 10]) {
      const picked = prefixes.slice(0, n)
      if (picked.length < n) break
      const t0 = Date.now()
      const res = await raceTimeout(
        Promise.allSettled(picked.map((pfx) => listKeys(pfx))),
        LEVEL_TIMEOUT_MS,
      )
      const ms = Date.now() - t0
      if (res.done) {
        listLadder.push({ n, ok: res.value.every((x) => x.status === "fulfilled"), timedOut: false, ms, succeeded: res.value.filter((x) => x.status === "fulfilled").length })
      } else {
        listLadder.push({ n, ok: false, timedOut: true, ms })
      }
      await sleep(1000)
    }

    // (б) ПРЯМОЙ collectSessionsForAnalysis (реальный путь анализа) с таймаутом.
    const ct0 = Date.now()
    const collectRes = await raceTimeout(
      collectSessionsForAnalysis(TARGET, { limit: 50 }),
      40000,
    )
    const collectMs = Date.now() - ct0
    const collect = collectRes.done
      ? { ok: true, timedOut: false, ms: collectMs, sessionsCollected: collectRes.value.length }
      : { ok: false, timedOut: true, ms: collectMs, note: "collectSessionsForAnalysis завис >40с — ВОСПРОИЗВЕДЁН" }

    return NextResponse.json({
      prefixesFound: prefixes.length,
      parallelListKeys: listLadder,
      directCollect: collect,
    })
  } catch (e) {
    return NextResponse.json(
      { error: "handler_error", message: (e as Error).message.slice(0, 300) },
      { status: 200 },
    )
  }
}
