import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { loadOwnedSession } from "@/lib/sessions-data"
import { listKeys, getPresignedGetUrl } from "@/lib/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRESIGN_TTL_SECONDS = 600 // 10 min — safe margin для parallel fetch

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

  // Сортировка по числовому packetIndex.
  const sorted = keys
    .map((k) => {
      const m = k.match(/\/(\d+)\.json$/)
      return { key: k, idx: m ? parseInt(m[1], 10) : -1 }
    })
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx)

  // Генерируем presigned URL для каждого пакета. Клиент скачает объекты
  // напрямую с storage.yandexcloud.net — обходит YC API Gateway
  // response body cap ~3.5 MB (реальные сессии с 5+ FullSnapshot'ами
  // упирались в него, отдавали 502).
  let packets: Array<{ url: string; packetIndex: number }>
  try {
    packets = await Promise.all(
      sorted.map(async (s) => ({
        url: await getPresignedGetUrl(s.key, PRESIGN_TTL_SECONDS),
        packetIndex: s.idx,
      })),
    )
  } catch (err) {
    console.error(
      "[session-events] presign failed:",
      (err as Error).message,
    )
    return NextResponse.json(
      { error: "storage_failed", message: "Ошибка загрузки сессии" },
      { status: 502 },
    )
  }

  return NextResponse.json(
    {
      packets,
      meta: {
        totalPackets: packets.length,
        active: owned.endedAt === null,
        startedAt: owned.startedAt.toISOString(),
        endedAt: owned.endedAt ? owned.endedAt.toISOString() : null,
      },
    },
    {
      status: 200,
      headers: {
        // private — presigned URLs подписаны индивидуально (в них
        // сигнатура и expiry), CDN/proxy не должны кешировать.
        "Cache-Control": "private, max-age=300",
      },
    },
  )
}
