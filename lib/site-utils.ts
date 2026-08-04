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

// Валидация что домен содержит только ASCII-символы, разрешённые в hostnames.
// Защита от ловушек вроде кириллической `с` (U+0441) которая визуально
// идентична латинской `c` (U+0063). Throw'ит при первом несоответствии.
// Возвращает входную строку — удобно для fluent-стиля.
//
// Допустимы: a-z, 0-9, точка, дефис.
// IDN (xn--*) — пройдёт, потому что Punycode = ASCII.
// Сами кириллические домены (вебмонитор.рф) ввести нельзя — вход должен
// быть в Punycode (xn--90abjntggcss.xn--p1ai).
export function validateDomain(normalized: string): string {
  if (!/^[a-z0-9.-]+$/.test(normalized)) {
    throw new Error(
      "Домен должен содержать только латинские буквы, цифры, точки и дефисы",
    )
  }
  return normalized
}

// Совпадает ли хост URL страницы с доменом сайта. Правило: точное совпадение
// ИЛИ поддомен (blog.site.ru для сайта site.ru). Родительский домен и чужие —
// нет. Punycode: new URL().hostname отдаёт ASCII/punycode для IDN (кириллица
// «вебмонитор.рф» → «xn--…»), а site.domain хранится в punycode (validateDomain
// требует ASCII) → сравнение обеих сторон в punycode корректно. www срезаем.
export function urlHostMatchesSite(url: string, siteDomain: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return false
  }
  const site = siteDomain.toLowerCase().replace(/^www\./, "")
  if (!site) return false
  return host === site || host.endsWith("." + site)
}

// HTML-snippet для вставки на сайт юзера. Загружает tracker.js с нашего
// origin'а и передаёт trackingToken через data-token АТРИБУТ (не query):
// так бандл грузится как `GET /tracker.js` без query → токен не течёт в
// платформенный access-лог. Трекер читает его из data-token (fallback
// на ?token= для старых embed'ов). См. DECISIONS 2026-07-13 «Утечка
// site-token».
//
// TODO: вынести base URL в NEXT_PUBLIC_APP_URL env var (сейчас захардкожен
// staging — на production надо заменить).
export function buildTrackerSnippet(trackingToken: string): string {
  const baseUrl = "https://staging.xn--90abjntggcss.xn--p1ai"
  return `<script async src="${baseUrl}/tracker.js" data-token="${trackingToken}"></script>`
}
