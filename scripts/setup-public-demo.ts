import { randomUUID } from "crypto"
import bcrypt from "bcrypt"
import { prisma } from "../lib/prisma"
import { seedDemoSite } from "../lib/seed-demo"

async function main() {
  const email = "demo-public@webmonitor.local"

  const existing = await prisma.user.findUnique({
    where: { email },
    include: {
      ownerProfile: {
        include: { sites: true },
      },
    },
  })

  if (existing) {
    console.log("⚠️  Public demo user already exists.")
    console.log("User ID:", existing.id)
    console.log("Sites:", existing.ownerProfile?.sites.length ?? 0)
    console.log("")
    console.log("To re-seed, delete the user first:")
    console.log(`  await prisma.user.delete({ where: { email: "${email}" } })`)
    return
  }

  const { userId, siteId } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: "Демо-владелец",
        passwordHash: await bcrypt.hash(randomUUID(), 10),
        role: "OWNER",
      },
    })

    const ownerProfile = await tx.ownerProfile.create({
      data: { userId: user.id, contractorId: null },
    })

    const site = await tx.site.create({
      data: {
        ownerId: ownerProfile.id,
        domain: "demo.example.com",
        trackingToken: randomUUID().replace(/-/g, ""),
        isDemo: true,
      },
    })

    return { userId: user.id, siteId: site.id }
  })

  await seedDemoSite({ siteId, userId })

  console.log("✅ Public demo user created:")
  console.log("")
  console.log("  DEMO_USER_ID=" + userId)
  console.log("")
  console.log("Add this to .env.local and to Lockbox secret webmonitor-staging-secrets.")
  console.log("Then /demo page will use this user as data source.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
