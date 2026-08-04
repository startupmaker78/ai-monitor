// Прокси через OpenRouter, потому что api.anthropic.com отвечает 403
// "Request not allowed" на запросы с РФ-IP (наш staging в YC ru-central1).
// OpenRouter отдаёт OpenAI-совместимый chat completions API; модель
// anthropic/claude-opus-4-7 проходит через Amazon Bedrock.
// Дефолты; переопределяются из env ПРИ ВЫЗОВЕ (не при сборке) —
// смена провайдера/AI-шлюза = обновление Lockbox без rebuild. AI_API_URL
// = CF AI Gateway endpoint (обход гео-блока OpenRouter из РФ, доказано
// TEMP-тестом: direct 403 / via CF 200); fallback — прямой OpenRouter.
const DEFAULT_API_URL = "https://openrouter.ai/api/v1/chat/completions"
const DEFAULT_MODEL = "anthropic/claude-opus-4-7"
const DEFAULT_MAX_TOKENS = 4096
const REFERER_URL = "https://staging.xn--90abjntggcss.xn--p1ai" // Punycode for staging.вебмонитор.рф (проверено node: toUnicode → вебмонитор.рф)
const APP_TITLE = "Webmonitor"

export type ClaudeMessage = {
  role: "user" | "assistant"
  content: string
}

export type ClaudeRequest = {
  system: string
  messages: ClaudeMessage[]
  maxTokens?: number
}

export type ClaudeResult =
  | {
      ok: true
      text: string
      usage: { inputTokens: number; outputTokens: number }
    }
  | {
      ok: false
      error:
        | "auth_failed" // 401 провайдера: ключ OpenRouter отклонён
        | "gateway_auth_failed" // 401 самого CF-шлюза: cf-aig токен
        | "gateway_blocked" // 403 CF security policy (Access denied by security policy)
        | "access_denied" // прочий 403 — причину НЕ приписываем
        | "insufficient_credits" // 402 — баланс/кредиты провайдера
        | "rate_limit"
        | "relay_unavailable"
        | "api_error"
        | "network_error"
        | "invalid_response"
      // Санитизированная суть ответа провайдера/шлюза (без ключей/URL) — в лог
      // и в клиентское сообщение. Различаем под-причины по РЕАЛЬНЫМ телам:
      // CF policy 403 «Access denied by security policy»; CF auth 401
      // AiGatewayError/2009; ключ OR 401 «User not found»; кредиты 402.
      details?: string
    }

