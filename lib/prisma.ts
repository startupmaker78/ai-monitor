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
