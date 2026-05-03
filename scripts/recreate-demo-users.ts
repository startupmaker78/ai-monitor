import { prisma } from "../lib/prisma"

async function deleteUserCascade(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      ownerProfile: { include: { sites: true } },
    },
  })

  if (!user) {
    console.log(`- Not found (skip): ${email}`)
    return
  }

  const siteIds = user.ownerProfile?.sites.map((s) => s.id) ?? []

  await prisma.$transaction(async (tx) => {
    if (siteIds.length > 0) {
      // Recommendations cascade-ятся от Analysis.
      await tx.analysis.deleteMany({ where: { siteId: { in: siteIds } } })
      await tx.session.deleteMany({ where: { siteId: { in: siteIds } } })
      await tx.analysisTarget.deleteMany({ where: { siteId: { in: siteIds } } })
      await tx.metricsSnapshot.deleteMany({ where: { siteId: { in: siteIds } } })
      await tx.site.deleteMany({ where: { id: { in: siteIds } } })
    }
    if (user.ownerProfile) {
      await tx.ownerProfile.delete({ where: { id: user.ownerProfile.id } })
    }
    await tx.user.delete({ where: { id: user.id } })
  })

  console.log(`✓ Deleted: ${email}`)
}

async function main() {
  for (const email of [
    "test-seed-1@example.com",
    "demo-public@webmonitor.local",
  ]) {
    await deleteUserCascade(email)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
