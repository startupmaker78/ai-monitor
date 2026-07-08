import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import fs from "fs"
import os from "os"
import path from "path"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const CERT_PATH = path.join(os.homedir(), ".postgresql", "root.crt")

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set")
  }

  if (!fs.existsSync(CERT_PATH)) {
    throw new Error(
      `Yandex Cloud root certificate not found at ${CERT_PATH}. Run: npm run test:connections`,
    )
  }
  const ca = fs.readFileSync(CERT_PATH, "utf8")

  const url = new URL(connectionString)
  url.searchParams.delete("sslmode")
  url.searchParams.delete("sslrootcert")

  const adapter = new PrismaPg({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ca },
  })

  return new PrismaClient({ adapter })
}

function createLazyPrisma(): PrismaClient {
  let instance: PrismaClient | undefined

  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (!instance) {
        instance = globalForPrisma.prisma ?? createPrismaClient()
        if (process.env.NODE_ENV !== "production") {
          globalForPrisma.prisma = instance
        }
      }
      return Reflect.get(instance, prop, instance)
    },
  })
}

export const prisma = createLazyPrisma()

// Транзиентный сбой pg-транспорта: Yandex Managed PostgreSQL закрывает
// idle TCP-соединения, а Prisma-singleton держит их в пуле как «живые».
// Первый запрос после idle тянет мёртвое → pg кидает
// "Connection terminated unexpectedly" / "Server has closed the
// connection" / ECONNRESET / Prisma P1001/P1017. После первого throw'а
// pool выбрасывает битое соединение — следующий вызов идёт через
// свежее. Значит 1 узкий retry прозрачно лечит проблему; ретраить
// больше нельзя (замаскируем реальный DB-даун).
//
// Взято 1-в-1 из app/api/tracking/should-record/route.ts, где паттерн
// уже отработал. TODO: переключить should-record на этот общий хелпер
// и удалить локальный дубль.
const TRANSIENT_MARKERS = [
  "Connection terminated unexpectedly",
  "Server has closed the connection",
  "ECONNRESET",
]
const TRANSIENT_CODES = new Set(["P1001", "P1017", "ECONNRESET"])

export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as { message?: string; code?: string }
  if (e.code && TRANSIENT_CODES.has(e.code)) return true
  if (e.message) {
    for (const m of TRANSIENT_MARKERS) {
      if (e.message.includes(m)) return true
    }
  }
  return false
}

export async function withDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (!isTransientDbError(err)) throw err
    await new Promise((r) => setTimeout(r, 120))
    return await fn()
  }
}
