import type { ClaudeMessage } from "./claude-client"

// Тип входных данных для построения промпта анализа.
export type AnalysisInput = {
  target: {
    url: string
    name: string | null
  }
  site: {
    domain: string
    isDemo: boolean
  }
  metrics: {
    visits: number
    uniqueVisitors: number
    bounceRate: number // 0-100
    avgSessionDuration: number // секунды
  } | null
  sessionsCount: number
  sessionSummaries: SessionSummary[]
}

// Структура одного summary сессии. На MVP в коммите 6.2 заполняется
// mock-данными. В коммите 6.3 будет извлекаться из rrweb-событий
// серверным парсером.
export type SessionSummary = {
  duration: number // секунды
  deviceType: "mobile" | "desktop" | "tablet"
  viewport: string // "375x812"
  scrollDepth: number // 0-1
  clicks: Array<{
    selector: string
    text: string
    timeMs: number
  }>
  formInteractions: Array<{
    field: string
    blurredEmpty: boolean
  }>
  rageClicks: Array<{
    selector: string
    count: number
    timeMs: number
  }>
  deadClicks: number
  exitElement: string | null
  errors: string[]
}

export type Recommendation = {
  priority: "CRITICAL" | "IMPORTANT" | "NICE_TO_HAVE"
  category: "USABILITY" | "CONTENT" | "MOBILE" | "PERFORMANCE" | "TRUST"
  title: string
  problem: string
  evidence: string
  recommendation: string
  expectedImpact: string
  effort: "LOW" | "MEDIUM" | "HIGH"
  low_confidence?: boolean
}

const SYSTEM_PROMPT = `Ты — эксперт по UX-аналитике и оптимизации конверсии веб-сайтов малого бизнеса. Твоя задача — анализировать поведение посетителей на конкретной странице и давать конкретные, прикладные рекомендации владельцу сайта.

Принципы работы:

1. Все рекомендации только на русском языке.

2. Каждая рекомендация должна быть подкреплена КОНКРЕТНЫМИ числами из предоставленных данных. Не пиши "многие пользователи" — пиши "73 из 100 сессий". Если конкретное число привести нельзя — рекомендация исключается.

3. Тон прямой и техничный. Не "попробуйте подумать о добавлении" — а "добавь sticky CTA внизу экрана". Юзеры — занятые предприниматели, им нужна суть.

4. Не выдумывай данных. Если не хватает информации для уверенной рекомендации — лучше выдай меньше рекомендаций.

5. Фокус на трёх категориях: USABILITY, CONTENT, MOBILE. PERFORMANCE и TRUST — только если есть явные сигналы.

6. Возвращай СТРОГО JSON-массив без какого-либо текста до или после. Никаких "Вот рекомендации:" или комментариев. Только массив.

7. От 5 до 10 рекомендаций. Если данных мало для 5 хороших — возвращай меньше, но с пометкой "low_confidence: true" в каждой.

Структура каждой рекомендации:

{
  "priority": "CRITICAL" | "IMPORTANT" | "NICE_TO_HAVE",
  "category": "USABILITY" | "CONTENT" | "MOBILE" | "PERFORMANCE" | "TRUST",
  "title": "Краткий заголовок 5-10 слов",
  "problem": "Что не так. 2-4 предложения. Описание проблемы из данных.",
  "evidence": "Конкретные числа: 'из 100 сессий 73 не доскроллили до CTA'",
  "recommendation": "Что сделать. 2-4 предложения. Конкретные действия.",
  "expectedImpact": "Например: 'конверсия с 2% до 4-6%' или 'снижение bounceRate с 65% до 50%'",
  "effort": "LOW" | "MEDIUM" | "HIGH",
  "low_confidence": false
}

Приоритизация:
- CRITICAL: проблема блокирует конверсию у >30% юзеров
- IMPORTANT: проблема влияет на 10-30%, но не блокирует полностью
- NICE_TO_HAVE: улучшение UX без явного измеримого влияния

Категории:
- USABILITY: проблемы с UI, кликабельностью, навигацией, формами
- CONTENT: проблемы с текстами, CTA, информацией, отсутствие нужного контента
- MOBILE: специфичные проблемы мобильной версии
- PERFORMANCE: долгая загрузка, JS-ошибки (только если есть данные)
- TRUST: проблемы с доверием — мало социальных доказательств, нет контактов, etc.

Effort:
- LOW: <1 час работы (изменить текст, поменять цвет, добавить иконку)
- MEDIUM: 1-4 часа (переработать секцию, добавить блок, изменить layout)
- HIGH: 4+ часов (редизайн страницы, новая функциональность)`

