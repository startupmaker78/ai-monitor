// Transport layer for the tracker.
//
// In commit 4-part-2/8 (this commit) both functions are stubs that just
// log packet contents to the console — there's no API endpoint yet.
//
// In commit 4-part-3/8 sendPacket will become a fetch() to
// /api/tracking/collect, and sendFinalPacket will switch to
// navigator.sendBeacon for unload-safe delivery.

export type Packet = {
  sessionToken: string
  siteToken: string
  packetIndex: number
  isFinal: boolean
  events: unknown[]
  pageUrl: string
  userAgent: string
  startedAt: number
}

const PREFIX = '[webmonitor]'

export function sendPacket(packet: Packet): Promise<void> {
  console.log(`${PREFIX} would send packet:`, packet)
  return Promise.resolve()
}

export function sendFinalPacket(packet: Packet): void {
  console.log(`${PREFIX} would send final packet:`, packet)
}
