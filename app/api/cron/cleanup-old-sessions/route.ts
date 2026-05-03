import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { listKeys, deleteObjects } from "@/lib/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RETENTION_DAYS = 30
const MAX_SESSIONS_PER_RUN = 1000

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret) {
    console.error("[cron-cleanup] CRON_SECRET env var not set")
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
    console.warn("[cron-cleanup] auth failed")
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const dayMs = 24 * 60 * 60 * 1000
  const cutoff = new Date(Date.now() - RETENTION_DAYS * dayMs)
  const stuckCutoff = new Date(Date.now() - (RETENTION_DAYS + 1) * dayMs)

  // Старая = закончилась раньше cutoff ИЛИ зависла в active >31 дня.
  // Стрелочка zaхленувшихся (endedAt=null, startedAt очень старый) —
  // защита от бага в трекере, оставляющего сессию незакрытой.
  const oldSessions = await prisma.session.findMany({
    where: {
      OR: [
        { endedAt: { lt: cutoff } },
        { endedAt: null, startedAt: { lt: stuckCutoff } },
      ],
    },
    select: { id: true, sessionToken: true, siteId: true },
    take: MAX_SESSIONS_PER_RUN,
  })

  if (oldSessions.length === 0) {
    console.log("[cron-cleanup] no old sessions found")
    return NextResponse.json({
      ok: true,
      deletedSessions: 0,
      deletedObjects: 0,
      errors: [],
    })
  }

  console.log(`[cron-cleanup] found ${oldSessions.length} old sessions`)

  // Собираем все Object Storage ключи параллельно.
  const allKeys: string[] = []
  const listErrors: string[] = []

  await Promise.all(
    oldSessions.map(async (s) => {
      try {
        const keys = await listKeys(
          `sessions/${s.siteId}/${s.sessionToken}/`,
        )
        allKeys.push(...keys)
      } catch (err) {
        listErrors.push(
          `list ${s.sessionToken}: ${(err as Error).message}`,
        )
      }
    }),
  )

  // Batch delete по 1000.
  const deleteErrors: string[] = []
  let deletedObjectsCount = 0

  for (let i = 0; i < allKeys.length; i += 1000) {
    const batch = allKeys.slice(i, i + 1000)
    try {
      const failedKeys = await deleteObjects(batch)
      deletedObjectsCount += batch.length - failedKeys.length
      if (failedKeys.length > 0) {
        deleteErrors.push(...failedKeys.map((k) => `delete ${k}`))
      }
    } catch (err) {
      deleteErrors.push(`batch ${i}: ${(err as Error).message}`)
    }
  }

  // Удаляем Session-записи по явному списку id (не по cutoff-фильтру),
  // чтобы не задеть сессии записанные в БД во время работы скрипта.
  const sessionIds = oldSessions.map((s) => s.id)
  const dbResult = await prisma.session.deleteMany({
    where: { id: { in: sessionIds } },
  })

  console.log(
    `[cron-cleanup] deleted ${dbResult.count} sessions, ` +
      `${deletedObjectsCount} objects, ` +
      `${listErrors.length + deleteErrors.length} errors`,
  )

  return NextResponse.json({
    ok: true,
    deletedSessions: dbResult.count,
    deletedObjects: deletedObjectsCount,
    errors: [...listErrors, ...deleteErrors].slice(0, 20),
  })
}
