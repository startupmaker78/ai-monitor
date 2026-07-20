import { record } from '@rrweb/record'

type RecordConfig = NonNullable<Parameters<typeof record>[0]>

export const recordConfig: Omit<RecordConfig, 'emit'> = {
  recordAfter: 'DOMContentLoaded',
  maskAllInputs: false,
  maskInputOptions: {
    password: true,
    email: true,
    tel: true,
    number: true,
  },
  blockSelector: '.wm-block, [data-wm-block]',
  maskTextSelector: '.wm-mask, [data-wm-mask]',
  ignoreSelector: '.wm-ignore, [data-wm-ignore]',
  sampling: {
    mousemove: 50,
    scroll: 150,
    input: 'last',
  },
  recordCanvas: false,
  // collectFonts: инлайним шрифты (base64) в снапшот. Внешние шрифты
  // сайта (напр. forma.tbank.ru на Tilda) при воспроизведении грузятся
  // медленно/флапают → плеер показывал fallback («шрифты поплыли»).
  // Инлайн ≈ +88 KB на FullSnapshot (влезает: 2.68→2.77 MB < 3 MiB cap).
  collectFonts: true,
  inlineImages: false,
  recordCrossOriginIframes: false,
  checkoutEveryNms: 5 * 60 * 1000,
}
