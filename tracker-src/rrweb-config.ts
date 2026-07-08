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
  collectFonts: false,
  inlineImages: false,
  recordCrossOriginIframes: false,
  checkoutEveryNms: 5 * 60 * 1000,
}
