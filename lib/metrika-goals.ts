import { normalizeUrl } from "@/lib/url-normalize"
import { getMinPageVisitsForConversion } from "@/lib/config"

// Цели Яндекс.Метрики + конверсия по целевому действию (Path M, Этап 2B).
//
// ⚠️ Маппинг HTTP-ошибок здесь НАМЕРЕННО ПРОДУБЛИРОВАН из lib/metrika-
// client.ts — НЕ объединять. Это разные заботы: metrika-client тянет
// ДНЕВНЫЕ МЕТРИКИ (stat bytime, 4 показателя), этот модуль — СПИСОК ЦЕЛЕЙ
// (management API) и КОНВЕРСИЮ по цели (stat data, метод B). Слияние в
// общий http-хелпер склеит два независимых контракта: первый же рефакторинг
// одного сломает другой. Дублирование ~15 строк < цена связности.
//
// БЕЗОПАСНОСТЬ ТОКЕНА: токен уходит ТОЛЬКО в заголовок Authorization.
// В URL его нет (id/metrics/filters), в лог/reason/detail — тоже. Ни один
// путь не кладёт токен в строку (проверено grep'ом, см. отчёт 2B).
//
// АТРИБУЦИЯ (Этап 0, гейт): метод B — визиты, где страница ОТКРЫВАЛАСЬ
// (filters=ym:pv:URLPathFull), метрика conversionRate (дедупл. визиты, НЕ
// reaches/visits). Формулировка наружу — «из открывавших страницу N% за
// визит». Остаточная неточность (цель могла сработать на другой странице
// визита) — см. DECISIONS 2026-07-28.

const MGMT_BASE = "https://api-metrika.yandex.net/management/v1/counter"
const STAT_BASE = "https://api-metrika.yandex.net/stat/v1/data"

const METRICS_PER_REQUEST = 20 // жёсткий лимит Метрики (подтверждён: 21 → HTTP 400)

// Длина пути, выше которой Метрика ОБРЕЗАЕт ym:pv:URLPathFull (~57 симв,
// эмпирика 2026-07-28). При exact-промахе на длинном пути пробуем glob по
// БЕЗОПАСНОМУ префиксу (ниже порога обрезки), чтобы не ловить обрезанный
// хвост. 45 < 57 с запасом; Tilda-slug уникален уже в первых ~17 символах
// (id вида ybya8n43e1), так что over-match сиблингов ничтожен.
const GLOB_SAFE_PREFIX_LEN = 45

// «Почти ноль» наших сессий для развода no_data / mismatch. 1–3 записанных
// сессии Метрика МОЖЕТ законно обнулить: наш трекер пишет с DOMContentLoaded,
// а Метрика инициализируется через setTimeout 2000 + consent-gated — визит
// короче ~2с мы поймали, Метрика нет. ≥4 наших сессий против нуля Метрики —
// это уже расхождение методик/матчинга, а не «визитов не было» → mismatch.
// (см. DECISIONS 2026-07-28 «Расхождение методик подсчёта».)
const NEAR_ZERO_SESSIONS = 3

export type MetrikaGoal = {
  id: string
  name: string
  type: string // "action" | "url" | "phone" | "social" | ... (as-is из Метрики)
  source: "user" | "auto"
  // Только для type==="url": условие цели (contain/exact/start/regexp + url).
  // Нужно для детерминированной оценки релевантности странице (0 вызовов).
  urlCondition?: { type: string; url: string }
  // Клиент отметил цель ключевой в Метрике (`is_favorite`=1). Сильнее любой
  // нашей эвристики релевантности → первый ярус сортировки.
  isFavorite: boolean
  // Метки цели (группировка в Метрике). Протянуто на будущее, пока не
  // используется. Форма элемента неизвестна (у academy labels пусты).
  labels?: unknown[]
}

