import { JSDOM } from 'jsdom'

// PII-masking smoke test for tracker-src/rrweb-config.ts.
//
// We mount a minimal DOM with one <input> per relevant type, start rrweb
// with the same `recordConfig` the production tracker uses, dispatch synthetic
// `input` events, and verify that rrweb emits masked values for the types we
// configured in maskInputOptions (password, email, tel, number) and plaintext
// for everything else.
//
// jsdom is the right tool here because masking is a pure rrweb-library
// behaviour (string transformation by element type), not a bundling or network
// concern. A real browser via playwright would just add startup cost.

async function main() {
  const html =
    '<!DOCTYPE html><html><body>' +
    '<input type="text" id="i-text" />' +
    '<input type="email" id="i-email" />' +
    '<input type="password" id="i-pass" />' +
    '<input type="tel" id="i-tel" />' +
    '<input type="number" id="i-num" />' +
    '</body></html>'

  const dom = new JSDOM(html, { url: 'http://localhost' })
  const win = dom.window
  const doc = win.document

  // Wire jsdom globals so rrweb's internals (rrweb-snapshot, MutationBuffer,
  // event listeners) find a real Window/Document/Element/Node universe.
  //
  // IMPORTANT: do NOT .bind() class constructors here — Function.prototype.bind
  // strips the .prototype property, which breaks rrweb's getUntaintedPrototype
  // lookup (it does `globalThis[key].prototype`). Only bind functions that
  // genuinely need `this === window`.
  const CLASSES_AND_PROPS = [
    'Node', 'NodeFilter', 'Element', 'HTMLElement',
    'HTMLInputElement', 'HTMLAnchorElement', 'HTMLFormElement',
    'HTMLCanvasElement', 'HTMLImageElement', 'HTMLMediaElement',
    'HTMLIFrameElement', 'HTMLLinkElement', 'HTMLStyleElement',
    'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLOptionElement',
    'ShadowRoot', 'MutationObserver',
    'Event', 'CustomEvent', 'MouseEvent', 'InputEvent',
  ] as const

  const g = globalThis as unknown as Record<string, unknown>
  const winRecord = win as unknown as Record<string, unknown>
  for (const k of CLASSES_AND_PROPS) {
    const v = winRecord[k]
    if (v !== undefined) g[k] = v
  }
  g.window = win
  g.document = doc

  // Window-bound functions: keep `this === win` via explicit bind.
  const winRaf = (win as unknown as { requestAnimationFrame?: (cb: FrameRequestCallback) => number }).requestAnimationFrame
  const winCaf = (win as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame
  g.requestAnimationFrame = winRaf
    ? winRaf.bind(win)
    : ((cb: FrameRequestCallback): number =>
        setTimeout(() => cb(Date.now()), 16) as unknown as number)
  g.cancelAnimationFrame = winCaf
    ? winCaf.bind(win)
    : ((id: number): void => {
        clearTimeout(id as unknown as ReturnType<typeof setTimeout>)
      })
  g.getComputedStyle = win.getComputedStyle.bind(win)

  // Dynamic imports — must happen AFTER globals are wired, because rrweb
  // touches Element/Node prototypes at module load time.
  const { record } = await import('@rrweb/record')
  const { recordConfig } = await import('../tracker-src/rrweb-config')

  type RREvent = {
    type: number
    data?: { source?: number; id?: number; text?: string }
  }

  const events: RREvent[] = []
  const stop = record({
    ...recordConfig,
    emit(e) {
      events.push(e as unknown as RREvent)
    },
  })

  if (!stop) {
    console.error('❌ rrweb record() returned undefined; recording did not start')
    process.exit(1)
  }

  // Let initial snapshot settle.
  await new Promise((r) => setTimeout(r, 100))

  type InputCase = {
    type: string
    id: string
    value: string
    expectedMasked: boolean
  }

  const cases: InputCase[] = [
    { type: 'text',     id: 'i-text',  value: 'SECRET42', expectedMasked: false },
    { type: 'email',    id: 'i-email', value: 'SECRET42', expectedMasked: true },
    { type: 'password', id: 'i-pass',  value: 'SECRET42', expectedMasked: true },
    { type: 'tel',      id: 'i-tel',   value: 'SECRET42', expectedMasked: true },
    { type: 'number',   id: 'i-num',   value: '12345',    expectedMasked: true },
  ]

  for (const c of cases) {
    const el = doc.getElementById(c.id) as HTMLInputElement | null
    if (!el) {
      console.error(`❌ #${c.id} not found in test DOM`)
      process.exit(1)
    }
    el.value = c.value
    el.dispatchEvent(new win.Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 10))
  }

  await new Promise((r) => setTimeout(r, 100))
  stop()

  // type=3 IncrementalSnapshot, source=5 Input
  const inputEvents = events.filter(
    (e) => e.type === 3 && e.data?.source === 5,
  )

  // record.mirror maps DOM node ↔ recorded id
  const mirror = (record as unknown as {
    mirror: { getId(node: Node): number }
  }).mirror

  type Row = {
    type: string
    entered: string
    recorded: string
    masked: boolean
    expectedMasked: boolean
    pass: boolean
  }

  const rows: Row[] = []
  for (const c of cases) {
    const el = doc.getElementById(c.id) as HTMLInputElement
    const nodeId = mirror.getId(el as unknown as Node)
    const ev = [...inputEvents].reverse().find((e) => e.data?.id === nodeId)
    const recorded = ev?.data?.text ?? '(no event)'
    const masked = recorded !== c.value && recorded.length > 0 && recorded !== '(no event)'
    rows.push({
      type: c.type,
      entered: c.value,
      recorded,
      masked,
      expectedMasked: c.expectedMasked,
      pass: masked === c.expectedMasked,
    })
  }

  // Render table.
  const headers = ['input type', 'value entered', 'recorded text', 'masked?', 'expected', 'pass']
  const widths = [10, 13, 13, 7, 8, 4]
  const fmtRow = (cols: string[]): string =>
    '| ' + cols.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |'
  const sep = (): string =>
    '|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|'

  console.log(fmtRow(headers))
  console.log(sep())
  for (const r of rows) {
    console.log(
      fmtRow([
        r.type,
        r.entered,
        r.recorded,
        r.masked ? 'YES' : 'NO',
        r.expectedMasked ? 'mask' : 'plain',
        r.pass ? '✓' : '✗',
      ]),
    )
  }

  // Verdict — fail loud if a sensitive field leaked plaintext.
  const leaked = rows.filter((r) => r.expectedMasked && !r.masked)
  if (leaked.length > 0) {
    console.error(
      `\n❌ PII leak: ${leaked.map((r) => r.type).join(', ')} ` +
        `recorded plaintext value`,
    )
    process.exit(1)
  }

  const overMasked = rows.filter((r) => !r.expectedMasked && r.masked)
  if (overMasked.length > 0) {
    console.error(
      `\n❌ Unexpected masking on: ${overMasked.map((r) => r.type).join(', ')}`,
    )
    process.exit(1)
  }

  console.log('\n✅ PII masking matches tracker-src/rrweb-config.ts')
}

main().catch((err) => {
  console.error(`❌ ${(err as Error).message}`)
  console.error((err as Error).stack)
  process.exit(1)
})
