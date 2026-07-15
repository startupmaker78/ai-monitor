// Standalone smoke для lib/session-pre-processor.ts.
// Usage: dotenv -e .env.local -- tsx scripts/test-session-pre-processor.ts <tokenPrefix> [<tokenPrefix> ...]
//
// Берёт сессию(и) из БД по префиксу sessionToken, прогоняет
// extractSessionSummary с реальными rrweb-пакетами из Object Storage,
// печатает ExtractResult. Read-only.
import * as dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { prisma } from "../lib/prisma"
import { extractSessionSummary } from "../lib/session-pre-processor"

async function runOne(prefix: string) {
  const session = await prisma.session.findFirst({
    where: { sessionToken: { startsWith: prefix } },
    select: {
      id: true,
      siteId: true,
      sessionToken: true,
      startedAt: true,
      endedAt: true,
      userAgent: true,
      eventsCount: true,
    },
  })
  if (!session) {
    console.error(`\n=== ${prefix}: Session NOT FOUND ===`)
    return
  }

  console.log(`\n=== ${session.sessionToken.slice(0, 8)} ===`)
  console.log("Session meta:", {
    siteId: session.siteId,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    eventsCount: session.eventsCount,
    userAgent: session.userAgent?.slice(0, 60),
  })

  const t0 = Date.now()
  const result = await extractSessionSummary(
    session.siteId,
    session.sessionToken,
    {
      sessionStartedAtMs: session.startedAt.getTime(),
      sessionEndedAtMsFromDb: session.endedAt?.getTime() ?? null,
      userAgent: session.userAgent,
    },
  )
  const dur = Date.now() - t0

  console.log(`Extract took ${dur}ms`)
  console.log("Result:", JSON.stringify(result, null, 2))
}

async function main() {
  const prefixes = process.argv.slice(2)
  if (prefixes.length === 0) {
    console.error(
      "Usage: dotenv -e .env.local -- tsx scripts/test-session-pre-processor.ts <tokenPrefix> [...]",
    )
    process.exit(1)
  }
  for (const p of prefixes) await runOne(p)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error("FATAL:", e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
