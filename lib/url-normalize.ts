// Единая нормализация URL для сопоставления с AnalysisTarget.url.
// Callsites:
//   - app/api/tracking/should-record/route.ts (input pageUrl → match)
//   - app/(dashboard)/dashboard/targets/actions.ts (дубль-URL check)
//
// Правила (совпадают с тем, что было в lib/analysis-target-matcher.ts
// до удаления matcher'а):
//   - strip query + hash
//   - strip "&param=..." из pathname (реферал-мусор без ведущего "?")
//   - lowercase host
//   - strip trailing slash (кроме root)
//
// Возвращает нормализованную строку, либо null для невалидных URL.
// Callers, для которых важен non-null (напр. duplicate-check), делают
// fallback на raw через `normalizeUrl(x) ?? x`.
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    u.search = ""
    u.hash = ""
    u.hostname = u.hostname.toLowerCase()
    let path = u.pathname
    // Срезаем "&param=..." из pathname. Яндекс/Дзен-рефералы дописывают
    // &search_source=…&search_domain=… БЕЗ ведущего "?", поэтому параметры
    // парсятся как часть пути (u.search пуст) и не режутся через search="".
    // Пример: /tpost/slug&search_source=yaru → /tpost/slug. Литеральный "&"
    // в легитимном пути/slug не встречается (Тильда-slug = [a-z0-9-/_];
    // настоящий "&" был бы %26 — здесь не тронут, indexOf ищет только
    // literal "&"). Делаем ДО trailing-slash, чтобы вскрытый слэш
    // (/path/&x → /path/ → /path) тоже схлопнулся.
    const ampIndex = path.indexOf("&")
    if (ampIndex !== -1) {
      path = path.slice(0, ampIndex)
    }
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1)
    }
    return `${u.protocol}//${u.host}${path}`
  } catch {
    return null
  }
}
