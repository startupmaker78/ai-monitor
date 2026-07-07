// Единая нормализация URL для сопоставления с AnalysisTarget.url.
// Callsites:
//   - app/api/tracking/should-record/route.ts (input pageUrl → match)
//   - app/(dashboard)/dashboard/targets/actions.ts (дубль-URL check)
//
// Правила (совпадают с тем, что было в lib/analysis-target-matcher.ts
// до удаления matcher'а):
//   - strip query + hash
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
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1)
    }
    return `${u.protocol}//${u.host}${path}`
  } catch {
    return null
  }
}
