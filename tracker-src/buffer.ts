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
  // targetId получен от /api/tracking/should-record при инициализации
  // трекера. Обязателен: трекер стартует только после подтверждения
  // сервером что этот pageUrl соответствует ACTIVE/READY цели. Каждый
  // packet включает targetId — serverside collect route идемпотентно
  // инкрементит AnalysisTarget.sessionsCollected на первом packet
  // сессии (см. DECISIONS 2026-05-08 «record only on target URLs»).
  targetId: string
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
  // In-memory counter, не персистится в БД. На finalize логируется в
  // console.warn для observability — оттуда видно по логам контейнера
  // (через rrweb session debug на стороне клиента) сколько пакетов
  // потерялось из-за 413/network. TODO: при появлении кейсов с
  // массовыми drop'ами вынести в Session.droppedPackets через миграцию.
  private droppedPackets = 0
  private readonly config: BufferConfig

  constructor(config: BufferConfig) {
    this.config = config
  }

  add(event: unknown): void {
    // rrweb's record() emits objects with at least {type, data, timestamp}.
    // Trusted source — the rrweb library contract is the boundary.
    const e = event as RrwebEventLike
    if (e.type === 2) {
      // FullSnapshot (type 2) реального сайта academy весит ~2.9 MB —
      // если он уляжется в один пакет с сопутствующими инкрементами,
      // тело перевалит MAX_BODY_BYTES=3 MiB на collect и обрежется до
      // контейнера с 413. Изолируем снапшот в свой пакет:
      //  1) сначала flush уже накопленных events (закрываем текущий
      //     пакет как есть) — так снапшот не смешается с довеском;
      //  2) в опустевший буфер кладём сам FullSnapshot;
      //  3) немедленно flush — снапшот уходит одиночным пакетом.
      // Meta (type 4) rrweb эмитит чуть раньше FullSnapshot тем же
      // takeFullSnapshot и она успевает осесть в буфере; шаг 1 её
      // вытолкнет вместе с предыдущими. Порядок Meta→FullSnapshot
      // сохраняется через монотонный packetIndex, склеивать их в один
      // пакет не нужно.
      if (this.events.length > 0) this.flush()
      this.events.push(e)
      this.flush()
      return
    }
    this.events.push(e)
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
    void sendPacket(packet).then((ok) => {
      if (!ok) this.droppedPackets += 1
    })
  }

  flushFinal(): void {
    if (this.finalSent) return
    this.finalSent = true

    // Step 1: flush all pending events as a regular packet (isFinal=false).
    // sendBeacon has a 64KB body limit; large buffers wouldn't fit, so we
    // use sendPacket (regular fetch) for the bulk and reserve sendBeacon
    // for the tiny final ping below.
    if (this.events.length > 0) {
      const flushPacket = this.buildPacket(false)
      this.events = []
      this.packetIndex += 1
      this.config.log('final flush — bulk', {
        packetIndex: flushPacket.packetIndex,
        eventCount: flushPacket.events.length,
      })
      void sendPacket(flushPacket).then((ok) => {
        if (!ok) this.droppedPackets += 1
      })
    }

    // Step 2: send a tiny final packet (events=[]) — guaranteed to fit in
    // sendBeacon's 64KB limit, ensures endedAt and matcher run server-side.
    const finalPacket = this.buildPacket(true)
    this.packetIndex += 1
    this.config.log('final flush — sentinel', {
      packetIndex: finalPacket.packetIndex,
    })
    sendFinalPacket(finalPacket)

    // Сводка по сессии: если что-то дропнулось — пишем в console.warn,
    // чтобы юзер/наш QA при дебаге через DevTools видели одной строкой
    // сколько потеряно.
    if (this.droppedPackets > 0) {
      console.warn(
        '[webmonitor] session ended with droppedPackets=' +
          this.droppedPackets +
          ' sessionToken=' +
          this.config.sessionToken,
      )
    }
  }

  private buildPacket(isFinal: boolean): Packet {
    return {
      sessionToken: this.config.sessionToken,
      siteToken: this.config.siteToken,
      // targetId в КАЖДОМ packet без исключения — required-инвариант
      // трекера. См. DECISIONS 2026-05-08.
      targetId: this.config.targetId,
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
      this.flush()
    }
  }

  private handlePageHide = (): void => {
    this.flushFinal()
  }
}