export function buildAnalysisPrompt(input: AnalysisInput): {
  system: string
  messages: ClaudeMessage[]
} {
  const userParts: string[] = []

  userParts.push(`Проанализируй страницу: ${input.target.url}`)
  if (input.target.name) {
    userParts.push(`Название: ${input.target.name}`)
  }

  userParts.push(``)
  userParts.push(`КОНТЕКСТ САЙТА:`)
  userParts.push(`- Domain: ${input.site.domain}`)
  if (input.site.isDemo) {
    userParts.push(
      `- ВНИМАНИЕ: Это демо-сайт, данные иллюстративные. Добавь в каждую рекомендацию пометку что это анализ демо-данных.`,
    )
  }

  userParts.push(``)
  if (input.metrics) {
    userParts.push(`МЕТРИКИ ЗА 30 ДНЕЙ:`)
    userParts.push(`- Визитов: ${input.metrics.visits}`)
    userParts.push(`- Уникальных посетителей: ${input.metrics.uniqueVisitors}`)
    userParts.push(`- Bounce rate: ${input.metrics.bounceRate.toFixed(1)}%`)
    userParts.push(
      `- Среднее время на странице: ${input.metrics.avgSessionDuration} сек`,
    )
  } else {
    userParts.push(
      `МЕТРИКИ ЗА 30 ДНЕЙ: данных Яндекс.Метрики нет, анализируй только по rrweb-сессиям.`,
    )
  }

  userParts.push(``)
  userParts.push(`СОБРАНО СЕССИЙ ДЛЯ АНАЛИЗА: ${input.sessionsCount}`)
  userParts.push(``)
  userParts.push(`СУММАРИ СЕССИЙ:`)
  userParts.push(JSON.stringify(input.sessionSummaries, null, 2))
  userParts.push(``)
  userParts.push(
    `Дай 5-10 конкретных рекомендаций как улучшить эту страницу. Возвращай только JSON-массив без какого-либо текста до или после.`,
  )

  const userPrompt = userParts.join("\n")

  // Opus 4.7 не поддерживает assistant message prefill (HTTP 400 с
  // "The conversation must end with a user message"). Полагаемся на
  // system-prompt пункт 6 ("Возвращай СТРОГО JSON-массив...") и на
  // defensive extraction в parseRecommendations.
  return {
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  }
}

// Парсит JSON-массив из ответа Claude. Даже если модель добавит
// текст-обёртку ("Вот рекомендации:" или markdown ```json),
// извлекаем содержимое между первым "[" и последним "]".
export function parseRecommendations(
  claudeOutput: string,
):
  | { ok: true; recommendations: Recommendation[] }
  | { ok: false; error: string } {
  const firstBracket = claudeOutput.indexOf("[")
  const lastBracket = claudeOutput.lastIndexOf("]")
  if (
    firstBracket === -1 ||
    lastBracket === -1 ||
    lastBracket <= firstBracket
  ) {
    return {
      ok: false,
      error: `No JSON array found. Output preview: ${claudeOutput.slice(0, 200)}`,
    }
  }
  const jsonText = claudeOutput.slice(firstBracket, lastBracket + 1)

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (err) {
    return {
      ok: false,
      error: `JSON parse failed: ${(err as Error).message}. Output preview: ${jsonText.slice(0, 200)}`,
    }
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Output is not an array" }
  }

  const valid: Recommendation[] = []
  const errors: string[] = []

  parsed.forEach((item, i) => {
    if (typeof item !== "object" || item === null) {
      errors.push(`Item ${i}: not an object`)
      return
    }
    const r = item as Record<string, unknown>

    if (
      typeof r.priority !== "string" ||
      !["CRITICAL", "IMPORTANT", "NICE_TO_HAVE"].includes(r.priority)
    ) {
      errors.push(`Item ${i}: invalid priority`)
      return
    }
    if (
      typeof r.category !== "string" ||
      !["USABILITY", "CONTENT", "MOBILE", "PERFORMANCE", "TRUST"].includes(
        r.category,
      )
    ) {
      errors.push(`Item ${i}: invalid category`)
      return
    }
    if (
      typeof r.title !== "string" ||
      typeof r.problem !== "string" ||
      typeof r.evidence !== "string" ||
      typeof r.recommendation !== "string" ||
      typeof r.expectedImpact !== "string"
    ) {
      errors.push(`Item ${i}: missing string fields`)
      return
    }
    if (
      typeof r.effort !== "string" ||
      !["LOW", "MEDIUM", "HIGH"].includes(r.effort)
    ) {
      errors.push(`Item ${i}: invalid effort`)
      return
    }

    valid.push(r as unknown as Recommendation)
  })

  if (valid.length === 0) {
    return {
      ok: false,
      error: `No valid recommendations. Errors: ${errors.join("; ")}`,
    }
  }

  return { ok: true, recommendations: valid }
}
