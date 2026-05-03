import type { TrackingPacket } from '../lib/tracking-schema'

export type Packet = TrackingPacket

const PREFIX = '[webmonitor]'

// COLLECT_ENDPOINT — full URL to the API. Derived from the script's own
// origin (Tilda proxies /tracker.js through the customer's domain only when
// the customer self-hosts; in our case the tag is `<script src="https://
// staging.вебмонитор.рф/tracker.js?token=...">`, so the API lives on the
// same origin).
function getCollectUrl(): string {
  const script = document.currentScript
  if (script instanceof HTMLScriptElement && script.src) {
    try {
      const url = new URL(script.src)
      return `${url.protocol}//${url.host}/api/tracking/collect`
    } catch {
      // fall through to relative path
    }
  }
  return '/api/tracking/collect'
}

const COLLECT_URL = getCollectUrl()

export async function sendPacket(packet: Packet): Promise<void> {
  try {
    const response = await fetch(COLLECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(packet),
      credentials: 'omit',
      keepalive: true,
    })
    if (!response.ok) {
      console.warn(
        `${PREFIX} collect returned ${response.status} for packet ${packet.packetIndex}`,
      )
    }
  } catch (err) {
    // Don't break the customer's site if our endpoint is down or blocked —
    // log and drop. Final-packet reliability comes via sendBeacon in part 5/8.
    console.warn(
      `${PREFIX} collect failed for packet ${packet.packetIndex}:`,
      (err as Error).message,
    )
  }
}

// Final packet: navigator.sendBeacon survives page unload across all
// browsers; fetch with keepalive can be aborted by Safari on pagehide.
//
// Beacon body must be a Blob with explicit application/json — the default
// sendBeacon string ContentType is text/plain;charset=UTF-8 which would
// trigger CORS preflight (we want simple-request semantics).
export function sendFinalPacket(packet: Packet): void {
  const body = JSON.stringify(packet)

  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try {
      const blob = new Blob([body], { type: 'application/json' })
      const queued = navigator.sendBeacon(COLLECT_URL, blob)
      if (queued) return
      // Beacon refused (>64KB or quota exceeded) — fall through to fetch.
    } catch {
      // Old browsers may throw on sendBeacon(Blob) — fall through.
    }
  }

  // Fallback: fetch with keepalive. Less reliable than sendBeacon under
  // unload but better than dropping the packet.
  void fetch(COLLECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    credentials: 'omit',
    keepalive: true,
  }).catch(() => {
    // No console.warn here — we're inside pagehide, console may be
    // closed already.
  })
}
