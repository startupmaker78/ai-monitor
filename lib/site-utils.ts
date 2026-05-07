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
// быть в Punycode (xn--80aje0afkgi.xn--p1ai).
export function validateDomain(normalized: string): string {
  if (!/^[a-z0-9.-]+$/.test(normalized)) {
    throw new Error(
      "Домен должен содержать только латинские буквы, цифры, точки и дефисы",
    )
  }
  return normalized
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
