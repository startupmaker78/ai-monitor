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

// gzip the packet JSON in the browser via the streams-based
// CompressionStream API. FullSnapshot of a real Tilda page is ~2.9 MB of
// text/HTML — it compresses several-fold, keeping the wire body well under
// the 3.5 MiB YC serverless proxy limit. Returns a Blob of gzip bytes.
// Caller feature-detects CompressionStream first.
async function gzipJson(json: string): Promise<Blob> {
  const stream = new Blob([json])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))
  return await new Response(stream).blob()
}

// Plain (uncompressed) send — the historical path. Body is JSON with
// Content-Type: application/json. Returns true on HTTP 2xx, false on any
// failure. Single-line structured log makes 413/network drops greppable.
//
// Important: NO `keepalive: true` here. The W3C Fetch spec caps keepalive
// bodies at 64 KB total in-flight; FullSnapshot of the first packet and
// large incremental flushes routinely exceed that limit, which makes fetch
// throw TypeError → packet silently dropped → rrweb-player can't build
// initial DOM (white screen on replay). sendPacket runs during a live page
// (30s interval / 200 events count flush), so keepalive isn't needed — the
// connection is healthy, and if it fails the next interval will retry-by-
// accumulation. The unload path is covered separately by sendFinalPacket →
// sendBeacon below.
async function sendPlain(packet: Packet, json: string): Promise<boolean> {
  const bodySize = json.length
  try {
    const response = await fetch(COLLECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
      credentials: 'omit',
    })
    if (!response.ok) {
      console.warn(
        `${PREFIX} PACKET DROPPED idx=${packet.packetIndex} ` +
          `reason=http_${response.status} bytes=${bodySize} ` +
          `events=${packet.events.length}`,
      )
      return false
    }
    return true
  } catch (err) {
    // Don't break the customer's site if our endpoint is down or blocked —
    // log and drop. Final-packet reliability comes via sendBeacon below.
    console.warn(
      `${PREFIX} PACKET DROPPED idx=${packet.packetIndex} ` +
        `reason=fetch_threw err=${(err as Error).name}:${(err as Error).message} ` +
        `bytes=${bodySize} events=${packet.events.length}`,
    )
    return false
  }
}

// Returns true if the packet was accepted by the server (HTTP 2xx),
// false on any failure. Caller (EventBuffer) increments a session-level
// dropped-packets counter for observability.
//
// Transport: when CompressionStream is available we send gzip bytes as
// `application/octet-stream` with NO Content-Encoding header. That header
// triggers UTF-8 normalization on the YC serverless proxy which replaces
// byte 0x8b with U+FFFD and destroys the compressed body (empirically
// confirmed 2026-07-09); octet-stream binary without it passes intact.
// The server detects gzip by magic bytes (1f8b), not by header.
export async function sendPacket(packet: Packet): Promise<boolean> {
  const json = JSON.stringify(packet)

  // Feature-detect CompressionStream: absent in Safari <16.4, Firefox
  // <113, Chrome <80. Without it, plain path exactly as before.
  if (typeof CompressionStream !== 'undefined') {
    let gz: Blob | null = null
    try {
      gz = await gzipJson(json)
    } catch {
      // Compression hiccup — fall through to plain (never drop over gzip).
      gz = null
    }

    if (gz) {
      let res: Response | null = null
      try {
        res = await fetch(COLLECT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: gz,
          credentials: 'omit',
        })
      } catch {
        // Network throw on the gzip send — retry once as plain below.
        res = null
      }

      if (res && res.ok) return true

      // Non-2xx OR network throw on gzip → EXACTLY ONE plain retry with the
      // same packet. This closes the regression hole: if the server can't
      // accept gzip (e.g. client shipped before the server deploy), we fall
      // back to the known-good plain path instead of dropping the packet.
      if (res) {
        console.warn(
          `${PREFIX} gzip rejected http_${res.status} bytes=${gz.size} ` +
            `events=${packet.events.length} idx=${packet.packetIndex} — retrying plain`,
        )
      } else {
        console.warn(
          `${PREFIX} gzip send threw idx=${packet.packetIndex} — retrying plain`,
        )
      }
      return await sendPlain(packet, json)
    }
  }

  // No CompressionStream, or compression failed → plain path.
  return await sendPlain(packet, json)
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
