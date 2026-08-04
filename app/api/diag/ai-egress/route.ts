import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ВРЕМЕННЫЙ диагност-роут /api/diag/ai-egress (удалить после проверки
// CF-гейта). NB: папка НЕ с префиксом «_» — в App Router «_folder» приватная и
// не роутится. Нужен, потому что
// в serverless-контейнер нельзя зайти (нет exec), а тест обязан идти egress'ом
// КОНТЕЙНЕРА (РФ-IP), не с машины разработчика. Делает ровно то, что просили
// вручную: (1) показывает, каким IP/страной видит контейнер Cloudflare;
// (2) по желанию дёргает переданный AI-гейт минимальным запросом (5 токенов,
// НЕ runAnalysis) и возвращает статус+суть ответа.
//
// Защита: (a) обязателен заголовок x-diag-secret == CRON_SECRET (иначе 404 —
// не палим существование); (b) url ограничен хостом gateway.ai.cloudflare.com
// (SSRF-гард); (c) ключ/токены в ответ не выводим (санитайзер). Ключ OpenRouter
// берётся из env контейнера, новый cf-aig токен — из тела запроса.

function redact(s: string): string {
  return s
    .replace(/sk-[a-z]+-[A-Za-z0-9._-]+/gi, "[ключ]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer […]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("x-diag-secret") !== secret) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  // 1) Egress-идентичность контейнера глазами Cloudflare (ip + страна).
  let egress: { ip?: string; loc?: string; raw?: string } = {}
  try {
    const t = await fetch("https://cloudflare.com/cdn-cgi/trace")
    const text = await t.text()
    const ip = /(^|\n)ip=([^\n]+)/.exec(text)?.[2]
    const loc = /(^|\n)loc=([^\n]+)/.exec(text)?.[2]
    egress = { ip, loc }
  } catch (e) {
    egress = { raw: `trace failed: ${(e as Error).message}` }
  }

  // 2) Опциональный тест переданного гейта.
  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    /* тела может не быть — только egress */
  }
  const { url, cfAuth } = (body ?? {}) as { url?: string; cfAuth?: string }

  let gatewayTest:
    | { status: number; ok: boolean; body: string; host: string }
    | { skipped: string }
    | { error: string } = { skipped: "url/cfAuth не переданы — только egress" }

  if (url) {
    let host = ""
    try {
      host = new URL(url).hostname
    } catch {
      return NextResponse.json({ egress, error: "url невалиден" }, { status: 400 })
    }
    if (host !== "gateway.ai.cloudflare.com") {
      return NextResponse.json(
        { egress, error: `хост ${host} запрещён (только gateway.ai.cloudflare.com)` },
        { status: 400 },
      )
    }
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ egress, error: "OPENROUTER_API_KEY не задан" }, { status: 500 })
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://staging.xn--90abjntggcss.xn--p1ai",
      "X-Title": "Webmonitor",
    }
    if (cfAuth) headers["cf-aig-authorization"] = `Bearer ${cfAuth}`
    try {
      const r = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: process.env.AI_MODEL ?? "anthropic/claude-opus-4-7",
          max_tokens: 5,
          messages: [{ role: "user", content: "ping" }],
        }),
      })
      const text = await r.text().catch(() => "")
      gatewayTest = { status: r.status, ok: r.ok, body: redact(text), host }
    } catch (e) {
      gatewayTest = { error: `fetch failed: ${(e as Error).message}` }
    }
  }

  return NextResponse.json({ egress, gatewayTest })
}
