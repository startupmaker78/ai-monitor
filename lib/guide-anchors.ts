// Единый источник ссылок на гайд по Метрике. Используется точками входа
// (goal-select, targets-client, settings/metrika) и prebuild-проверкой
// (scripts/check-guide-anchors.ts). Не дублировать пути/слаги по компонентам.
//
// GUIDE_ANCHORS — слаги разделов гайда. Значения совпадают с id, которые
// rehype-slug проставляет заголовкам на странице (та же github-slugger).
// Если заголовок в .md переименуют — слаг исчезнет, prebuild-проверка упадёт
// и CI станет красным (а не ссылка молча уедет на верх). После переименования
// обнови соответствующее значение здесь под новый заголовок.

export const GUIDE_MD_PATH = "docs/metrika-goals-guide.md"

// Публичный роут (вне (dashboard), вне middleware-гейта) — открывается без
// логина, ссылку можно переслать владельцу счётчика.
export const GUIDE_METRIKA_PATH = "/guide/metrika"

export const GUIDE_ANCHORS = {
  // Раздел 1 «Какие цели раскрывают Вебмонитор полностью» — из дропдауна целей.
  types: "1-какие-цели-раскрывают-вебмонитор-полностью",
  // Раздел 3 «Как получить API-токен» — из пустого состояния (Метрика не
  // подключена) и из настроек Метрики.
  token: "3-как-получить-api-токен-для-подключения",
} as const

// Готовые href с якорем.
export const guideHref = (anchor?: keyof typeof GUIDE_ANCHORS): string =>
  anchor ? `${GUIDE_METRIKA_PATH}#${GUIDE_ANCHORS[anchor]}` : GUIDE_METRIKA_PATH
