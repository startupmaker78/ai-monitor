import { domainToUnicode } from "node:url"

// Декодирование Punycode-домена в человекочитаемую форму для ПОКАЗА:
//   "staging.xn--90abjntggcss.xn--p1ai" → "staging.вебмонитор.рф"
//   "academy.nolim.cc" → "academy.nolim.cc" (ASCII не меняется)
// Server-only (node:url) — не импортировать в клиентские компоненты; декодируем
// на сервере, в клиент передаём готовую строку. Punycode оставляем только там,
// где технически нужен (например, base URL в коде трекера).
//
// Хост с портом (localhost:3001) domainToUnicode вернёт пустым — тогда фолбэк
// на исходную строку, чтобы ничего не потерять.
export function toUnicodeDomain(domain: string): string {
  try {
    return domainToUnicode(domain) || domain
  } catch {
    return domain
  }
}
