import { prisma } from "../lib/prisma"

async function main() {
  const targets = await prisma.analysisTarget.findMany({
    orderBy: [{ siteId: "asc" }, { url: "asc" }],
    select: {
      url: true,
      status: true,
      sessionsCollected: true,
      sessionsBudget: true,
      budgetSpent: true,
      archivedAt: true,
    },
  })

  console.log(`Total targets: ${targets.length}\n`)
  console.log(
    `URL                        | Status      | Collected | Budget | budgetSpent | Archived`,
  )
  console.log(
    `---------------------------|-------------|-----------|--------|-------------|---------`,
  )
  for (const t of targets) {
    const url = t.url.padEnd(26).slice(0, 26)
    const status = t.status.padEnd(11)
    const collected = String(t.sessionsCollected).padStart(9)
    const budget = String(t.sessionsBudget).padStart(6)
    const spent = String(t.budgetSpent).padEnd(11)
    const archived = t.archivedAt ? "yes" : "no"
    console.log(
      `${url} | ${status} | ${collected} | ${budget} | ${spent} | ${archived}`,
    )
  }

  console.log("\nInconsistency checks:")

  const activeWithSpent = targets.filter(
    (t) => (t.status === "ACTIVE" || t.status === "READY") && t.budgetSpent,
  )
  if (activeWithSpent.length > 0) {
    console.log(
      `❌ ${activeWithSpent.length} ACTIVE/READY targets with budgetSpent=true (should be false):`,
    )
    activeWithSpent.forEach((t) =>
      console.log(`   - ${t.url} (${t.status})`),
    )
  } else {
    console.log("✓ Нет ACTIVE/READY с budgetSpent=true")
  }

  const completedWithoutSpent = targets.filter(
    (t) =>
      (t.status === "ANALYZING" || t.status === "COMPLETED") && !t.budgetSpent,
  )
  if (completedWithoutSpent.length > 0) {
    console.log(
      `❌ ${completedWithoutSpent.length} ANALYZING/COMPLETED без budgetSpent=true:`,
    )
    completedWithoutSpent.forEach((t) =>
      console.log(`   - ${t.url} (${t.status})`),
    )
  } else {
    console.log("✓ Все ANALYZING/COMPLETED имеют budgetSpent=true")
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
