const METRIKA_API_BASE = "https://api-metrika.yandex.net/stat/v1/data/bytime"

const METRICS = [
  "ym:s:visits",
  "ym:s:users",
  "ym:s:bounceRate",
  "ym:s:avgVisitDurationSeconds",
] as const

// Структура одного снапшота — то что мы будем upsert'ить.
export type MetrikaDailySnapshot = {
  date: Date // нормализована к 00:00:00 UTC
  visits: number
  uniqueVisitors: number
  bounceRate: number // 0-100 %
  avgSessionDuration: number // секунды, целые
  // conversions: 0 на MVP (пока не парсим goals)
  // goals: {} на MVP
}

export type MetrikaFetchResult =
  | { ok: true; snapshots: MetrikaDailySnapshot[] }
  | {
      ok: false
      error:
        | "auth_failed"
        | "counter_forbidden"
        | "counter_not_found"
        | "network_error"
        | "invalid_response"
      details?: string
    }

// Загружает метрики за последние 30 дней (date1=30daysAgo, date2=yesterday).
// Не сегодняшний день — данные за сегодня неполные, Метрика их обновляет
// в реальном времени; берём только закрытые сутки.
export async function fetchMetrikaDaily(
  counterId: string,
  oauthToken: string,
): Promise<MetrikaFetchResult> {
  const params = new URLSearchParams({
    id: counterId,
    metrics: METRICS.join(","),
    date1: "30daysAgo",
    date2: "yesterday",
    group: "day",
    accuracy: "full",
  })

  const url = `${METRIKA_API_BASE}?${params.toString()}`

  let response: Response
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `OAuth ${oauthToken}`,
        Accept: "application/json",
      },
    })
  } catch (err) {
    return {
      ok: false,
      error: "network_error",
      details: (err as Error).message,
    }
  }

  // 401 и 403 РАЗДЕЛЕНЫ (иначе «нет доступа к счётчику» показывалось бы как
  // «токен недействителен» — юзер зря перевыпускал бы рабочий токен). Как в
  // пути целей (lib/metrika-goals.ts).
  if (response.status === 401) {
    return { ok: false, error: "auth_failed" }
  }
  if (response.status === 403) {
    return { ok: false, error: "counter_forbidden" }
  }
  if (response.status === 404) {
    return { ok: false, error: "counter_not_found" }
  }
  if (!response.ok) {
    return {
      ok: false,
      error: "network_error",
      details: `HTTP ${response.status}`,
    }
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    return { ok: false, error: "invalid_response", details: "not json" }
  }

  return parseMetrikaResponse(json)
}

// Внутренний парсер ответа Метрики. Не экспортируем — тестируется через
// fetchMetrikaDaily с моком global.fetch (см. scripts/test-metrika-parser.ts).
function parseMetrikaResponse(json: unknown): MetrikaFetchResult {
  // Структура:
  // { data: [{ metrics: [[v1,v2,...], [u1,u2,...], [b1,b2,...], [d1,d2,...]] }],
  //   time_intervals: [["YYYY-MM-DD","YYYY-MM-DD"], ...] }
  if (typeof json !== "object" || json === null) {
    return { ok: false, error: "invalid_response", details: "not object" }
  }
  const obj = json as Record<string, unknown>

  if (!Array.isArray(obj.data) || obj.data.length === 0) {
    return {
      ok: false,
      error: "invalid_response",
      details: "missing data array",
    }
  }
  if (!Array.isArray(obj.time_intervals)) {
    return {
      ok: false,
      error: "invalid_response",
      details: "missing time_intervals",
    }
  }

  const firstRow = obj.data[0] as Record<string, unknown>
  if (!Array.isArray(firstRow.metrics) || firstRow.metrics.length < 4) {
    return {
      ok: false,
      error: "invalid_response",
      details: "expected 4 metric arrays",
    }
  }

  const [visitsArr, usersArr, bounceRateArr, durationArr] =
    firstRow.metrics as number[][]
  const intervals = obj.time_intervals as string[][]

  if (
    visitsArr.length !== intervals.length ||
    usersArr.length !== intervals.length ||
    bounceRateArr.length !== intervals.length ||
    durationArr.length !== intervals.length
  ) {
    return {
      ok: false,
      error: "invalid_response",
      details: "metric/interval length mismatch",
    }
  }

  const snapshots: MetrikaDailySnapshot[] = []
  for (let i = 0; i < intervals.length; i++) {
    const dateStr = intervals[i][0] // "YYYY-MM-DD"
    const date = new Date(`${dateStr}T00:00:00Z`)
    if (isNaN(date.getTime())) {
      return {
        ok: false,
        error: "invalid_response",
        details: `bad date: ${dateStr}`,
      }
    }
    snapshots.push({
      date,
      visits: Math.round(visitsArr[i] ?? 0),
      uniqueVisitors: Math.round(usersArr[i] ?? 0),
      bounceRate: Number(bounceRateArr[i] ?? 0),
      avgSessionDuration: Math.round(durationArr[i] ?? 0),
    })
  }

  return { ok: true, snapshots }
}
