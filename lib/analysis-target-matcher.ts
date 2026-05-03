import { prisma } from "./prisma"
import { listKeys, getJson } from "./storage"

// rrweb event type=4 (Meta) — emitted on initial snapshot and after
// document URL changes (SPA navigation, takeFullSnapshot).
// data.href is the document.location.href at that moment.

// Stored packet shape (matches what app/api/tracking/collect/route.ts
// puts into Object Storage).
type StoredPacket = {
  packetIndex: number
  events: Array<{ type: number; data: unknown; timestamp: number }>
}

// Normalize URL for matching against AnalysisTarget.url:
// - strip query string and fragment
// - strip trailing slash (except root)
// - lowercase host
//
// Examples:
//   https://site.ru/pricing?ref=ad     → https://site.ru/pricing
//   https://site.ru/pricing/           → https://site.ru/pricing
//   https://Site.RU/Pricing            → https://site.ru/Pricing  (path case kept)
//   https://site.ru/                   → https://site.ru/         (root preserved)
function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    u.search = ""
    u.hash = ""
    u.hostname = u.hostname.toLowerCase()
    let path = u.pathname
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1)
    }
    return `${u.protocol}//${u.host}${path}`
  } catch {
    return null
  }
}

// Reads ALL packets of the session from Object Storage, extracts Meta
// events (rrweb type=4), and returns the URL on which the visitor spent
// most cumulative time across the whole session.
//
// Returns null if no Meta events were found (degenerate case — e.g.,
// the script started but never emitted full snapshot).
export async function computeDominantUrl(
  siteId: string,
  sessionToken: string,
  sessionEndedAt: number,
): Promise<string | null> {
  const prefix = `sessions/${siteId}/${sessionToken}/`
  const keys = await listKeys(prefix)
  if (keys.length === 0) return null

  // Sort by packetIndex (lexicographic on '0.json'..'10.json' would put
  // '10' before '2', so parse the index numerically).
  const sorted = keys
    .map((k) => {
      const m = k.match(/\/(\d+)\.json$/)
      return { key: k, idx: m ? parseInt(m[1], 10) : -1 }
    })
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx)

  const metas: Array<{ href: string; ts: number }> = []
  for (const { key } of sorted) {
    const packet = await getJson<StoredPacket>(key)
    for (const ev of packet.events) {
      if (
        ev.type === 4 &&
        typeof (ev.data as { href?: unknown })?.href === "string"
      ) {
        metas.push({
          href: (ev.data as { href: string }).href,
          ts: ev.timestamp,
        })
      }
    }
  }

  if (metas.length === 0) return null

  // Build duration map: time on URL N = ts of next Meta - ts of this Meta.
  // The last URL lasts until sessionEndedAt.
  metas.sort((a, b) => a.ts - b.ts)
  const durations = new Map<string, number>()
  for (let i = 0; i < metas.length; i++) {
    const norm = normalizeUrl(metas[i].href)
    if (!norm) continue
    const start = metas[i].ts
    const end = i + 1 < metas.length ? metas[i + 1].ts : sessionEndedAt
    const dur = Math.max(0, end - start)
    durations.set(norm, (durations.get(norm) ?? 0) + dur)
  }

  if (durations.size === 0) return null

  // Pick URL with max cumulative duration.
  // Array.from(entries) instead of `for (const [k,v] of map)` because the
  // project's tsconfig has no explicit `target`, so TS defaults to ES3
  // and bans direct iteration over Map without --downlevelIteration.
  let best: { url: string; dur: number } | null = null
  for (const [url, dur] of Array.from(durations.entries())) {
    if (!best || dur > best.dur) best = { url, dur }
  }
  return best?.url ?? null
}

// Finds an active (non-archived) AnalysisTarget for this site whose
// normalized URL matches the dominant URL. Active = status in
// (ACTIVE, READY) and archivedAt is null.
//
// Returns target id, or null if no match.
export async function findMatchingTarget(
  siteId: string,
  dominantUrl: string,
): Promise<string | null> {
  const targets = await prisma.analysisTarget.findMany({
    where: {
      siteId,
      archivedAt: null,
      status: { in: ["ACTIVE", "READY"] },
    },
    select: { id: true, url: true },
  })
  for (const t of targets) {
    const norm = normalizeUrl(t.url)
    if (norm && norm === dominantUrl) return t.id
  }
  return null
}
