const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"
const CLAUDE_MODEL = "claude-opus-4-7"
const CLAUDE_API_VERSION = "2023-06-01"
const DEFAULT_MAX_TOKENS = 4096

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
        | "auth_failed"
        | "rate_limit"
        | "api_error"
        | "network_error"
        | "invalid_response"
      details?: string
    }

// Вызов Anthropic Messages API. Native fetch, не SDK — консистентно
// с lib/metrika-client.ts.
//
// Не передаём temperature/top_p/top_k: Opus 4.7 их не поддерживает,
// возвращает 400.
export async function callClaude(req: ClaudeRequest): Promise<ClaudeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === "__NOT_SET__") {
    return {
      ok: false,
      error: "auth_failed",
      details: "ANTHROPIC_API_KEY not set",
    }
  }

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: req.system,
    messages: req.messages,
  }

  let response: Response
  try {
    response = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": CLAUDE_API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return {
      ok: false,
      error: "network_error",
      details: (err as Error).message,
    }
  }

  if (response.status === 401) {
    return { ok: false, error: "auth_failed" }
  }
  if (response.status === 429) {
    return { ok: false, error: "rate_limit" }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    return {
      ok: false,
      error: "api_error",
      details: `HTTP ${response.status}: ${text.slice(0, 500)}`,
    }
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    return { ok: false, error: "invalid_response", details: "not json" }
  }

  return parseClaudeResponse(json)
}

function parseClaudeResponse(json: unknown): ClaudeResult {
  // Ответ Anthropic Messages API:
  // {
  //   "id": "msg_...",
  //   "type": "message",
  //   "role": "assistant",
  //   "content": [{ "type": "text", "text": "..." }],
  //   "model": "claude-opus-4-7",
  //   "stop_reason": "end_turn",
  //   "usage": { "input_tokens": N, "output_tokens": M }
  // }
  if (typeof json !== "object" || json === null) {
    return { ok: false, error: "invalid_response", details: "not object" }
  }
  const obj = json as Record<string, unknown>

  if (!Array.isArray(obj.content) || obj.content.length === 0) {
    return {
      ok: false,
      error: "invalid_response",
      details: "missing content",
    }
  }
  const firstBlock = obj.content[0] as Record<string, unknown>
  if (firstBlock.type !== "text" || typeof firstBlock.text !== "string") {
    return {
      ok: false,
      error: "invalid_response",
      details: "expected text block",
    }
  }

  const usage = obj.usage as Record<string, unknown> | undefined
  return {
    ok: true,
    text: firstBlock.text,
    usage: {
      inputTokens:
        typeof usage?.input_tokens === "number" ? usage.input_tokens : 0,
      outputTokens:
        typeof usage?.output_tokens === "number" ? usage.output_tokens : 0,
    },
  }
}