// Вычищает всё, что похоже на секреты/внутренние URL, из текста ответа
// провайдера — чтобы санитизированная суть могла безопасно уйти и в лог, и в
// клиентское сообщение. Тела ошибок обычно НЕ эхают Authorization, но чистим
// как defense-in-depth (ключ OR sk-…, cf-aig Bearer, любой https-URL шлюза).
function sanitizeProviderText(s: string): string {
  return s
    .replace(/sk-[a-z]+-[A-Za-z0-9._-]+/gi, "[ключ]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer […]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\s+/g, " ")
    .trim()
}

// Достаёт короткую СУТЬ из тела ошибки: поля error (строка) / error.message /
// error[].message / message у OpenRouter и CF; иначе — сырое тело. Санитизирует
// и обрезает. Возвращает «HTTP <status>: <суть>» для лога и (через маппинг) для
// сообщения — самая диагностичная строка ответа, без ключей/URL.
function providerReason(body: string, status: number): string {
  let reason = ""
  try {
    const j = JSON.parse(body) as {
      error?: unknown
      message?: unknown
    }
    if (typeof j.error === "string") reason = j.error
    else if (j.error && typeof j.error === "object") {
      const e = j.error as { message?: unknown }
      const arr = j.error as Array<{ message?: unknown }>
      if (typeof e.message === "string") reason = e.message
      else if (Array.isArray(j.error) && typeof arr[0]?.message === "string")
        reason = arr[0].message as string
    }
    if (!reason && typeof j.message === "string") reason = j.message
  } catch {
    // тело не JSON — используем как есть (санитизированным)
  }
  if (!reason) reason = body
  return `HTTP ${status}: ${sanitizeProviderText(reason).slice(0, 160)}`
}

// Native fetch, не SDK — консистентно с lib/metrika-client.ts.
//
// Не передаём temperature/top_p/top_k: Opus 4.7 их не поддерживает,
// возвращает 400. OpenRouter прокидывает параметры в Anthropic как есть,
// поэтому ограничение действует и здесь.
export async function callClaude(req: ClaudeRequest): Promise<ClaudeResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey || apiKey === "__NOT_SET__") {
    return {
      ok: false,
      error: "auth_failed",
      details: "OPENROUTER_API_KEY not set",
    }
  }

  // Резолв конфигурации при вызове (env читается в рантайме контейнера).
  const apiUrl = process.env.AI_API_URL ?? DEFAULT_API_URL
  const model = process.env.AI_MODEL ?? DEFAULT_MODEL
  // Токен доступа к CF AI Gateway. Шлём заголовок ТОЛЬКО если задан —
  // при fallback на прямой OpenRouter лишний cf-aig-заголовок не нужен.
  const gatewayAuth = process.env.AI_GATEWAY_AUTH

  // Конвертация Anthropic-стиля {system, messages} в OpenAI-стиль:
  // system становится первым message с role:"system". Если caller уже
  // сам передал system-сообщение в messages — не дублируем.
  const oaiMessages: ClaudeMessage[] | Array<{ role: string; content: string }> =
    req.messages.length > 0 && req.messages[0].role === ("system" as never)
      ? req.messages
      : [{ role: "system", content: req.system }, ...req.messages]

  const body = {
    model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: oaiMessages,
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": REFERER_URL,
    "X-Title": APP_TITLE,
  }
  if (gatewayAuth) {
    headers["cf-aig-authorization"] = `Bearer ${gatewayAuth}`
  }

  let response: Response
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  } catch (err) {
    const e = err as Error & { code?: string; cause?: unknown }
    console.error("[claude-client] fetch failed", {
      errorName: e?.name,
      errorMessage: e?.message,
      errorCode: e?.code,
      cause: e?.cause,
    })
    return {
      ok: false,
      error: "network_error",
      details: e?.message,
    }
  }

  if (response.status === 401) {
    // Различаем 401 САМОГО шлюза (cf-aig токен, формат AiGatewayError/2009 —
    // проверено тестом «без cf-aig») от 401 ПРОВАЙДЕРА (ключ OpenRouter
    // отклонён, «User not found» — проверено тестом с невалидным ключом).
    const text = await response.text().catch(() => "")
    const isGatewayAuth = /AiGatewayError/i.test(text) || /"code"\s*:\s*2009/.test(text)
    return {
      ok: false,
      error: isGatewayAuth ? "gateway_auth_failed" : "auth_failed",
      details: providerReason(text, 401),
    }
  }
  if (response.status === 402) {
    // Payment Required — стандартный код исчерпанного баланса/кредитов.
    const text = await response.text().catch(() => "")
    return {
      ok: false,
      error: "insufficient_credits",
      details: providerReason(text, 402),
    }
  }
  if (response.status === 403) {
    // Различаем security-policy блок CF-эджа (реальное тело «Access denied by
    // security policy» — так режет РФ-IP контейнера) от прочих 403. Повтор НЕ
    // поможет — нужна проверка конфигурации. Причину (гео/иное) прочему 403 НЕ
    // приписываем — тела не видели.
    const text = await response.text().catch(() => "")
    const isSecurityPolicy = /access denied by security policy/i.test(text)
    return {
      ok: false,
      error: isSecurityPolicy ? "gateway_blocked" : "access_denied",
      details: providerReason(text, 403),
    }
  }
  if (response.status === 429) {
    return { ok: false, error: "rate_limit" }
  }
  if (response.status >= 500) {
    // 5xx от хоста шлюза/провайдера — наш путь лёг, не провайдерский
    // rate-limit. Отличаем от прочих 4xx.
    const text = await response.text().catch(() => "")
    return {
      ok: false,
      error: "relay_unavailable",
      details: providerReason(text, response.status),
    }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    return {
      ok: false,
      error: "api_error",
      details: providerReason(text, response.status),
    }
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    return { ok: false, error: "invalid_response", details: "not json" }
  }

  return parseOpenRouterResponse(json)
}

function parseOpenRouterResponse(json: unknown): ClaudeResult {
  // Ответ OpenRouter (OpenAI-совместимый):
  // {
  //   "id": "...",
  //   "object": "chat.completion",
  //   "created": ...,
  //   "model": "anthropic/claude-opus-4-7",
  //   "provider": "Amazon Bedrock",
  //   "choices": [{
  //     "index": 0,
  //     "finish_reason": "stop",
  //     "message": { "role": "assistant", "content": "..." }
  //   }],
  //   "usage": {
  //     "prompt_tokens": N,
  //     "completion_tokens": M,
  //     "total_tokens": N+M
  //   }
  // }
  if (typeof json !== "object" || json === null) {
    return { ok: false, error: "invalid_response", details: "not object" }
  }
  const obj = json as Record<string, unknown>

  if (!Array.isArray(obj.choices) || obj.choices.length === 0) {
    return {
      ok: false,
      error: "invalid_response",
      details: "choices empty or missing content",
    }
  }
  const firstChoice = obj.choices[0] as Record<string, unknown>
  const message = firstChoice.message as Record<string, unknown> | undefined
  const content = message?.content
  if (typeof content !== "string" || content.length === 0) {
    return {
      ok: false,
      error: "invalid_response",
      details: "choices empty or missing content",
    }
  }

  const usage = obj.usage as Record<string, unknown> | undefined
  return {
    ok: true,
    text: content,
    usage: {
      inputTokens:
        typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0,
      outputTokens:
        typeof usage?.completion_tokens === "number"
          ? usage.completion_tokens
          : 0,
    },
  }
}