// Релевантность цели странице (вариант C, 3 вызова, ОБЕ меры — viewed).
export type GoalRelevance = {
  total: number
  onPage: { reaches: number; pct: number }
  // Топ-страница (кроме текущей), где цель достигается чаще всего. null если
  // других страниц нет. label — читаемое имя для показа: название цели сайта,
  // если topOther совпал с её URL, иначе последний сегмент пути (заполняет
  // data-слой getGoalRelevance; lib оставляет undefined).
  topOther: { path: string; reaches: number; pct: number; label?: string } | null
}

export type ConversionErrorReason =
  | "auth_failed" // токен протух/недействителен
  | "counter_forbidden" // нет доступа к счётчику
  | "goal_deleted" // цель удалена в Метрике
  | "metrika_unavailable" // сеть/5xx/невалидный ответ
  | "rate_limited" // 420/429
  | "no_data" // у Метрики 0 визитов И у нас ~0 — честно нечего считать
  | "mismatch" // у нас N сессий, у Метрики 0 — НАШЕ расхождение, не факт о сайте

export type GoalConversion =
  | {
      ok: true
      conversionRate: number // %, дедупл. визиты (ym:s:goalXconversionRate)
      sampleVisits: number // знаменатель (визиты, открывавшие страницу)
      period: { from: string; to: string; widened: boolean }
      matchedBy: "exact" | "glob"
      lowConfidence: boolean // sampleVisits < порога даже после расширения
      source: "metrika"
    }
  | { ok: false; reason: ConversionErrorReason }

export type GoalsResult =
  | { ok: true; goals: MetrikaGoal[] }
  | { ok: false; reason: "auth_failed" | "counter_forbidden" | "rate_limited" | "metrika_unavailable" }

// ─── HTTP-хелпер (токен только в заголовке) ──────────────────────────────

type GetReason =
  | "auth_failed"
  | "counter_forbidden"
  | "not_found"
  | "rate_limited"
  | "bad_request"
  | "metrika_unavailable"

type GetResult =
  | { ok: true; json: unknown }
  | { ok: false; reason: GetReason; detail?: string }

async function metrikaGet(url: string, token: string): Promise<GetResult> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `OAuth ${token}`, Accept: "application/json" },
    })
  } catch (err) {
    // Сеть. err.message генерик, токен в него не попадает (он в заголовке,
    // url без токена). Логируем без url (в url нет токена, но и незачем).
    console.error(`[metrika-goals] network error: ${(err as Error).message}`)
    return { ok: false, reason: "metrika_unavailable" }
  }
  if (res.status === 401) return { ok: false, reason: "auth_failed" }
  if (res.status === 403) return { ok: false, reason: "counter_forbidden" }
  if (res.status === 404) return { ok: false, reason: "not_found" }
  if (res.status === 420 || res.status === 429) {
    return { ok: false, reason: "rate_limited" }
  }
  if (res.status === 400) {
    // 400 несёт причину в теле (error_type/message) — Метрика так сообщает
    // про несуществующую метрику (удалённая цель) и битый фильтр. Тело —
    // JSON Метрики, токена не содержит.
    let detail = ""
    try {
      const b = (await res.json()) as { errors?: Array<{ message?: string }>; message?: string }
      detail = b?.errors?.[0]?.message ?? b?.message ?? ""
    } catch {
      /* тело нечитаемо — оставляем пустой detail */
    }
    return { ok: false, reason: "bad_request", detail }
  }
  if (!res.ok) {
    console.error(`[metrika-goals] HTTP ${res.status}`)
    return { ok: false, reason: "metrika_unavailable" }
  }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, reason: "metrika_unavailable" }
  }
  return { ok: true, json }
}

// ─── Список целей ────────────────────────────────────────────────────────

