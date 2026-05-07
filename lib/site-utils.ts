// Нормализация пользовательского ввода домена в каноническую форму:
// удаляем протокол, www, путь и query — остаётся чистый host.
//   "Https://www.NoLim.cc/about?ref=x" → "nolim.cc"
//   "  example.com/  "                  → "example.com"
//   "https://"                          → ""  (caller обязан проверять)
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0]
}

// HTML-snippet для вставки на сайт юзера. Загружает tracker.js с нашего
// origin'а и передаёт trackingToken как query.
//
// TODO: вынести base URL в NEXT_PUBLIC_APP_URL env var (сейчас захардкожен
// staging — на production надо заменить).
export function buildTrackerSnippet(trackingToken: string): string {
  const baseUrl = "https://staging.вебмонитор.рф"
  return `<script async src="${baseUrl}/tracker.js?token=${trackingToken}"></script>`
}
