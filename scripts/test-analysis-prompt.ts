import { callClaude } from "../lib/claude-client"
import {
  buildAnalysisPrompt,
  parseRecommendations,
} from "../lib/analysis-prompt"
import { buildMockAnalysisInput } from "../lib/mock-session-data"

async function main() {
  const input = buildMockAnalysisInput()

  console.log(`\n📊 АНАЛИЗ СТРАНИЦЫ`)
  console.log(`URL: ${input.target.url}`)
  console.log(`Сессий: ${input.sessionsCount}`)
  if (input.metrics) {
    console.log(
      `Метрики: ${input.metrics.visits} визитов, bounce ${input.metrics.bounceRate}%`,
    )
  }
  console.log(``)
  console.log(`⏳ Запрос к Claude opus 4.7...`)

  const startTime = Date.now()
  const { system, messages } = buildAnalysisPrompt(input)

  const result = await callClaude({ system, messages, maxTokens: 4096 })

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  if (!result.ok) {
    console.error(`\n❌ ОШИБКА: ${result.error}`)
    if (result.details) console.error(`   Details: ${result.details}`)
    process.exit(1)
  }

  console.log(`✅ Ответ получен за ${duration} сек`)
  console.log(
    `   Tokens: ${result.usage.inputTokens} input, ${result.usage.outputTokens} output`,
  )
  // Pricing для Claude Opus 4.7: $15/M input, $75/M output
  // (см. https://www.anthropic.com/news/claude-opus-4-7)
  const inputCost = (result.usage.inputTokens * 15) / 1_000_000
  const outputCost = (result.usage.outputTokens * 75) / 1_000_000
  console.log(
    `   Стоимость: ~$${(inputCost + outputCost).toFixed(4)} (input $${inputCost.toFixed(4)} + output $${outputCost.toFixed(4)})`,
  )
  console.log(``)

  const parsed = parseRecommendations(result.text)

  if (!parsed.ok) {
    console.error(`❌ ПАРСИНГ НЕ УДАЛСЯ: ${parsed.error}`)
    console.log(`\n📝 RAW ОТВЕТ ОТ CLAUDE:`)
    console.log("[" + result.text)
    process.exit(1)
  }

  console.log(`📋 РЕКОМЕНДАЦИЙ: ${parsed.recommendations.length}\n`)
  console.log(`═══════════════════════════════════════════════════════\n`)

  parsed.recommendations.forEach((r, i) => {
    const priority =
      r.priority === "CRITICAL"
        ? "🔴"
        : r.priority === "IMPORTANT"
          ? "🟡"
          : "🟢"
    console.log(`${priority} #${i + 1} [${r.category}] ${r.title}`)
    console.log(
      `   Effort: ${r.effort}${r.low_confidence ? " • Low confidence" : ""}`,
    )
    console.log(``)
    console.log(`   Проблема:`)
    console.log(`   ${r.problem}`)
    console.log(``)
    console.log(`   Evidence: ${r.evidence}`)
    console.log(``)
    console.log(`   Что делать:`)
    console.log(`   ${r.recommendation}`)
    console.log(``)
    console.log(`   Ожидаемый эффект: ${r.expectedImpact}`)
    console.log(``)
    console.log(`───────────────────────────────────────────────────────\n`)
  })

  console.log(`✓ Тест завершён.`)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
