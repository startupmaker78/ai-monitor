import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { loadOwnedSession } from "@/lib/sessions-data"
import { listKeys, getJson } from "@/lib/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type StoredPacket = {
  packetIndex: number
  events: Array<{ type: number; data: unknown; timestamp: number }>
}

type RrwebEvent = { type: number; data: unknown; timestamp: number }

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "unauthorized", message: "Не авторизован" },
      { status: 401 },
    )
  }

  const owned = await loadOwnedSession(params.id, session.user.id)
  if (!owned) {
    return NextResponse.json(
      { error: "not_found", message: "Сессия не найдена" },
      { status: 404 },
    )
  }
  if (!owned.storageKey) {
    return NextResponse.json(
      { error: "not_found", message: "Сессия не найдена" },
      { status: 404 },
    )
  }

  let keys: string[]
  try {
    keys = await listKeys(owned.storageKey)
  } catch (err) {
    console.error(
      "[session-events] listKeys failed:",
      (err as Error).message,
    )
    return NextResponse.json(
      { error: "storage_failed", message: "Ошибка загрузки сессии" },
      { status: 502 },
    )
  }

  if (keys.length === 0) {
    return NextResponse.json(
      {
        error: "no_packets",
        message: "Запись больше не доступна (сессии хранятся 30 дней)",
      },
      { status: 410 },
    )
  }

  // Сортировка по числовому packetIndex, как в analysis-target-matcher.ts.
  const sorted = keys
    .map((k) => {
      const m = k.match(/\/(\d+)\.json$/)
      return { key: k, idx: m ? parseInt(m[1], 10) : -1 }
    })
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx)

  let packets: StoredPacket[]
  try {
    packets = await Promise.all(
      sorted.map((s) => getJson<StoredPacket>(s.key)),
    )
  } catch (err) {
    console.error(
      "[session-events] getJson failed:",
      (err as Error).message,
    )
    return NextResponse.json(
      { error: "storage_failed", message: "Ошибка загрузки сессии" },
      { status: 502 },
    )
  }

  const events: RrwebEvent[] = []
  for (const packet of packets) {
    if (Array.isArray(packet.events)) events.push(...packet.events)
  }
  events.sort((a, b) => a.timestamp - b.timestamp)

  return NextResponse.json(
    {
      events,
      totalEvents: events.length,
      active: owned.endedAt === null,
      startedAt: owned.startedAt.toISOString(),
      endedAt: owned.endedAt ? owned.endedAt.toISOString() : null,
    },
    {
      status: 200,
      headers: {
        // private — events содержат рекординги юзеров (PII), CDN/прокси
        // не должны кешировать. max-age=300 (5 мин) — баланс между
        // реплеем и снижением S3-трафика.
        "Cache-Control": "private, max-age=300",
      },
    },
  )
}
