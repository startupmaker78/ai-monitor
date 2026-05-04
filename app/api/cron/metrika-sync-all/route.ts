import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { fetchMetrikaDaily } from "@/lib/metrika-client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_SITES_PER_RUN = 100

// Auth через payload в Timer Trigger body
// (см. /api/cron/cleanup-old-sessions/route.ts — тот же паттерн).
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

type SiteResult = {
  siteId: string
  domain: string
  status: "ok" | "skipped" | "error"
  snapshots?: number
  error?: string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret) {
    console.error("[metrika-cron] CRON_SECRET env not set")
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

  if (extractPayload(body) !== expectedSecret) {
    console.warn("[metrika-cron] auth failed")
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  // Все сайты с настроенной Метрикой.
  const sites = await prisma.site.findMany({
    where: {
      metrikaCounterId: { not: null },
      metrikaToken: { not: null },
    },
    select: {
      id: true,
      domain: true,
      metrikaCounterId: true,
      metrikaToken: true,
    },
    take: MAX_SITES_PER_RUN,
  })

  if (sites.length === 0) {
    console.log("[metrika-cron] no sites with metrika configured")
    return NextResponse.json({
      ok: true,
      sitesProcessed: 0,
      totalSnapshots: 0,
      results: [],
    })
  }

  console.log(`[metrika-cron] processing ${sites.length} sites`)

  const results: SiteResult[] = []
  let totalSnapshots = 0

  // Последовательно обрабатываем каждый сайт. Не параллельно — Метрика
  // API имеет rate limits, а БД upsert хватает связности (single connection).
  for (const site of sites) {
    if (!site.metrikaCounterId || !site.metrikaToken) {
      // Защита от race-condition (вдруг кто-то очистил поля во время
      // выполнения). Skip без ошибки.
      results.push({
        siteId: site.id,
        domain: site.domain,
        status: "skipped",
      })
      continue
    }

    const fetchResult = await fetchMetrikaDaily(
      site.metrikaCounterId,
      site.metrikaToken,
    )

    if (!fetchResult.ok) {
      console.error(
        `[metrika-cron] siteId=${site.id} fetch failed: ${fetchResult.error} ${fetchResult.details ?? ""}`,
      )
      results.push({
        siteId: site.id,
        domain: site.domain,
        status: "error",
        error: fetchResult.error,
      })
      continue
    }

    // Upsert каждый snapshot. Ошибки одного дня не валят весь сайт.
    let saved = 0
    let upsertErrors = 0
    for (const snap of fetchResult.snapshots) {
      try {
        await prisma.metricsSnapshot.upsert({
          where: {
            siteId_date: { siteId: site.id, date: snap.date },
          },
          create: {
            siteId: site.id,
            date: snap.date,
            visits: snap.visits,
            uniqueVisitors: snap.uniqueVisitors,
            conversions: 0,
            bounceRate: snap.bounceRate,
            avgSessionDuration: snap.avgSessionDuration,
            goals: {},
          },
          update: {
            visits: snap.visits,
            uniqueVisitors: snap.uniqueVisitors,
            bounceRate: snap.bounceRate,
            avgSessionDuration: snap.avgSessionDuration,
          },
        })
        saved++
      } catch (err) {
        upsertErrors++
        console.error(
          `[metrika-cron] siteId=${site.id} upsert ${snap.date.toISOString().slice(0, 10)} failed: ${(err as Error).message}`,
        )
      }
    }

    totalSnapshots += saved
    results.push({
      siteId: site.id,
      domain: site.domain,
      status: upsertErrors > 0 ? "error" : "ok",
      snapshots: saved,
      error: upsertErrors > 0 ? `${upsertErrors} upsert errors` : undefined,
    })
  }

  const okCount = results.filter((r) => r.status === "ok").length
  const errorCount = results.filter((r) => r.status === "error").length
  const skippedCount = results.filter((r) => r.status === "skipped").length

  console.log(
    `[metrika-cron] done: ${okCount} ok, ${errorCount} errors, ${skippedCount} skipped, ${totalSnapshots} snapshots`,
  )

  return NextResponse.json({
    ok: true,
    sitesProcessed: sites.length,
    totalSnapshots,
    summary: { ok: okCount, error: errorCount, skipped: skippedCount },
    results: results.slice(0, 20),
  })
}
