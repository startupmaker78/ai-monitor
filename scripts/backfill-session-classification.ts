// Разовый бэкфилл денормализованных полей вовлечённости (interactionCount,
// hasFullSnapshot) для существующих сессий. Запускать ВРУЧНУЮ ПОСЛЕ
// применения миграции add_session_engagement_fields:
//   npm run backfill:session-classification
//
// Идемпотентный: значения считаются из S3 (источник истины), повторный
// прогон даёт те же числа; guard (NOT совпадает) не трогает уже
// заполненные строки. Вне рантайм-пути. Не удаляет и не трогает ничего,
// кроме двух новых колонок.
import * as dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { prisma } from "../lib/prisma"
import { listKeys, getJson } from "../lib/storage"
import {
  countInteractions,
  hasFullSnapshot,
  type ClassifiableEvent,
} from "../lib/session-classification"

const CONCURRENCY = 8

async function readEvents(storageKey: string): Promise<ClassifiableEvent[]> {
  const keys = await listKeys(storageKey)
  const sorted = keys
    .map((k) => ({
      k,
      i: parseInt((k.match(/\/(\d+)\.json$/) || [])[1] || "-1", 10),
    }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i)
  const events: ClassifiableEvent[] = []
  for (const { k } of sorted) {
    try {
      const pkt = await getJson<{ events?: unknown }>(k)
      if (Array.isArray(pkt?.events)) {
        events.push(...(pkt.events as ClassifiableEvent[]))
      }
    } catch (err) {
      console.warn(`  [warn] пакет не прочитан: ${k} — ${(err as Error).message}`)
    }
  }
  return events
}

async function main() {
  const sessions = await prisma.session.findMany({
    where: { storageKey: { not: null } },
    select: { id: true, storageKey: true },
    orderBy: { startedAt: "asc" },
  })
  console.log(`[backfill] сессий с storageKey: ${sessions.length}`)

  let done = 0
  let updated = 0
  let unchanged = 0
  let failed = 0
  const queue = [...sessions]

  async function worker() {
    while (queue.length) {
      const s = queue.shift()
      if (!s || !s.storageKey) continue
      try {
        const events = await readEvents(s.storageKey)
        const interactionCount = countInteractions(events)
        const hasFull = hasFullSnapshot(events)
        // Guard делает повторный прогон дешёвым: обновляем только если
        // текущие значения отличаются от вычисленных.
        const res = await prisma.session.updateMany({
          where: {
            id: s.id,
            NOT: { interactionCount, hasFullSnapshot: hasFull },
          },
          data: { interactionCount, hasFullSnapshot: hasFull },
        })
        if (res.count > 0) updated++
        else unchanged++
      } catch (err) {
        failed++
        console.warn(`  [fail] ${s.id}: ${(err as Error).message}`)
      }
      done++
      if (done % 10 === 0 || done === sessions.length) {
        console.log(
          `  прогресс ${done}/${sessions.length} — updated=${updated} unchanged=${unchanged} failed=${failed}`,
        )
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  console.log(
    `[backfill] готово: updated=${updated}, unchanged=${unchanged}, failed=${failed}`,
  )
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