export async function fetchMetrikaGoals(
  counterId: string,
  token: string,
): Promise<GoalsResult> {
  const url = `${MGMT_BASE}/${encodeURIComponent(counterId)}/goals`
  const r = await metrikaGet(url, token)
  if (!r.ok) {
    if (r.reason === "auth_failed") return { ok: false, reason: "auth_failed" }
    if (r.reason === "counter_forbidden" || r.reason === "not_found") {
      return { ok: false, reason: "counter_forbidden" }
    }
    if (r.reason === "rate_limited") return { ok: false, reason: "rate_limited" }
    return { ok: false, reason: "metrika_unavailable" }
  }
  const raw = (r.json as { goals?: unknown }).goals
  if (!Array.isArray(raw)) return { ok: false, reason: "metrika_unavailable" }
  const goals: MetrikaGoal[] = raw.map((g) => {
    const o = g as Record<string, unknown>
    const type = typeof o.type === "string" ? o.type : ""
    let urlCondition: MetrikaGoal["urlCondition"]
    if (type === "url" && Array.isArray(o.conditions) && o.conditions[0]) {
      const c = o.conditions[0] as Record<string, unknown>
      if (typeof c.type === "string" && typeof c.url === "string") {
        urlCondition = { type: c.type, url: c.url }
      }
    }
    return {
      id: String(o.id),
      name: typeof o.name === "string" ? o.name : "",
      type,
      source: o.goal_source === "user" ? "user" : "auto",
      urlCondition,
      isFavorite: o.is_favorite === 1 || o.is_favorite === true,
      labels: Array.isArray(o.labels) ? o.labels : undefined,
    }
  })
  return { ok: true, goals }
}

// ─── Достижения для сортировки (батчи ≤20 метрик) ────────────────────────

// Best-effort: сортировка косметическая. Провал батча → цели этого батча
// получают 0 (не роняем форму). Ошибки не пробрасываем.
export async function fetchGoalReaches(
  counterId: string,
  token: string,
  goalIds: string[],
  period: { from: string; to: string },
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let i = 0; i < goalIds.length; i += METRICS_PER_REQUEST) {
    const chunk = goalIds.slice(i, i + METRICS_PER_REQUEST)
    const metrics = chunk.map((id) => `ym:s:goal${id}reaches`).join(",")
    const url = statUrl({
      id: counterId,
      metrics,
      date1: period.from,
      date2: period.to,
      accuracy: "full",
    })
    const r = await metrikaGet(url, token)
    if (!r.ok) continue
    const totals = (r.json as { totals?: number[] }).totals
    chunk.forEach((id, idx) => out.set(id, totals?.[idx] ?? 0))
  }
  return out
}

// user наверх, отсортированы по достижениям убыв.; auto — отдельной
// (свёрнутой в UI) группой без сортировки.
export function sortAndGroupGoals(
  goals: MetrikaGoal[],
  reaches: Map<string, number>,
): { user: MetrikaGoal[]; auto: MetrikaGoal[] } {
  const user = goals
    .filter((g) => g.source === "user")
    .sort((a, b) => (reaches.get(b.id) ?? 0) - (reaches.get(a.id) ?? 0))
  const auto = goals.filter((g) => g.source === "auto")
  return { user, auto }
}

// ─── Конверсия по цели (метод B) ─────────────────────────────────────────

type PeriodResult =
  | { kind: "ok"; conversionRate: number; sampleVisits: number; matchedBy: "exact" | "glob" }
  | { kind: "zero_visits" }
  | { kind: "error"; reason: ConversionErrorReason }

