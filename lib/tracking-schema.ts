import { z } from "zod"

// rrweb event — мы не валидируем форму, доверяем что это объект.
// Серверная валидация структуры rrweb-events избыточна (rrweb меняет
// схему между версиями, и наш сервер не должен на ней тормозить).
const rrwebEventSchema = z
  .object({
    type: z.number().int().min(0).max(6),
    data: z.unknown(),
    timestamp: z.number().int().positive(),
  })
  .passthrough()

export const trackingPacketSchema = z.object({
  sessionToken: z.string().uuid(),
  siteToken: z.string().min(1).max(200),
  packetIndex: z.number().int().min(0),
  isFinal: z.boolean(),
  events: z.array(rrwebEventSchema).max(10000),
  pageUrl: z.string().url().max(2048),
  userAgent: z.string().max(1024),
  startedAt: z.number().int().positive(),
})

export type TrackingPacket = z.infer<typeof trackingPacketSchema>
