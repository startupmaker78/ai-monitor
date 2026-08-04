import { Agent, fetch as undiciFetch } from "undici"

// Прокси через OpenRouter, потому что api.anthropic.com отвечает 403
// "Request not allowed" на запросы с РФ-IP (наш staging в YC ru-central1).
// OpenRouter отдаёт OpenAI-совместимый chat completions API; модель
// anthropic/claude-opus-4-7 проходит через Amazon Bedrock.
// Дефолты; переопределяются из env ПРИ ВЫЗОВЕ (не при сборке) —
// смена провайдера/прокси = обновление Lockbox без rebuild. AI_API_URL
// = наш Fly-прокси (Франкфурт) к OpenRouter: region-pinned не-РФ egress
// обходит гео-блок (CF AI Gateway отвалился — резал РФ-IP; см. DECISIONS
// 2026-08-05); fallback — прямой OpenRouter.
const DEFAULT_API_URL = "https://openrouter.ai/api/v1/chat/completions"
const DEFAULT_MODEL = "anthropic/claude-opus-4-7"
const DEFAULT_MAX_TOKENS = 4096
const REFERER_URL = "https://staging.xn--90abjntggcss.xn--p1ai" // Punycode for staging.вебмонитор.рф (проверено node: toUnicode → вебмонитор.рф)
const APP_TITLE = "Webmonitor"

// СВЕЖИЙ СОКЕТ НА ВЫЗОВ (DECISIONS 2026-08-05): диагностика показала — тяжёлые
// (long-running) запросы к Fly-прокси интермиттентно падают connect-timeout'ом,
// лёгкие — никогда. Сильная гипотеза: undici переиспользует keep-alive
// соединение, которое Fly уже закрыл по idle → следующий connect на РФ→fra
// теряет SYN. keepAliveTimeout=1мс фактически отключает переиспользование:
// сокет закрывается сразу после ответа, каждый вызов идёт по свежему. Держим
// СВОЙ dispatcher (не глобальный) — метрика/прочие fetch не трогаем. Своя
// undici (не встроенная в Node) — Agent и fetch должны быть из одного пакета.
const AI_DISPATCHER = new Agent({
  keepAliveTimeout: 1,
  keepAliveMaxTimeout: 1,
  pipelining: 0,
})

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
        | "proxy_error" // отказ НАШЕГО Fly-прокси (X-Webmon-Proxy), не провайдер
        | "access_denied" // 403 провайдера — причину НЕ приписываем
        | "insufficient_credits" // 402 — баланс/кредиты провайдера
        | "rate_limit"
        | "relay_unavailable"
        | "api_error"
        | "network_error"
        | "invalid_response"
      // Санитизированная суть ответа провайдера (без ключей/URL) — в лог и в
      // клиентское сообщение. Под-причины по РЕАЛЬНЫМ телам: ключ OR 401
      // «User not found»; кредиты 402. Отказ самого прокси — отдельно,
      // по заголовку X-Webmon-Proxy (см. ниже), не путается с провайдером.
      details?: string
    }

// Вычищает всё, что похоже на секреты/внутренние URL, из текста ответа
// провайдера — чтобы санитизированная суть могла безопасно уйти и в лог, и в
// клиентское сообщение. Тела ошибок обычно НЕ эхают Authorization, но чистим
// как defense-in-depth (ключ OR sk-…, X-Proxy-Auth/Bearer, любой https-URL).
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
  // Токен нашего Fly-прокси (X-Proxy-Auth). Прокси без него отдаёт 403 (не
  // открытый релей). Шлём ТОЛЬКО если задан — при прямом OpenRouter не нужен.
  const proxyAuth = process.env.AI_PROXY_AUTH

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
  if (proxyAuth) {
    headers["X-Proxy-Auth"] = proxyAuth
  }

  // undici-fetch со СВОИМ dispatcher без keep-alive (свежий сокет на вызов).
  let response: Awaited<ReturnType<typeof undiciFetch>>
  try {
    response = await undiciFetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      dispatcher: AI_DISPATCHER,
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

  // ОТКАЗ САМОГО ПРОКСИ (не провайдера) — ДО разбора статуса. Fly-прокси
  // помечает свои ответы заголовком X-Webmon-Proxy (плохой X-Proxy-Auth → 403
  // с этим заголовком). Если сначала классифицировать по статусу, 403 прокси
  // уехал бы в access_denied — ровно та склейка причин, которую мы чиним.
  // proxy_error = наш конфиг/токен прокси, НЕ провайдер.
  if (response.headers.get("x-webmon-proxy")) {
    const text = await response.text().catch(() => "")
    return {
      ok: false,
      error: "proxy_error",
      details: providerReason(text, response.status),
    }
  }

  if (response.status === 401) {
    // 401 провайдера — ключ OpenRouter отклонён («User not found», проверено).
    const text = await response.text().catch(() => "")
    return {
      ok: false,
      error: "auth_failed",
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
    // 403 провайдера (отказ прокси уже отсеян выше по X-Webmon-Proxy). Повтор
    // не поможет — нужна проверка доступа/конфигурации. Причину (гео/политика)
    // НЕ приписываем — суть в details.
    const text = await response.text().catch(() => "")
    return {
      ok: false,
      error: "access_denied",
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