export async function fetchGoalConversion(
  counterId: string,
  token: string,
  opts: {
    goalId: string
    targetUrl: string
    sessionWindowStart: Date
    ourSessionCount: number // передаётся caller'ом — lib в БД не лезет
  },
): Promise<GoalConversion> {
  const path = toPath(opts.targetUrl)
  if (path === null) {
    console.error(
      `[metrika-goals] cannot derive path from targetUrl (goalId=${opts.goalId})`,
    )
    return { ok: false, reason: "metrika_unavailable" }
  }

  const yesterday = fmtDate(addDays(startOfUtcDay(new Date()), -1))
  // date1 не позже вчера (если сессии только за сегодня — иначе date1>date2).
  const fromPrimary = minDate(fmtDate(startOfUtcDay(opts.sessionWindowStart)), yesterday)
  const threshold = getMinPageVisitsForConversion()

  // Первичный период: окно сбора → вчера.
  let attempt = await conversionForPeriod(counterId, token, opts.goalId, path, {
    from: fromPrimary,
    to: yesterday,
  })
  let period = { from: fromPrimary, to: yesterday, widened: false }

  // Расширение до trailing 90 дней, если выборка мала. Расширяем ТОЛЬКО из
  // ok с малой выборкой (не из zero_visits — там расширение не поможет
  // понять mismatch и смазало бы период) — а из zero_visits mismatch/no_data
  // решаем ниже по нашим сессиям.
  if (attempt.kind === "ok" && attempt.sampleVisits < threshold) {
    const wide = { from: "90daysAgo", to: yesterday }
    const w = await conversionForPeriod(counterId, token, opts.goalId, path, wide)
    if (w.kind === "ok") {
      attempt = w
      period = { from: wide.from, to: wide.to, widened: true }
    }
  }

  if (attempt.kind === "error") return { ok: false, reason: attempt.reason }

  if (attempt.kind === "zero_visits") {
    // У Метрики 0 визитов. Развод no_data / mismatch по НАШИМ сессиям.
    if (opts.ourSessionCount > NEAR_ZERO_SESSIONS) {
      // Мы записали визиты, Метрика их не видит → НАША проблема/расхождение.
      // Лог: оба числа + оба испробованных фильтра (единственная зацепка).
      console.error(
        `[metrika-goals] MISMATCH goalId=${opts.goalId} path="${path}" ` +
          `ourSessions=${opts.ourSessionCount} metrikaVisits=0 ` +
          `triedFilters=[exact:'ym:pv:URLPathFull==${JSON.stringify(path)}', ` +
          `glob:'ym:pv:URLPathFull=*${JSON.stringify(globPrefix(path) + "*")}'] ` +
          `period=${fromPrimary}..${yesterday}`,
      )
      return { ok: false, reason: "mismatch" }
    }
    return { ok: false, reason: "no_data" }
  }

  return {
    ok: true,
    conversionRate: attempt.conversionRate,
    sampleVisits: attempt.sampleVisits,
    period,
    matchedBy: attempt.matchedBy,
    lowConfidence: attempt.sampleVisits < threshold,
    source: "metrika",
  }
}

// Один период: exact-фильтр, при промахе на длинном пути — glob по префиксу.
async function conversionForPeriod(
  counterId: string,
  token: string,
  goalId: string,
  path: string,
  period: { from: string; to: string },
): Promise<PeriodResult> {
  // exact
  const exact = await visitsAndConversion(counterId, token, goalId, `ym:pv:URLPathFull=='${path}'`, period)
  if (exact.kind === "error") return exact
  if (exact.visits > 0) {
    return { kind: "ok", conversionRate: exact.rate, sampleVisits: exact.visits, matchedBy: "exact" }
  }
  // glob по безопасному префиксу — только если путь длинный (иначе glob
  // 'path*' ловил бы сиблингов вроде /kabinet → /kabinet-free).
  if (path.length > GLOB_SAFE_PREFIX_LEN) {
    const glob = await visitsAndConversion(
      counterId,
      token,
      goalId,
      `ym:pv:URLPathFull=*'${globPrefix(path)}*'`,
      period,
    )
    if (glob.kind === "error") return glob
    if (glob.visits > 0) {
      return { kind: "ok", conversionRate: glob.rate, sampleVisits: glob.visits, matchedBy: "glob" }
    }
  }
  return { kind: "zero_visits" }
}

type VisitsConv =
  | { kind: "ok"; visits: number; rate: number }
  | { kind: "error"; reason: ConversionErrorReason }

