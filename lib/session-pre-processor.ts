import { prisma } from "@/lib/prisma"
import { listKeys, getJson } from "@/lib/storage"
import type { SessionSummary } from "@/lib/analysis-prompt"

// design decision 2026-05-07: на MVP ограничиваем 50 сессий на анализ;
// при изменении пересмотреть стоимость и context window Claude.
export const MAX_SESSIONS_PER_ANALYSIS = 50

const PACKET_CONCURRENCY = 5 // параллельный getJson внутри одной сессии
const SESSION_CONCURRENCY = 10 // параллельные сессии в collectSessionsForAnalysis
const INCOMPLETE_GRACE_MS = 30 * 60 * 1000 // 30 мин — после этого
// сессию считаем «брошенной» юзером и берём в анализ даже без endedAt

type StoredPacket = {
  packetIndex: number
  events: Array<{ type: number; data: unknown; timestamp: number }>
}

// re-apply на main 2026-07-15: поле `incomplete` вынесено из объекта
// SessionSummary в ExtractResult — текущий тип SessionSummary
// (analysis-prompt.ts) его НЕ содержит, а трогать analysis-prompt на
// этапе 6.3a не хотим. Вернуть в SessionSummary при интеграции 6.3d,
// если нужно передавать в промпт.
export type ExtractResult =
  | { ok: true; summary: SessionSummary; incomplete: boolean }
  | {
      ok: false
      reason: "no_packets" | "corrupted_json" | "no_full_snapshot"
    }

export async function extractSessionSummary(
  siteId: string,
  sessionToken: string,
  options: {
    sessionStartedAtMs: number
    sessionEndedAtMsFromDb: number | null
    userAgent: string | null
  },
): Promise<ExtractResult> {
  const prefix = `sessions/${siteId}/${sessionToken}/`
  const keys = await listKeys(prefix)
  if (keys.length === 0) {
    return { ok: false, reason: "no_packets" }
  }

  // Сортировка по числовому packetIndex (lexicographic поломал бы
  // 10.json vs 2.json) — тот же подход, что в analysis-target-matcher.
  const sorted = keys
    .map((k) => {
      const m = k.match(/\/(\d+)\.json$/)
      return { key: k, idx: m ? parseInt(m[1], 10) : -1 }
    })
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx)

  if (sorted.length === 0) {
    return { ok: false, reason: "no_packets" }
  }

  // Параллельный download с ограничением. Если хоть один пакет упал на
  // get/parse — вся сессия corrupted, потому что мы не можем гарантировать
  // целостность таймлайна без всех пакетов.
  let packets: StoredPacket[]
  try {
    packets = await withConcurrency(
      sorted,
      PACKET_CONCURRENCY,
      async ({ key, idx }) => {
        try {
          return await getJson<StoredPacket>(key)
        } catch (err) {
          console.warn("[session-pre-processor] packet fetch failed", {
            sessionToken,
            packetIndex: idx,
            error: (err as Error).message,
          })
          throw err
        }
      },
    )
  } catch {
    return { ok: false, reason: "corrupted_json" }
  }

  // Один проход по всем events.
  let viewportWidth: number | null = null
  let viewportHeight: number | null = null
  let maxScrollY = 0
  let sawScrollEvent = false
  let lastTimestampMs = options.sessionStartedAtMs

  for (const packet of packets) {
    if (!Array.isArray(packet.events)) continue
    for (const ev of packet.events) {
      if (typeof ev !== "object" || ev === null) continue
      const evObj = ev as { type?: unknown; data?: unknown; timestamp?: unknown }

      if (typeof evObj.timestamp === "number") {
        if (evObj.timestamp > lastTimestampMs) {
          lastTimestampMs = evObj.timestamp
        }
      }

      const type = evObj.type
      const data = (evObj.data as Record<string, unknown> | null) ?? null
      if (data === null) continue

      // Meta event (rrweb type=4): emitted at start and on URL change.
      // В современных rrweb (нашa @rrweb/record 2.0) data содержит
      // {href, width, height} — width/height = window.inner*.
      if (type === 4) {
        if (viewportWidth === null && typeof data.width === "number") {
          viewportWidth = data.width
        }
        if (viewportHeight === null && typeof data.height === "number") {
          viewportHeight = data.height
        }
      }

      // IncrementalSnapshot (type=3) — разделяется по data.source.
      if (type === 3) {
        const source = data.source
        // source 3 = Scroll. data.y — scrollTop.
        if (source === 3 && typeof data.y === "number") {
          sawScrollEvent = true
          if (data.y > maxScrollY) maxScrollY = data.y
        }
        // source 4 = ViewportResize. Обновляем viewport — реальный размер
        // окна изменился (поворот устройства, ресайз).
        if (source === 4) {
          if (typeof data.width === "number") viewportWidth = data.width
          if (typeof data.height === "number") viewportHeight = data.height
        }
      }

      // Unknown event types — пропускаем тихо. rrweb добавляет/меняет
      // структуру между версиями, валить сессию на этом не хотим.
    }
  }

  // Если viewport так и не определился — возвращаем no_full_snapshot.
  // Имя reason остаётся даже когда формально дело не во FullSnapshot,
  // а в отсутствии любого источника viewport — это «не хватает базовой
  // информации о сессии».
  if (viewportWidth === null || viewportHeight === null) {
    return { ok: false, reason: "no_full_snapshot" }
  }

  const userAgent = options.userAgent
  const deviceType = classifyDevice(viewportWidth, userAgent)

  // FIXME 6.3b: docHeight = viewport.height — это приближение, не
  // реальная DOM scrollHeight. После DOM-reconstruction в коммите 6.3b
  // заменить на scrollHeight извлечённую из FullSnapshot html-узла.
  // До этого scrollDepth по сути значит "проскроллил ли ниже первого
  // экрана", а не "% страницы прокручено".
  const docHeight = viewportHeight
  const scrollDepth = sawScrollEvent ? clamp(maxScrollY / docHeight, 0, 1) : 0

  // duration. Если в БД endedAt был — берём оттуда. Иначе по последнему
  // событию (incomplete=true).
  const incomplete = options.sessionEndedAtMsFromDb === null
  const endMs = options.sessionEndedAtMsFromDb ?? lastTimestampMs
  const duration = Math.max(
    0,
    Math.round((endMs - options.sessionStartedAtMs) / 1000),
  )

  const summary: SessionSummary = {
    duration,
    deviceType,
    viewport: `${viewportWidth}x${viewportHeight}`,
    scrollDepth: round2(scrollDepth),
    clicks: [], // 6.3b
    formInteractions: [], // 6.3c
    rageClicks: [], // 6.3b
    deadClicks: 0, // 6.3b
    exitElement: null, // 6.3b
    // TODO: error tracking — отдельный коммит после MVP, нужны
    // window.addEventListener('error') в трекере.
    errors: [],
  }

  return { ok: true, summary, incomplete }
}

