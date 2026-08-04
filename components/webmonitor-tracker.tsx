// TEST-инфра: наш собственный трекер на ПУБЛИЧНЫХ страницах staging (/,
// /login, /signup, /demo, /guide/metrika), чтобы получить свои сессии и
// проверить сбор вживую. НЕ ставится на дашборд: там наши собственные сессии +
// FullSnapshot интерфейса полетел бы в S3 и потенциально в промпт анализа —
// чувствительно и не нужно.
//
// data-token — SITE-TOKEN staging-сайта. Он ПУБЛИЧЕН по природе (лежит в HTML
// любого клиента, где стоит трекер), поэтому хардкод-константой — как counterId
// Метрики, БЕЗ Lockbox/deploy.yml.
//
// ВАЖНО: сам по себе скрипт сессий НЕ пишет — should-record пишет только на
// URL, совпавших с активной целью сайта (иначе no_target). На staging цель
// заводится вручную через UI «Страницы» на «/». На /login и /signup цели НЕ
// создаём принципиально (ввод учётных данных) — см. DECISIONS 2026-08-04.
const SITE_TOKEN = "391d4b88d1b74c9283f80953e93edfb7"
const TRACKER_SRC = "https://staging.xn--90abjntggcss.xn--p1ai/tracker.js"

export function WebmonitorTracker() {
  return <script async src={TRACKER_SRC} data-token={SITE_TOKEN} />
}
