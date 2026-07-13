import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, withDbRetry, isTransientDbError } from "@/lib/prisma"
import { normalizeUrl } from "@/lib/url-normalize"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Динамический CORS: reflect Origin + Access-Control-Allow-Credentials,
// если Origin передан (нужно для совместимости с sendBeacon, который
// шлёт credentials:'include' безусловно — см. collect route). Wildcard
// как fallback для server-to-server / curl запросов.
function corsHeaders(origin: string | null): Record<string, string> {
  if (origin) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    }
  }
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  }
}

// no-store: target может появиться/архивироваться в моменте, и любой
// кеш создаст «сессия не пишется N секунд после создания цели» — плохой
// UX для юзера, только что подключившего target. Один запрос на
// pageload дёшев, кешировать нет смысла.
const NO_CACHE_HEADERS = { "Cache-Control": "no-store" } as const

function corsResponse(
  body: unknown,
  origin: string | null,
  init: ResponseInit = {},
): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...corsHeaders(origin),
      ...NO_CACHE_HEADERS,
      ...init.headers,
    },
  })
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  })
}

const querySchema = z.object({
  token: z.string().min(1).max(200),
  url: z.string().min(1).max(2048),
})

// withDbRetry / isTransientDbError — общий хелпер из lib/prisma.ts
// (транзиентный retry на stale pg-соединении, 1 повтор). Раньше здесь
// был локальный дубль 1-в-1, вынесен в общий модуль.

// User-Agent маркеры ботов/краулеров/headless (case-insensitive). Боты
// грузят страницу, трекер стартует и пишет пустые/статичные сессии с
// cron-раздутыми длительностями (Googlebot/AhrefsBot/YandexBot уже
// намусорили на academy). Отсекаем на входе → трекер не стартует.
//
// `bot\/` ловит семейство "Name Bot/version" (Googlebot/2.1,
// AhrefsBot/7.0, YandexBot/3.0, bingbot/2.0, SemrushBot/…) НЕ задевая
// бренды с "bot" без слэша (напр. Android-телефоны CUBOT). `\bbot\b`
// ловит редкое standalone-"bot". Плюс специфичные имена и generic
// crawl/spider/slurp. Ни один реальный браузер (Chrome/Safari/Firefox/
// Edge на Win/Mac/iOS/Android) ни один из токенов не содержит.
const BOT_UA_PATTERN =
  /bot\/|\bbot\b|crawl|spider|slurp|googlebot|ahrefsbot|yandexbot|bingbot|duckduckbot|baiduspider|facebookexternalhit|ia_archiver|semrush|mj12bot|dotbot|petalbot|bytespider|gptbot|ccbot|applebot|headless|phantomjs|puppeteer|playwright|python-requests|node-fetch|go-http-client|okhttp|scrapy|lighthouse|pingdom|uptimerobot|\bcurl\b|\bwget\b/i

function isBotUserAgent(ua: string | null): boolean {
  // Легитимный трекер всегда за браузером → UA присутствует. Пустой /
  // отсутствующий UA = не-браузерный клиент (сканер/скрипт) → bot-like:
  // реальный Chrome/Safari/Firefox всегда шлёт непустой User-Agent.
  if (!ua || ua.trim() === "") return true
  return BOT_UA_PATTERN.test(ua)
}