export async function collectSessionsForAnalysis(
  targetId: string,
  options: { limit: number },
): Promise<SessionSummary[]> {
  const cutoff = new Date(Date.now() - INCOMPLETE_GRACE_MS)
  const sessions = await prisma.session.findMany({
    where: {
      analysisTargetId: targetId,
      OR: [{ endedAt: { not: null } }, { startedAt: { lt: cutoff } }],
    },
    select: {
      id: true,
      sessionToken: true,
      siteId: true,
      startedAt: true,
      endedAt: true,
      userAgent: true,
    },
    take: options.limit * 2, // запас на skip из-за corrupted/no_full_snapshot
    orderBy: { startedAt: "desc" },
  })

  if (sessions.length === 0) return []

  // Стратификация по deviceType (по UA, без download S3).
  const sampled = stratifySample(sessions, options.limit)

  const results = await withConcurrency(
    sampled,
    SESSION_CONCURRENCY,
    async (s) => {
      const result = await extractSessionSummary(s.siteId, s.sessionToken, {
        sessionStartedAtMs: s.startedAt.getTime(),
        sessionEndedAtMsFromDb: s.endedAt?.getTime() ?? null,
        userAgent: s.userAgent ?? null,
      })
      return result
    },
  )

  const summaries: SessionSummary[] = []
  for (const r of results) {
    if (r.ok) summaries.push(r.summary)
  }
  return summaries.slice(0, options.limit)
}

// ─── helpers ──────────────────────────────────────────────────────────

type SessionForUaSample = { userAgent: string | null }

function stratifySample<T extends SessionForUaSample>(
  sessions: T[],
  limit: number,
): T[] {
  const groups: Record<"mobile" | "tablet" | "desktop", T[]> = {
    mobile: [],
    tablet: [],
    desktop: [],
  }
  for (const s of sessions) {
    groups[classifyByUA(s.userAgent)].push(s)
  }
  const total = sessions.length
  const out: T[] = []
  for (const key of ["mobile", "tablet", "desktop"] as const) {
    const group = groups[key]
    if (group.length === 0) continue
    const ratio = group.length / total
    const k = Math.round(ratio * limit)
    const shuffled = shuffle(group)
    out.push(...shuffled.slice(0, k))
  }
  // Math.round может дать out.length > limit (на 1-2). Trim.
  return out.slice(0, limit)
}

function classifyByUA(userAgent: string | null): "mobile" | "tablet" | "desktop" {
  if (!userAgent) return "desktop"
  if (/iPad/i.test(userAgent)) return "tablet"
  if (/iPhone|Android.*Mobile|Mobile/i.test(userAgent)) return "mobile"
  return "desktop"
}

function classifyDevice(
  viewportWidth: number,
  userAgent: string | null,
): "mobile" | "tablet" | "desktop" {
  if (viewportWidth < 768) return "mobile"
  if (viewportWidth <= 1024) return "tablet"
  // Для десктопного viewport дополнительно сверяемся с UA — на iPad с
  // подключённой клавиатурой ширина может быть 1180+, но это всё ещё
  // tablet по продуктовой семантике.
  if (userAgent && /iPad/i.test(userAgent)) return "tablet"
  return "desktop"
}

function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo
  if (x > hi) return hi
  return x
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}

// Inline semaphore. Запускает n воркеров, каждый берёт из очереди.
// Порядок результатов НЕ совпадает с порядком items — pre-processor'у
// порядок безразличен (стратификация уже выбрала, дальше только агрегат).
async function withConcurrency<T, R>(
  items: T[],
  n: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  const queue = items.slice()
  async function worker() {
    while (queue.length) {
      const item = queue.shift()
      if (item === undefined) return
      results.push(await fn(item))
    }
  }
  await Promise.all(Array.from({ length: n }, worker))
  return results
}
