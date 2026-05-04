import { fetchMetrikaDaily } from "../lib/metrika-client"

// Этот скрипт НЕ делает реальный запрос — мы тестируем только парсер.
// Для этого временно подменяем global.fetch.

const mockResponse = {
  data: [
    {
      metrics: [
        [10, 12, 15], // visits
        [8, 10, 13], // users
        [45.2, 48.1, 50.5], // bounceRate
        [120, 130, 145], // avgVisitDurationSeconds
      ],
    },
  ],
  time_intervals: [
    ["2026-05-01", "2026-05-01"],
    ["2026-05-02", "2026-05-02"],
    ["2026-05-03", "2026-05-03"],
  ],
}

const g = global as unknown as Record<string, unknown>
const originalFetch = g.fetch

g.fetch = async () =>
  new Response(JSON.stringify(mockResponse), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })

async function main() {
  const result = await fetchMetrikaDaily("12345", "fake-token")

  if (!result.ok) {
    console.error("FAIL: parser returned error", result)
    process.exit(1)
  }

  if (result.snapshots.length !== 3) {
    console.error(`FAIL: expected 3 snapshots, got ${result.snapshots.length}`)
    process.exit(1)
  }

  const day1 = result.snapshots[0]
  if (
    day1.visits !== 10 ||
    day1.uniqueVisitors !== 8 ||
    day1.bounceRate !== 45.2 ||
    day1.avgSessionDuration !== 120
  ) {
    console.error("FAIL: day 1 mismatch", day1)
    process.exit(1)
  }

  if (day1.date.toISOString() !== "2026-05-01T00:00:00.000Z") {
    console.error(`FAIL: date normalization wrong: ${day1.date.toISOString()}`)
    process.exit(1)
  }

  console.log("✓ parser: 3 snapshots, fields, UTC date normalization")

  // 401 → auth_failed
  g.fetch = async () => new Response("Unauthorized", { status: 401 })
  const authFailResult = await fetchMetrikaDaily("12345", "fake-token")
  if (authFailResult.ok || authFailResult.error !== "auth_failed") {
    console.error("FAIL: 401 should produce auth_failed", authFailResult)
    process.exit(1)
  }
  console.log("✓ 401 → auth_failed")

  // non-json body → invalid_response
  g.fetch = async () => new Response("not json", { status: 200 })
  const invalidResult = await fetchMetrikaDaily("12345", "fake-token")
  if (invalidResult.ok || invalidResult.error !== "invalid_response") {
    console.error("FAIL: non-json should produce invalid_response", invalidResult)
    process.exit(1)
  }
  console.log("✓ non-json → invalid_response")

  g.fetch = originalFetch
  console.log("\n🎉 All parser tests passed")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