// Единая observability-строка на КАЖДЫЙ исход should-record. Снимает
// диагностическую слепоту: раньше молчали record:true/no_target/budget,
// нельзя было посчитать распределение URL и причины отказов (сверка с
// Метрикой требовала гадания). Формат парсимый:
//   [should-record] url=<normalized> reason=<...> matched=<targetId|->
// url — уже query-stripped (normalizeUrl убрал query/hash) → приватно,
// site-token НЕ логируется. reason — outcome-код. matched — цель или "-".
//
// Объём: трекер site-wide → 1 вызов на pageload. Текущий трафик academy
// ~сотни вызовов/день → ~десятки KB/день логов, копейки. При крупном
// росте (10k+/день) — рассмотреть сэмплирование массового no_target;
// пока полная видимость важнее (именно no_target-URL показывают, какие
// страницы стоит добавить в цели).
function logOutcome(
  reason: string,
  normalizedUrl: string | null,
  matchedTargetId: string | null,
): void {
  console.log(
    "[should-record] url=" +
      (normalizedUrl ?? "-") +
      " reason=" +
      reason +
      " matched=" +
      (matchedTargetId ?? "-"),
  )
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin")

  // Фильтр ботов — РАНЬШЕ любых обращений к БД (site.findUnique /
  // target.findMany): для бота незачем ходить в базу, ранний выход
  // заодно снижает bot-нагрузку на PG. Отказ легитимный — HTTP 200 +
  // CORS с record:false (как budget_exhausted/no_target), НЕ ошибка;
  // трекер fail-closed → сессия не создаётся.
  const ua = req.headers.get("user-agent")
  if (isBotUserAgent(ua)) {
    // Bot-проверка до парсинга url → нормализованного url ещё нет;
    // логируем reason=bot + обрезанный UA (для аудита какие боты режем).
    console.log(
      "[should-record] url=- reason=bot matched=- ua=" +
        (ua ? ua.slice(0, 80) : "<empty>"),
    )
    return corsResponse({ record: false, reason: "bot" }, origin)
  }

  const parsed = querySchema.safeParse({
    token: req.nextUrl.searchParams.get("token"),
    url: req.nextUrl.searchParams.get("url"),
  })
  if (!parsed.success) {
    logOutcome("bad_request", null, null)
    return corsResponse(
      { record: false, reason: "bad_request" },
      origin,
      { status: 400 },
    )
  }

  const normalized = normalizeUrl(parsed.data.url)
  if (!normalized) {
    logOutcome("invalid_url", null, null)
    return corsResponse(
      { record: false, reason: "invalid_url" },
      origin,
      { status: 400 },
    )
  }

  const tokenTail = parsed.data.token.slice(-4)

  let site: { id: string } | null
  let targets: Array<{
    id: string
    url: string
    sessionsBudget: number
    sessionsCollected: number
  }>
  try {
    site = await withDbRetry(() =>
      prisma.site.findUnique({
        where: { trackingToken: parsed.data.token },
        select: { id: true },
      }),
    )
    if (!site) {
      logOutcome("unknown_site", normalized, null)
      return corsResponse(
        { record: false, reason: "unknown_site" },
        origin,
        { status: 404 },
      )
    }

    // ACTIVE и READY — оба продолжают собирать сессии.
    // ANALYZING/COMPLETED — цель закрыта для новых сессий в этом периоде.
    // archivedAt=null — юзер не удалил цель.
    targets = await withDbRetry(() =>
      prisma.analysisTarget.findMany({
        where: {
          siteId: site!.id,
          archivedAt: null,
          status: { in: ["ACTIVE", "READY"] },
        },
        select: {
          id: true,
          url: true,
          sessionsBudget: true,
          sessionsCollected: true,
        },
        // Defensive: если каким-то образом просочилось несколько ACTIVE
        // target'ов с одним normalized URL (actions.ts блокирует дубли на
        // create — этот путь не должен срабатывать в норме), берём старейший.
        orderBy: { createdAt: "asc" },
      }),
    )
  } catch (err) {
    const e = err as Error
    const transient = isTransientDbError(err)
    console.error(
      "[should-record] DB " +
        (transient ? "retry exhausted" : "error") +
        " tokenTail=..." + tokenTail +
        " err=" + e.name + ":" + e.message,
    )
    // + унифицированная outcome-строка для полного reason-подсчёта
    // (детальный error-лог выше остаётся для диагностики).
    logOutcome("db_unavailable", normalized, null)
    // 503 (не 500, не 200): транзиентный DB-сбой, клиент увидит fail-
    // closed через network_error path и сможет перезагрузить страницу
    // после того как pool оживёт. Не проглатываем как record:false —
    // иначе замаскируем осмысленные отказы (no_target/budget_exhausted).
    return corsResponse(
      { record: false, reason: "db_unavailable" },
      origin,
      { status: 503 },
    )
  }

  let matched: (typeof targets)[number] | null = null
  for (const t of targets) {
    const tn = normalizeUrl(t.url)
    if (tn && tn === normalized) {
      matched = t
      break
    }
  }

  if (!matched) {
    logOutcome("no_target", normalized, null)
    return corsResponse({ record: false, reason: "no_target" }, origin)
  }

  if (matched.sessionsCollected >= matched.sessionsBudget) {
    logOutcome("budget_exhausted", normalized, matched.id)
    return corsResponse(
      { record: false, reason: "budget_exhausted" },
      origin,
    )
  }

  logOutcome("record", normalized, matched.id)
  return corsResponse({ record: true, targetId: matched.id }, origin)
}