async function visitsAndConversion(
  counterId: string,
  token: string,
  goalId: string,
  filter: string,
  period: { from: string; to: string },
): Promise<VisitsConv> {
  const url = statUrl({
    id: counterId,
    metrics: `ym:s:visits,ym:s:goal${goalId}conversionRate`,
    filters: filter,
    date1: period.from,
    date2: period.to,
    accuracy: "full",
  })
  const r = await metrikaGet(url, token)
  if (!r.ok) return { kind: "error", reason: mapConversionReason(r) }
  const totals = (r.json as { totals?: number[] }).totals
  if (!Array.isArray(totals) || totals.length < 2) {
    return { kind: "error", reason: "metrika_unavailable" }
  }
  return { kind: "ok", visits: totals[0] ?? 0, rate: totals[1] ?? 0 }
}

// 400 от Метрики на метрике goalXconversionRate = цель удалена/не существует.
// Прочие 400 (напр. битый фильтр) → metrika_unavailable (не врём про цель).
function mapConversionReason(r: {
  reason: GetReason
  detail?: string
}): ConversionErrorReason {
  switch (r.reason) {
    case "auth_failed":
      return "auth_failed"
    case "counter_forbidden":
    case "not_found":
      return "counter_forbidden"
    case "rate_limited":
      return "rate_limited"
    case "bad_request":
      return /goal|invalid_parameter|metric/i.test(r.detail ?? "")
        ? "goal_deleted"
        : "metrika_unavailable"
    default:
      return "metrika_unavailable"
  }
}

// ─── Релевантность цели странице (вариант C, 3 вызова) ───────────────────

const RELEVANCE_PERIOD = { date1: "180daysAgo", date2: "yesterday" }

async function goalReaches(
  counterId: string,
  token: string,
  goalId: string,
  filter?: string,
): Promise<number> {
  const params: Record<string, string> = {
    id: counterId,
    metrics: `ym:s:goal${goalId}reaches`,
    accuracy: "full",
    ...RELEVANCE_PERIOD,
  }
  if (filter) params.filters = filter
  const r = await metrikaGet(statUrl(params), token)
  if (!r.ok) return 0
  const t = (r.json as { totals?: number[] }).totals
  return Array.isArray(t) ? (t[0] ?? 0) : 0
}

// Нормализация пути для сравнения «эта страница vs другая» (срез #/?, хвост-
// слэша, регистр). Root "/" сохраняем.
function normPath(p: string): string {
  const base = p.split("#")[0].split("?")[0].toLowerCase()
  return base.length > 1 && base.endsWith("/") ? base.slice(0, -1) : base
}

// 3 вызова: (1) распределение достижений по странице ВХОДА → total + топ-
// страница ≠ текущей; (2) достижения среди ОТКРЫВАВШИХ текущую страницу
// (viewed, truncation-safe); (3) то же для топ-другой страницы (её путь —
// значение Метрики → exact ==). onPage.pct и topOther.pct — обе viewed/total,
// сравнимы напрямую (вариант C: не смешиваем линзы).
export async function fetchGoalRelevance(
  counterId: string,
  token: string,
  goalId: string,
  pagePath: string,
): Promise<GoalRelevance | null> {
  // (1) entry-распределение.
  const r1 = await metrikaGet(
    statUrl({
      id: counterId,
      metrics: `ym:s:goal${goalId}reaches`,
      dimensions: "ym:s:startURLPathFull",
      accuracy: "full",
      limit: "15",
      sort: `-ym:s:goal${goalId}reaches`,
      ...RELEVANCE_PERIOD,
    }),
    token,
  )
  if (!r1.ok) return null
  const j1 = r1.json as {
    totals?: number[]
    data?: Array<{ dimensions: Array<{ name: string }>; metrics: number[] }>
  }
  const total = j1.totals?.[0] ?? 0
  if (total === 0) {
    return { total: 0, onPage: { reaches: 0, pct: 0 }, topOther: null }
  }

  // (2) onPage viewed — truncation-safe по длине (exact для короткого,
  // glob-префикс для длинного; без retry, чтобы удержать 3 вызова).
  const onPageFilter =
    pagePath.length > GLOB_SAFE_PREFIX_LEN
      ? `ym:pv:URLPathFull=*'${pagePath.slice(0, GLOB_SAFE_PREFIX_LEN)}*'`
      : `ym:pv:URLPathFull=='${pagePath}'`
  const onPageReaches = await goalReaches(counterId, token, goalId, onPageFilter)

  // Топ-страница входа, отличная от текущей.
  const otherRow = (j1.data ?? []).find(
    (row) => normPath(row.dimensions[0]?.name ?? "") !== normPath(pagePath),
  )
  let topOther: GoalRelevance["topOther"] = null
  if (otherRow) {
    const otherPath = otherRow.dimensions[0].name
    // (3) viewed на топ-другой (путь — значение Метрики → exact ==).
    const otherReaches = await goalReaches(
      counterId,
      token,
      goalId,
      `ym:pv:URLPathFull=='${otherPath}'`,
    )
    topOther = {
      path: otherPath,
      reaches: otherReaches,
      pct: Math.round((100 * otherReaches) / total),
    }
  }

  return {
    total,
    onPage: { reaches: onPageReaches, pct: Math.round((100 * onPageReaches) / total) },
    topOther,
  }
}

