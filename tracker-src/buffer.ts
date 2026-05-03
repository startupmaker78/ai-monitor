import { sendPacket, sendFinalPacket, type Packet } from './transport'

// Subset of rrweb's eventWithTime that the server's Zod schema
// (lib/tracking-schema.ts → trackingPacketSchema) expects on each event.
// We type the buffer with this minimal shape rather than rrweb's exact
// EventType union because rrweb's event shape varies between versions
// (alpha builds add/rename fields), and we don't want a strict client
// cast to break on upgrades. Server-side Zod validates each event
// structure on receipt.
type RrwebEventLike = {
  type: number
  data: unknown
  timestamp: number
}

type Logger = (...args: unknown[]) => void

export type BufferConfig = {
  sessionToken: string
  siteToken: string
  pageUrl: string
  userAgent: string
  startedAt: number
  log: Logger
}

const FLUSH_INTERVAL_MS = 30_000
const MAX_EVENTS_BEFORE_FLUSH = 200

export class EventBuffer {
  private events: RrwebEventLike[] = []
  private packetIndex = 0
  private intervalId: number | null = null
  private finalSent = false
  private readonly config: BufferConfig

  constructor(config: BufferConfig) {
    this.config = config
  }

  add(event: unknown): void {
    // rrweb's record() emits objects with at least {type, data, timestamp}.
    // Trusted source — the rrweb library contract is the boundary.
    this.events.push(event as RrwebEventLike)
    if (this.events.length >= MAX_EVENTS_BEFORE_FLUSH) {
      this.flush()
    }
  }

  start(): void {
    if (this.intervalId !== null) return
    this.intervalId = window.setInterval(
      () => this.flush(),
      FLUSH_INTERVAL_MS,
    )
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    window.addEventListener('pagehide', this.handlePageHide)
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId)
      this.intervalId = null
    }
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    )
    window.removeEventListener('pagehide', this.handlePageHide)
  }

  flush(): void {
    if (this.events.length === 0) return
    const packet = this.buildPacket(false)
    this.events = []
    this.packetIndex += 1
    this.config.log('flushing', {
      packetIndex: packet.packetIndex,
      eventCount: packet.events.length,
    })
    void sendPacket(packet)
  }

  flushFinal(): void {
    if (this.finalSent) return
    this.finalSent = true
    const packet = this.buildPacket(true)
    this.events = []
    this.packetIndex += 1
    this.config.log('final flush', {
      packetIndex: packet.packetIndex,
      eventCount: packet.events.length,
    })
    sendFinalPacket(packet)
  }

  private buildPacket(isFinal: boolean): Packet {
    return {
      sessionToken: this.config.sessionToken,
      siteToken: this.config.siteToken,
      packetIndex: this.packetIndex,
      isFinal,
      events: this.events.slice(),
      pageUrl: this.config.pageUrl,
      userAgent: this.config.userAgent,
      startedAt: this.config.startedAt,
    }
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.flushFinal()
    }
  }

  private handlePageHide = (): void => {
    this.flushFinal()
  }
}
