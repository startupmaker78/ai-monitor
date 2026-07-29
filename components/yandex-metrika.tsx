// TEST-ONLY (разведка btn-целей): счётчик Яндекс.Метрики на ПУБЛИЧНЫХ
// страницах staging, чтобы завести btn-цель визуальным пикером Метрики и снять
// дамп её структуры из management API. Тестовая инфра на нашем же сайте, НЕ
// продуктовая фича. НЕ ставится на дашборд (там наши собственные юзеры).
//
// ID счётчика — НЕ секрет (открыт в HTML любого сайта со счётчиком; мы сами
// вытащили counterId academy обычным curl на Этапе 0), поэтому хардкод-
// константой, БЕЗ Lockbox/deploy.yml. env-override оставлен на случай смены без
// пересборки. Если Метрика на наших страницах станет постоянной — вынести id
// нормально.
//
// ⚠️ Runtime-рендер (серверный компонент), НЕ NEXT_PUBLIC_: `NEXT_PUBLIC_*`
// впекается в бандл на сборке; здесь id читается на запросе и инлайнится.
//
// Параметры init: webvisor/clickmap/ecommerce/trackLinks.
// ⚠️ `ssr:true` УБРАН НАМЕРЕННО — не возвращать. Он отключает авто-пейджвью с
// клиента (доказано контролируемым A/B: с флагом — 0 обращений к
// /watch/111140617, без него — 24), а серверных хитов приложение не шлёт.
// Метрика подставляет `ssr:true` в сгенерированный сниппет, но это
// предполагает SSR-интеграцию с РУЧНОЙ отправкой `ym('hit')`, которой у нас
// нет → с флагом визиты не считались вообще.
const YM_COUNTER_ID = process.env.YM_COUNTER_ID ?? "111140617"

export function YandexMetrika() {
  // Валидация: только цифры — иначе не интерполируем в inline-скрипт.
  if (!/^\d+$/.test(YM_COUNTER_ID)) return null
  return (
    <script
      dangerouslySetInnerHTML={{
        __html:
          `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};` +
          `m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,` +
          `k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script",` +
          `"https://mc.yandex.ru/metrika/tag.js","ym");` +
          `ym(${YM_COUNTER_ID}, "init", {webvisor:true, clickmap:true, ecommerce:"dataLayer", trackLinks:true});`,
      }}
    />
  )
}
