// Standalone smoke для lib/session-pre-processor.ts.
// Usage: npm run test:session-pre-processor -- <sessionToken>
//
// Берёт сессию из БД по token, прогоняет extractSessionSummary с реальными
// rrweb-пакетами из Object Storage, печатает ExtractResult.

import { prisma } from "../lib/prisma"
import { extractSessionSummary } from "../lib/session-pre-processor"

async function main() {
  const sessionToken = process.argv[2]
  if (!sessionToken) {
    console.error(
      "Usage: npm run test:session-pre-processor -- <sessionToken>",
    )
    process.exit(1)
  }

  const session = await prisma.session.findUnique({
    where: { sessionToken },
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
    console.error(`Session not found: ${sessionToken}`)
    process.exit(1)
  }

  console.log("Session meta:", {
    id: session.id,
    sessionToken: session.sessionToken,
    siteId: session.siteId,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    eventsCount: session.eventsCount,
    userAgent: session.userAgent,
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

  console.log(`\nExtract took ${dur}ms`)
  console.log("Result:")
  console.log(JSON.stringify(result, null, 2))

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error("FATAL:", e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
