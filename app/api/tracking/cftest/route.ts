// ⚠️ TEMP ДИАГНОСТИЧЕСКИЙ РОУТ — УДАЛИТЬ ПОСЛЕ ПРОВЕРКИ CF AI Gateway.
// Назначение: подтвердить из РФ-IP контейнера (YC ru-central1), обходит
// ли CF AI Gateway geo-блок OpenRouter (403 с РФ-IP напрямую). Делает
// контрольный прямой вызов OpenRouter (ждём 403) и вызов через CF
// Gateway (ждём 200), возвращает статусы + egress-IP. Ключи/токены НЕ
// выводятся. Guard по CRON_SECRET (уже в env). Аналог TEMP echotest для
// gzip (DECISIONS 2026-07-09). НЕ ОСТАВЛЯТЬ В ПРОДЕ.
import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CF_ENDPOINT =
  "https://gateway.ai.cloudflare.com/v1/7158734ca2e27f75d512bc60523f05a1/default/openrouter/v1/chat/completions"
const OPENROUTER_DIRECT = "https://openrouter.ai/api/v1/chat/completions"
const BODY = JSON.stringify({
  model: "anthropic/claude-opus-4-7",
  max_tokens: 1,
  messages: [{ role: "user", content: "hi" }],
})

async function probe(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number | string; snippet: string }> {
  try {
    const r = await fetch(url, { method: "POST", headers, body: BODY })
    const text = await r.text().catch(() => "")
    return { status: r.status, snippet: text.slice(0, 200) }
  } catch (e) {
    return { status: "fetch_error", snippet: (e as Error).message.slice(0, 200) }
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Guard: ?secret= должен совпасть с CRON_SECRET (уже смонтирован в env).
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.nextUrl.searchParams.get("secret") !== cronSecret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  try {
    const orKey = process.env.OPENROUTER_API_KEY
    const cfToken = process.env.AI_GATEWAY_AUTH

    // egress IP (подтверждает РФ-контур контейнера).
    let egressIp = "?"
    let egressCountry = "?"
    try {
      const ipr = await fetch("https://ipinfo.io/json")
      const ipj = (await ipr.json().catch(() => ({}))) as {
        ip?: string
        country?: string
      }
      egressIp = ipj.ip ?? "?"
      egressCountry = ipj.country ?? "?"
    } catch (e) {
      egressIp = "ipinfo_error: " + (e as Error).message.slice(0, 80)
    }

    const keyPresent = Boolean(orKey && orKey !== "__NOT_SET__")
    const tokenPresent = Boolean(cfToken)

    // (A) контроль — прямой OpenRouter, ждём 403.
    const direct = keyPresent
      ? await probe(OPENROUTER_DIRECT, {
          Authorization: `Bearer ${orKey}`,
          "content-type": "application/json",
        })
      : { status: "no_key", snippet: "OPENROUTER_API_KEY missing" }

    // (B) через CF AI Gateway, ждём 200.
    const cf =
      keyPresent && tokenPresent
        ? await probe(CF_ENDPOINT, {
            Authorization: `Bearer ${orKey}`,
            "cf-aig-authorization": `Bearer ${cfToken}`,
            "content-type": "application/json",
          })
        : {
            status: "no_creds",
            snippet: `keyPresent=${keyPresent} tokenPresent=${tokenPresent}`,
          }

    return NextResponse.json({
      egressIp,
      egressCountry,
      keyPresent,
      tokenPresent,
      directStatus: direct.status,
      directBodySnippet: direct.snippet,
      cfStatus: cf.status,
      cfBodySnippet: cf.snippet,
    })
  } catch (e) {
    return NextResponse.json(
      { error: "handler_error", message: (e as Error).message.slice(0, 200) },
      { status: 200 },
    )
  }
}
