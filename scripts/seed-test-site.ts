import bcrypt from "bcryptjs"
import { prisma } from "../lib/prisma"

const TEST_EMAIL = "tracker-test@webmonitor.local"
const TEST_PASSWORD = "test12345"
const SITE_DOMAIN = "localhost:3001"
const SITE_TOKEN = "local-test-token-EXIST"

async function main() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10)

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email: TEST_EMAIL },
      create: {
        email: TEST_EMAIL,
        name: "Tracker Test",
        role: "OWNER",
        passwordHash,
      },
      update: {},
    })

    const owner = await tx.ownerProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, contractorId: null },
      update: {},
    })

    const site = await tx.site.upsert({
      where: { trackingToken: SITE_TOKEN },
      create: {
        ownerId: owner.id,
        domain: SITE_DOMAIN,
        trackingToken: SITE_TOKEN,
        isDemo: false,
      },
      update: {},
    })

    return { user, owner, site }
  })

  console.log("✅ test site ready")
  console.log("   trackingToken: " + result.site.trackingToken)
  console.log("   siteId: " + result.site.id)
  console.log("   ownerId: " + result.owner.id)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
