import type { AnalysisInput, SessionSummary } from "./analysis-prompt"

// Mock данные для сценария "плохая страница тарифов малого бизнеса".
// Используется в scripts/test-analysis-prompt.ts до того как rrweb-парсер
// будет готов в коммите 6.3.
//
// 15 сессий с разнообразными проблемами:
// - 9 mobile, 5 desktop, 1 tablet
// - rage clicks на disabled "Оформить заказ" (4 сессии)
// - брошенная форма обратной связи (5 сессий)
// - быстрый bounce на mobile (3 сессии < 15 сек)
// - длинное чтение без клика на CTA (2 desktop)
// - dead clicks на изображения (3 сессии)

const VIEWPORT_MOBILE = "375x812"
const VIEWPORT_TABLET = "768x1024"
const VIEWPORT_DESKTOP = "1440x900"

const SESSIONS: SessionSummary[] = [
  // 1-3: быстрый mobile bounce
  {
    duration: 8,
    deviceType: "mobile",
    viewport: VIEWPORT_MOBILE,
    scrollDepth: 0.18,
    clicks: [],
    formInteractions: [],
    rageClicks: [],
    deadClicks: 0,
    exitElement: "browser-back",
    errors: [],
  },
  {
    duration: 11,
    deviceType: "mobile",
    viewport: VIEWPORT_MOBILE,
    scrollDepth: 0.22,
    clicks: [],
    formInteractions: [],
    rageClicks: [],
    deadClicks: 0,
    exitElement: "browser-back",
    errors: [],
  },
  {
    duration: 13,
    deviceType: "mobile",
    viewport: VIEWPORT_MOBILE,
    scrollDepth: 0.31,
    clicks: [
      { selector: ".header-logo", text: "demo-shop", timeMs: 4200 },
    ],
    formInteractions: [],
    rageClicks: [],
    deadClicks: 0,
    exitElement: "browser-back",
    errors: [],
  },

  // 4-5: rage clicks на disabled "Оформить заказ" (mobile)
  {
    duration: 64,
    deviceType: "mobile",
    viewport: VIEWPORT_MOBILE,
    scrollDepth: 0.52,
    clicks: [
      { selector: ".plan-card.standard", text: "Стандарт", timeMs: 12400 },
    ],
    formInteractions: [],
    rageClicks: [
      {
        selector: "button.cta-order[disabled]",
        count: 5,
        timeMs: 28000,
      },
    ],
    deadClicks: 0,
    exitElement: "button.cta-order[disabled]",
    errors: [],
  },
  {
    duration: 48,
    deviceType: "mobile",
    viewport: VIEWPORT_MOBILE,
    scrollDepth: 0.46,
    clicks: [],
    formInteractions: [],
    rageClicks: [
      {
        selector: "button.cta-order[disabled]",
        count: 4,
        timeMs: 31000,
      },
    ],
    deadClicks: 0,
    exitElement: "button.cta-order[disabled]",
    errors: [],
  },

  // 6: dead clicks на картинку-баннер (mobile)
  {
    duration: 35,
    deviceType: "mobile",
    viewport: VIEWPORT_MOBILE,
    scrollDepth: 0.41,
    clicks: [],
    formInteractions: [],
    rageClicks: [],
    deadClicks: 3,
    exitElement: "img.feature-illustration",
    errors: [],
  },

  // 7-8: брошенная форма обратной связи (mobile)
  {
    duration: 92,
    deviceType: "mobile",
    viewport: VIEWPORT_MOBILE,
    scrollDepth: 0.61,
    clicks: [
      { selector: "a.contact-link", text: "Связаться", timeMs: 45000 },
    ],
    formInteractions: [
      { field: "input[name=email]", blurredEmpty: false },
      { field: "input[name=phone]", blurredEmpty: true },
      { field: "textarea[name=message]", blurredEmpty: true },
    ],
    rageClicks: [],
    deadClicks: 0,
    exitElement: "form.contact-form",
    errors: [],
  },
  {
    duration: 78,
    deviceType: "mobile",
    viewport: VIEWPORT_MOBILE,
    scrollDepth: 0.55,
    clicks: [],
    formInteractions: [
      { field: "input[name=name]", blurredEmpty: false },
      { field: "input[name=email]", blurredEmpty: true },
    ],
    rageClicks: [
      {
        selector: "button.cta-order[disabled]",
        count: 3,
        timeMs: 22000,
      },
    ],
    deadClicks: 0,
    exitElement: "form.contact-form",
    errors: [],
  },

  // 9: mobile dead click на инфографику
  {
    duration: 27,
    deviceType: "mobile",
    viewport: VIEWPORT_MOBILE,
    scrollDepth: 0.5,
    clicks: [],
    formInteractions: [],
    rageClicks: [],
    deadClicks: 2,
    exitElement: "img.pricing-comparison-chart",
    errors: [],
  },

  // 10-11: desktop, длинное чтение без клика на CTA
  {
    duration: 124,
    deviceType: "desktop",
    viewport: VIEWPORT_DESKTOP,
    scrollDepth: 0.85,
    clicks: [
      { selector: "a.faq-link", text: "Частые вопросы", timeMs: 60000 },
      { selector: ".plan-card.pro", text: "Профи", timeMs: 91000 },
    ],
    formInteractions: [
      { field: "input[name=email]", blurredEmpty: true },
    ],
    rageClicks: [],
    deadClicks: 0,
    exitElement: "footer.site-footer",
    errors: [],
  },
  {
    duration: 148,
    deviceType: "desktop",
    viewport: VIEWPORT_DESKTOP,
    scrollDepth: 0.92,
    clicks: [
      { selector: "a.faq-link", text: "Частые вопросы", timeMs: 50000 },
    ],
    formInteractions: [],
    rageClicks: [],
    deadClicks: 0,
    exitElement: "tab-close",
    errors: [],
  },

  // 12-13: desktop, брошенная форма / rage click
  {
    duration: 82,
    deviceType: "desktop",
    viewport: VIEWPORT_DESKTOP,
    scrollDepth: 0.7,
    clicks: [
      { selector: ".plan-card.standard", text: "Стандарт", timeMs: 18000 },
    ],
    formInteractions: [
      { field: "input[name=company]", blurredEmpty: false },
      { field: "input[name=email]", blurredEmpty: true },
      { field: "input[name=phone]", blurredEmpty: true },
    ],
    rageClicks: [],
    deadClicks: 0,
    exitElement: "form.contact-form",
    errors: [],
  },
  {
    duration: 56,
    deviceType: "desktop",
    viewport: VIEWPORT_DESKTOP,
    scrollDepth: 0.6,
    clicks: [
      { selector: ".plan-card.basic", text: "Базовый", timeMs: 12000 },
    ],
    formInteractions: [],
    rageClicks: [
      {
        selector: "button.cta-order[disabled]",
        count: 4,
        timeMs: 28000,
      },
    ],
    deadClicks: 0,
    exitElement: "button.cta-order[disabled]",
    errors: [],
  },

  // 14: desktop, dead click + abandon
  {
    duration: 41,
    deviceType: "desktop",
    viewport: VIEWPORT_DESKTOP,
    scrollDepth: 0.55,
    clicks: [],
    formInteractions: [
      { field: "input[name=email]", blurredEmpty: true },
    ],
    rageClicks: [],
    deadClicks: 2,
    exitElement: "form.contact-form",
    errors: [],
  },

  // 15: tablet
  {
    duration: 95,
    deviceType: "tablet",
    viewport: VIEWPORT_TABLET,
    scrollDepth: 0.72,
    clicks: [
      { selector: ".plan-card.pro", text: "Профи", timeMs: 38000 },
    ],
    formInteractions: [
      { field: "input[name=email]", blurredEmpty: false },
      { field: "input[name=company]", blurredEmpty: true },
    ],
    rageClicks: [],
    deadClicks: 0,
    exitElement: "form.contact-form",
    errors: [],
  },
]

export function buildMockAnalysisInput(): AnalysisInput {
  return {
    target: {
      url: "https://demo-shop.ru/pricing",
      name: "Страница тарифов",
    },
    site: {
      domain: "demo-shop.ru",
      isDemo: false,
    },
    metrics: {
      visits: 1250,
      uniqueVisitors: 950,
      bounceRate: 67.3,
      avgSessionDuration: 42,
    },
    sessionsCount: SESSIONS.length,
    sessionSummaries: SESSIONS,
  }
}
