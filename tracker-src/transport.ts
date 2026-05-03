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

// Final packet: same path for now. Part 5/8 will switch to navigator.sendBeacon
// for unload-safe delivery (fetch with keepalive can be aborted by Safari on
// pagehide).
export function sendFinalPacket(packet: Packet): void {
  void sendPacket(packet)
}