// ─── Список счётчиков токена (для дропдауна подключения Метрики) ──────────

export type MetrikaCounter = {
  id: string
  name: string
  domain: string // site2.domain ?? site
  permission: string // own | edit | view | guest_see (owner_login НЕ тянем)
  favorite: boolean
}

export type CountersResult =
  | { ok: true; counters: MetrikaCounter[] }
  | {
      ok: false
      reason: "auth_failed" | "counter_forbidden" | "rate_limited" | "metrika_unavailable"
    }

const COUNTERS_URL =
  "https://api-metrika.yandex.net/management/v1/counters?per_page=100"

// Счётчики, доступные токену. Для дропдауна вместо ручного ввода id (защита
// от тихого выбора чужого счётчика опечаткой). owner_login НЕ включаем (чужой
// логин Яндекса — лишние ПД в UI).
export async function fetchMetrikaCounters(token: string): Promise<CountersResult> {
  const r = await metrikaGet(COUNTERS_URL, token)
  if (!r.ok) {
    if (r.reason === "auth_failed") return { ok: false, reason: "auth_failed" }
    if (r.reason === "counter_forbidden" || r.reason === "not_found") {
      return { ok: false, reason: "counter_forbidden" }
    }
    if (r.reason === "rate_limited") return { ok: false, reason: "rate_limited" }
    return { ok: false, reason: "metrika_unavailable" }
  }
  const raw = (r.json as { counters?: unknown }).counters
  if (!Array.isArray(raw)) return { ok: false, reason: "metrika_unavailable" }
  const counters: MetrikaCounter[] = raw.map((c) => {
    const o = c as Record<string, unknown>
    const site2 = o.site2 as { domain?: unknown } | undefined
    const domain =
      typeof site2?.domain === "string"
        ? site2.domain
        : typeof o.site === "string"
          ? o.site
          : ""
    return {
      id: String(o.id),
      name: typeof o.name === "string" ? o.name : "",
      domain,
      permission: typeof o.permission === "string" ? o.permission : "",
      favorite: o.favorite === 1 || o.favorite === true,
    }
  })
  return { ok: true, counters }
}

// ─── helpers ─────────────────────────────────────────────────────────────

function statUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params)
  return `${STAT_BASE}?${qs.toString()}`
}

// URL цели → path (без host/query/hash) через общий normalizeUrl (тот же,
// что матчит сессии в should-record — единый источник).
function toPath(targetUrl: string): string | null {
  const n = normalizeUrl(targetUrl)
  if (!n) return null
  try {
    return new URL(n).pathname
  } catch {
    return null
  }
}

function globPrefix(path: string): string {
  return path.slice(0, GLOB_SAFE_PREFIX_LEN)
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000)
}
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}
function minDate(a: string, b: string): string {
  return a <= b ? a : b
}
