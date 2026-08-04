import { NextRequest, NextResponse } from "next/server"
import { callClaude } from "@/lib/claude-client"
import { listKeys, getJson } from "@/lib/storage"

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
  const { url, cfAuth, long, prodpath, preS3, siteId, preMetrika } = (body ?? {}) as {
    url?: string
    cfAuth?: string // cf-aig токен (тест CF-гейта)
    long?: boolean // true → ДЛИННАЯ генерация ~60-90с (проверка idle-таймаута прокси)
    prodpath?: boolean // true → воспроизвести БОЕВОЙ путь (env AI_API_URL + callClaude)
    preS3?: boolean // true → реальные S3-чтения (тот же keepAlive-клиент), ПОТОМ callClaude
    siteId?: string // префикс для preS3: sessions/<siteId>/
    preMetrika?: boolean // true → undici-GET к api-metrika.yandex.net, ПОТОМ callClaude
  }

  // Воспроизведение: сетевой вызов Метрики (последний перед callClaude в
  // runAnalysis) ПЕРЕД callClaude. Dummy-токен → 401/403, важна сама undici-
  // активность к yandex-хосту. Если после неё callClaude падает — виновник тут.
  if (preMetrika) {
    const m: { status?: number; ms?: number; error?: string } = {}
    const t0 = Date.now()
    try {
      const r = await fetch(
        "https://api-metrika.yandex.net/stat/v1/data/bytime?id=1&metrics=ym:s:visits",
        { method: "GET", headers: { Authorization: "OAuth diagdummy", Accept: "application/json" } },
      )
      await r.text().catch(() => "")
      m.status = r.status
      m.ms = Date.now() - t0
    } catch (e) {
      m.error = (e as Error).message
      m.ms = Date.now() - t0
    }
    const t1 = Date.now()
    const cc = await callClaude({ system: "Ты аналитик.", messages: [{ role: "user", content: "Проанализируй сессию. ".repeat(600) }], maxTokens: 50 })
    const ccOut = cc.ok
      ? { ok: true, ms: Date.now() - t1, textLen: cc.text.length }
      : { ok: false, ms: Date.now() - t1, error: cc.error, details: redact(cc.details ?? "") }
    return NextResponse.json({ egress, metrika: m, callClaude: ccOut })
  }

  // Воспроизведение: S3-активность (как сбор сессий) ПЕРЕД callClaude. Если
  // после S3 callClaude падает ConnectTimeout — виновник контекста = S3-клиент
  // (keepAlive https.Agent), а не транспорт.
  if (preS3) {
    const sid = siteId ?? "cms6sbelh00002v3cok3f1ogz" // staging по умолчанию
    const s3: { keysFound?: number; read?: number; error?: string } = {}
    const t0 = Date.now()
    try {
      const keys = await listKeys(`sessions/${sid}/`)
      s3.keysFound = keys.length
      let read = 0
      for (const k of keys.slice(0, 10)) {
        try { await getJson(k); read++ } catch { /* пропускаем битые */ }
      }
      s3.read = read
    } catch (e) {
      s3.error = (e as Error).message
    }
    const s3ms = Date.now() - t0
    // теперь — тот же callClaude, что и в runAnalysis
    const t1 = Date.now()
    const cc = await callClaude({ system: "Ты аналитик.", messages: [{ role: "user", content: "Проанализируй сессию. ".repeat(600) }], maxTokens: 50 })
    const ccOut = cc.ok
      ? { ok: true, ms: Date.now() - t1, textLen: cc.text.length }
      : { ok: false, ms: Date.now() - t1, error: cc.error, details: redact(cc.details ?? "") }
    return NextResponse.json({ egress, s3: { ...s3, ms: s3ms }, callClaude: ccOut })
  }

  // Воспроизведение боевого пути: две пробы из одного окружения контейнера.
  // (A) сырой fetch на process.env.AI_API_URL (как claude-client, не хардкод) с
  //     телом ~реального размера и теми же заголовками.
  // (B) сам callClaude() — точная прод-функция транспорта.
  // Если обе 200 — расхождение в контексте runAnalysis (сбор S3/метрика до
  // вызова). Если A/B падают ConnectTimeout — баг в env-URL / claude-client.
  if (prodpath) {
    const envUrl = process.env.AI_API_URL ?? ""
    const key = process.env.OPENROUTER_API_KEY ?? ""
    const pAuth = process.env.AI_PROXY_AUTH
    const bigText = "Проанализируй сессию. ".repeat(600) // ~12 КБ, размер с промпт
    // (A) сырой fetch, зеркало claude-client
    let rawA:
      | { ok: boolean; status: number; ms: number; body: string }
      | { error: string; ms: number }
    {
      const h: Record<string, string> = {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://staging.xn--90abjntggcss.xn--p1ai",
        "X-Title": "Webmonitor",
      }
      if (pAuth) h["X-Proxy-Auth"] = pAuth
      const t0 = Date.now()
      try {
        const r = await fetch(envUrl, {
          method: "POST",
          headers: h,
          body: JSON.stringify({
            model: process.env.AI_MODEL ?? "anthropic/claude-opus-4-7",
            max_tokens: 50,
            messages: [{ role: "user", content: bigText }],
          }),
        })
        const txt = await r.text().catch(() => "")
        rawA = { ok: r.ok, status: r.status, ms: Date.now() - t0, body: redact(txt) }
      } catch (e) {
        const err = e as Error & { cause?: { code?: string } }
        rawA = { error: `${err.message} / ${err.cause?.code ?? "?"}`, ms: Date.now() - t0 }
      }
    }
    // (B) сам callClaude — точный прод-транспорт
    const t1 = Date.now()
    const cc = await callClaude({ system: "Ты аналитик.", messages: [{ role: "user", content: bigText }], maxTokens: 50 })
    const ccOut = cc.ok
      ? { ok: true, ms: Date.now() - t1, textLen: cc.text.length }
      : { ok: false, ms: Date.now() - t1, error: cc.error, details: redact(cc.details ?? "") }
    return NextResponse.json({
      egress,
      envUrl,
      rawFetch: rawA, // (A)
      callClaude: ccOut, // (B)
    })
  }

  // SSRF-гард: только известные AI-эндпоинты (CF-гейт и наш Fly-прокси).
  const ALLOWED_HOSTS = ["gateway.ai.cloudflare.com", "webmon-ai-proxy.fly.dev"]

  let gatewayTest:
    | { status: number; ok: boolean; body: string; host: string; ms: number }
    | { skipped: string }
    | { error: string; ms?: number } = { skipped: "url не передан — только egress" }

  if (url) {
    let host = ""
    try {
      host = new URL(url).hostname
    } catch {
      return NextResponse.json({ egress, error: "url невалиден" }, { status: 400 })
    }
    if (!ALLOWED_HOSTS.includes(host)) {
      return NextResponse.json(
        { egress, error: `хост ${host} запрещён (только ${ALLOWED_HOSTS.join(", ")})` },
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
    // X-Proxy-Auth для Fly-прокси — из env (AI_PROXY_AUTH инжектится деплоем
    // через --secret), НЕ из тела запроса: токен не светится в переписке/history.
    const proxyAuth = process.env.AI_PROXY_AUTH
    if (proxyAuth) headers["X-Proxy-Auth"] = proxyAuth

    // long=true форсирует большой ответ (~60-90с) → проверяет idle-таймаут
    // прокси, а не только гео. 5 токенов вернулись бы за секунду = ложно-зелёно.
    const payload = long
      ? {
          model: process.env.AI_MODEL ?? "anthropic/claude-opus-4-7",
          max_tokens: 4000,
          messages: [
            {
              role: "user",
              content:
                "Напиши максимально подробное эссе не менее чем на 3000 слов " +
                "об истории и принципах веб-аналитики. Развёрнуто, без сокращений.",
            },
          ],
        }
      : {
          model: process.env.AI_MODEL ?? "anthropic/claude-opus-4-7",
          max_tokens: 5,
          messages: [{ role: "user", content: "ping" }],
        }

    const started = Date.now()
    try {
      const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) })
      const text = await r.text().catch(() => "")
      const ms = Date.now() - started
      gatewayTest = { status: r.status, ok: r.ok, body: redact(text), host, ms }
    } catch (e) {
      const ms = Date.now() - started
      gatewayTest = { error: `fetch failed: ${(e as Error).message}`, ms }
    }
  }

  return NextResponse.json({ egress, gatewayTest })
}
