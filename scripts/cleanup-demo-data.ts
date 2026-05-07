// Standalone cleanup для всех Sites с isDemo=true и их каскадных
// зависимостей. Запускается вручную:
//   npm run cleanup:demo-data
//
// Удаляет:
//   - rrweb-пакеты в Object Storage (sessions/{siteId}/...)
//   - Recommendation → Analysis → AnalysisTarget → MetricsSnapshot → Session → Site
//
// Все Site-relations в schema.prisma имеют onDelete: Restrict, поэтому
// ручные deleteMany в правильном порядке обязательны.

import { prisma } from "../lib/prisma"
import { listKeys, deleteObjects } from "../lib/storage"

const S3_BATCH_SIZE = 1000 // лимит DeleteObjectsCommand в S3 API

async function main() {
  console.log("=== Cleanup demo data ===")

  const demoSites = await prisma.site.findMany({
    where: { isDemo: true },
    select: { id: true, domain: true, ownerId: true },
  })
  console.log(`Found ${demoSites.length} demo sites`)
  if (demoSites.length === 0) {
    console.log("Nothing to clean")
    await prisma.$disconnect()
    return
  }

  for (const site of demoSites) {
    console.log(`\nProcessing site ${site.id} (domain=${site.domain})`)

    // 1. Object Storage — удалить все rrweb-пакеты этого сайта.
    let s3Deleted = 0
    let s3Failed = 0
    try {
      const keys = await listKeys(`sessions/${site.id}/`)
      console.log(`  S3 keys: ${keys.length}`)
      for (let i = 0; i < keys.length; i += S3_BATCH_SIZE) {
        const batch = keys.slice(i, i + S3_BATCH_SIZE)
        const failedKeys = await deleteObjects(batch)
        s3Deleted += batch.length - failedKeys.length
        s3Failed += failedKeys.length
      }
      console.log(
        `  S3 deleted=${s3Deleted} failed=${s3Failed}`,
      )
    } catch (e) {
      console.error(
        `  ⚠ S3 cleanup error (continuing with DB cleanup): ${(e as Error).message}`,
      )
    }

    // 2. БД — порядок важен из-за Restrict.
    // Recommendation→Analysis имеет Cascade, значит deleteMany Analysis
    // снесёт recs автоматом, но явный deleteMany Recommendation —
    // defensive (на случай orphan-записей).
    const recs = await prisma.recommendation.deleteMany({
      where: { analysis: { siteId: site.id } },
    })
    const analyses = await prisma.analysis.deleteMany({
      where: { siteId: site.id },
    })
    const targets = await prisma.analysisTarget.deleteMany({
      where: { siteId: site.id },
    })
    const snaps = await prisma.metricsSnapshot.deleteMany({
      where: { siteId: site.id },
    })
    const sessions = await prisma.session.deleteMany({
      where: { siteId: site.id },
    })
    await prisma.site.delete({ where: { id: site.id } })

    console.log(
      `  DB deleted: recs=${recs.count} analyses=${analyses.count} ` +
        `targets=${targets.count} snapshots=${snaps.count} ` +
        `sessions=${sessions.count} site=1`,
    )
    console.log(`  ✓ Cleaned up site ${site.id}`)
  }

  console.log("\n=== Done ===")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error("FATAL:", e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
