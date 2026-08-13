import { prisma } from "@/lib/prisma"
import { listKeys, getJson } from "@/lib/storage"
import type { SessionSummary } from "@/lib/analysis-prompt"
import { classifyDeviceByUA } from "@/lib/device"

// Потолок сессий на анализ. 2026-05-07 поставили 50 как MVP-страховку, без
// замера. 2026-08-13 замерили — страховка была не там:
//   • контекст модели НЕ мешает: при 90 сессиях промпт ~43 тыс. входных
//     токенов, это 4% окна Opus (1M);
//   • память НЕ мешает: summary весит 274 байта на сессию (13,7 КБ на 50),
//     а пик потребления вообще не зависит от объёма — сырые пакеты держатся
//     в памяти только у SESSION_CONCURRENCY=10 сессий разом, потолок ~60 МБ
//     при 512 МБ контейнера;
//   • деньги НЕ мешают: ~20 ₽ за анализ на 90 сессиях против маржи тарифа.
// Упирается всё во ВРЕМЯ, и потолки идут так (оценка по регрессии
// «сек ≈ 42,3 + 2,5 × тыс. входных токенов», 12 боевых анализов):
//   ~90 сессий  → ~150 с — клиентский ANALYZE_TIMEOUT_MS (targets-client)
//   ~230 сессий → ~300 с — API Gateway execution_timeout
//   ~510 сессий → ~600 с — execution-timeout контейнера
// 90 — ступенька: она снимает первый потолок (клиентский таймаут поднят до
// 280с) и даёт замерить то, что расчётом не берётся — регрессия времени
// экстраполирована в 10 раз за край данных, а замер подготовки делался
// с ноутбука и был сетевым. Следующий подъём — только после боевых цифр
// из логов фаз в analysis-runner.
export const MAX_SESSIONS_PER_ANALYSIS = 90

const PACKET_CONCURRENCY = 5 // параллельный getJson внутри одной сессии
const SESSION_CONCURRENCY = 10 // параллельные сессии в collectSessionsForAnalysis
const INCOMPLETE_GRACE_MS = 30 * 60 * 1000 // 30 мин — после этого
// сессию считаем «брошенной» юзером и берём в анализ даже без endedAt

// 6.3b параметры извлечения кликов.
const MAX_CLICKS = 50 // потолок кликов в summary (ограничивает промпт)
const TEXT_CAP = 80 // макс длина clicks[].text (видимая метка элемента)
const RAGE_MIN = 3 // ≥3 клика по одному узлу…
const RAGE_WINDOW_MS = 1000 // …в окне 1000мс = rage
const DEAD_WINDOW_MS = 2500 // клик без Mutation в окне [t, t+2500мс] = dead.
// Включаем тот же мс (реакция клик-хендлера часто с тем же timestamp) и
// до 2.5с (анимации/отложенный рендер). Эвристика мягкая — сигнал, не факт.
const MAX_FORM_FIELDS = 20 // потолок полей формы в summary
// Реальные поля ввода (Focus/Blur ловятся и на кнопках/ссылках — их не
// считаем полями формы).
const FORM_TAGS = new Set(["input", "textarea", "select"])

type StoredPacket = {
  packetIndex: number
  events: Array<{ type: number; data: unknown; timestamp: number }>
}

// Сериализованный rrweb-узел (rrweb-snapshot NodeType: 0=Document,
// 2=Element, 3=Text). Element несёт tagName/attributes/childNodes/id;
// Text — textContent.
type SerNode = {
  type?: number
  id?: number
  tagName?: string
  attributes?: Record<string, unknown>
  textContent?: string
  childNodes?: SerNode[]
}

// re-apply на main 2026-07-15: поле `incomplete` вынесено из объекта
// SessionSummary в ExtractResult — текущий тип SessionSummary
// (analysis-prompt.ts) его НЕ содержит, а трогать analysis-prompt на
// этапе 6.3a не хотим. Вернуть в SessionSummary при интеграции 6.3d,
// если нужно передавать в промпт.
export type ExtractResult =
  | { ok: true; summary: SessionSummary; incomplete: boolean }
  | {
      ok: false
      reason: "no_packets" | "corrupted_json" | "no_full_snapshot"
    }

export async function extractSessionSummary(
  siteId: string,
  sessionToken: string,
  options: {
    sessionStartedAtMs: number
    sessionEndedAtMsFromDb: number | null
    userAgent: string | null
  },
): Promise<ExtractResult> {
  const prefix = `sessions/${siteId}/${sessionToken}/`
  const keys = await listKeys(prefix)
  if (keys.length === 0) {
    return { ok: false, reason: "no_packets" }
  }

  // Сортировка по числовому packetIndex (lexicographic поломал бы
  // 10.json vs 2.json) — тот же подход, что в analysis-target-matcher.
  const sorted = keys
    .map((k) => {
      const m = k.match(/\/(\d+)\.json$/)
      return { key: k, idx: m ? parseInt(m[1], 10) : -1 }
    })
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx)

  if (sorted.length === 0) {
    return { ok: false, reason: "no_packets" }
  }

  // Параллельный download с ограничением. Если хоть один пакет упал на
  // get/parse — вся сессия corrupted, потому что мы не можем гарантировать
  // целостность таймлайна без всех пакетов.
  let packets: StoredPacket[]
  try {
    packets = await withConcurrency(
      sorted,
      PACKET_CONCURRENCY,
      async ({ key, idx }) => {
        try {
          return await getJson<StoredPacket>(key)
        } catch (err) {
          console.warn("[session-pre-processor] packet fetch failed", {
            sessionToken,
            packetIndex: idx,
            error: (err as Error).message,
          })
          throw err
        }
      },
    )
  } catch {
    return { ok: false, reason: "corrupted_json" }
  }

  // Один проход: viewport, scroll, FullSnapshot-дерево, мутации, клики.
  // Node-id-map строим ПОСЛЕ (по FullSnapshot + Mutation-adds).
  let viewportWidth: number | null = null
  let viewportHeight: number | null = null
  let maxScrollY = 0
  let sawScrollEvent = false
  let lastTimestampMs = options.sessionStartedAtMs

  let fullSnapshotRoot: SerNode | null = null
  const mutationAdds: SerNode[] = []
  const mutationTimestamps: number[] = []
  const clickEvents: Array<{ id: number; timestamp: number }> = []
  // 6.3c: Focus/Blur (MouseInteraction type 5/6) + Input (source 5).
  // Храним только node id — контент ввода (data.text) НЕ читаем (152-ФЗ:
  // поле-only, никаких данных юзера).
  const focusIds = new Set<number>()
  const blurIds = new Set<number>()
  const inputIds = new Set<number>()

  for (const packet of packets) {
    if (!Array.isArray(packet.events)) continue
    for (const ev of packet.events) {
      if (typeof ev !== "object" || ev === null) continue
      const evObj = ev as {
        type?: unknown
        data?: unknown
        timestamp?: unknown
      }
      const ts = typeof evObj.timestamp === "number" ? evObj.timestamp : null
      if (ts !== null && ts > lastTimestampMs) lastTimestampMs = ts

      const type = evObj.type
      const data = (evObj.data as Record<string, unknown> | null) ?? null
      if (data === null) continue

      // type=2 FullSnapshot: DOM-дерево (data.node = корень Document).
      if (type === 2) {
        const node = (data as { node?: unknown }).node
        if (node && typeof node === "object") {
          fullSnapshotRoot = node as SerNode
        }
      }

      // type=4 Meta: viewport (width/height = window.inner*).
      if (type === 4) {
        if (viewportWidth === null && typeof data.width === "number") {
          viewportWidth = data.width
        }
        if (viewportHeight === null && typeof data.height === "number") {
          viewportHeight = data.height
        }
      }

      // type=3 IncrementalSnapshot — по data.source.
      if (type === 3) {
        const source = data.source
        // source 3 = Scroll. data.y — scrollTop.
        if (source === 3 && typeof data.y === "number") {
          sawScrollEvent = true
          if (data.y > maxScrollY) maxScrollY = data.y
        }
        // source 4 = ViewportResize (поворот/ресайз).
        if (source === 4) {
          if (typeof data.width === "number") viewportWidth = data.width
          if (typeof data.height === "number") viewportHeight = data.height
        }
        // source 0 = Mutation: adds → пополняют node-id-map (клик мог
        // прийтись по узлу, добавленному после снапшота); timestamp →
        // dead-click эвристика (реагировала ли страница).
        if (source === 0) {
          if (ts !== null) mutationTimestamps.push(ts)
          const adds = (data as { adds?: unknown }).adds
          if (Array.isArray(adds)) {
            for (const a of adds) {
              const n = (a as { node?: unknown })?.node
              if (n && typeof n === "object") mutationAdds.push(n as SerNode)
            }
          }
        }
        // source 2 = MouseInteraction; data.type=2 = Click. На мобильных
        // реальные тапы приходят как Click(2) тоже (браузер эмитит click
        // после тапа). TouchStart(7) НЕ считаем кликом — он срабатывает
        // на старте ЛЮБОГО касания, включая скролл-жест (у нас сотни
        // scroll-событий), и раздул бы клики мусором.
        if (
          source === 2 &&
          data.type === 2 &&
          typeof data.id === "number" &&
          ts !== null
        ) {
          clickEvents.push({ id: data.id, timestamp: ts })
        }
        // source 2, type 5 = Focus / type 6 = Blur (по node id поля).
        if (source === 2 && typeof data.id === "number") {
          if (data.type === 5) focusIds.add(data.id)
          if (data.type === 6) blurIds.add(data.id)
        }
        // source 5 = Input (факт ввода в поле). data.text маскирован rrweb
        // и НЕ читается — берём только id (152-ФЗ: поле-only).
        if (source === 5 && typeof data.id === "number") {
          inputIds.add(data.id)
        }
      }
    }
  }

  // Если viewport так и не определился — возвращаем no_full_snapshot.
  if (viewportWidth === null || viewportHeight === null) {
    return { ok: false, reason: "no_full_snapshot" }
  }

  // ── Node-id-map: индексируем элементы FullSnapshot + добавленные
  // мутациями. Текст извлекаем лениво только для кликнутых узлов (O(n)
  // индексация + O(subtree) на клик, кликов единицы).
  const nodeById = new Map<number, SerNode>()
  if (fullSnapshotRoot) indexNodes(fullSnapshotRoot, nodeById)
  for (const add of mutationAdds) indexNodes(add, nodeById)

  // Клики → {selector, text, timeMs} (timeMs — офсет от старта сессии).
  const clicks = clickEvents.slice(0, MAX_CLICKS).map((c) => {
    const n = nodeById.get(c.id)
    return {
      selector: n ? selectorFor(n) : `unknown#${c.id}`,
      text: n ? elementText(n, TEXT_CAP) : "",
      timeMs: Math.max(0, Math.round(c.timestamp - options.sessionStartedAtMs)),
    }
  })

  // Rage: ≥RAGE_MIN кликов по одному узлу в окне RAGE_WINDOW_MS.
  const rageClicks = detectRageClicks(
    clickEvents,
    nodeById,
    options.sessionStartedAtMs,
  )

  // Dead: клик без Mutation(source0) в окне DEAD_WINDOW_MS после него.
  const sortedMut = mutationTimestamps.slice().sort((a, b) => a - b)
  let deadClicks = 0
  for (const c of clickEvents) {
    if (!hasMutationAfter(sortedMut, c.timestamp, DEAD_WINDOW_MS)) deadClicks++
  }

  // 6.3c: formInteractions — только по реальным ПОЛЯМ ВВОДА. Focus/Blur
  // (source2 type5/6) срабатывают на ЛЮБОМ фокусируемом элементе (кнопки,
  // ссылки), поэтому фильтруем по tagName ∈ {input, textarea, select} —
  // иначе кнопка/ссылка ложно попадёт как «брошенное поле». blurredEmpty
  // = поле фокусировали и покинули (focus+blur) БЕЗ ввода (нет Input) →
  // форма отпугнула. Поле с Input → blurredEmpty=false (юзер набрал).
  const fieldIds = new Set<number>([
    ...Array.from(focusIds),
    ...Array.from(blurIds),
    ...Array.from(inputIds),
  ])
  const formInteractions = Array.from(fieldIds)
    .map((id) => ({ id, node: nodeById.get(id) }))
    .filter(
      (x) => x.node && FORM_TAGS.has(String(x.node.tagName || "").toLowerCase()),
    )
    .slice(0, MAX_FORM_FIELDS)
    .map(({ id, node }) => ({
      field: fieldNameFor(node, id),
      blurredEmpty: focusIds.has(id) && blurIds.has(id) && !inputIds.has(id),
    }))

  // Exit: последний клик перед концом сессии → selector.
  const lastClick = clickEvents.reduce<{ id: number; timestamp: number } | null>(
    (acc, c) => (acc === null || c.timestamp > acc.timestamp ? c : acc),
    null,
  )
  let exitElement: string | null = null
  if (lastClick) {
    const n = nodeById.get(lastClick.id)
    exitElement = n ? selectorFor(n) : `unknown#${lastClick.id}`
  }

  const userAgent = options.userAgent
  const deviceType = classifyDevice(viewportWidth, userAgent)

  // FIXME 6.3b: docHeight = viewport.height — приближение (нет серверного
  // layout → истинный scrollHeight недоступен даже после rebuild).
  // scrollDepth здесь = «на сколько экранов проскроллил» (clamp 0..1),
  // а не точный % страницы. Достаточно для сигнала «дочитал/не дочитал».
  const docHeight = viewportHeight
  const scrollDepth = sawScrollEvent ? clamp(maxScrollY / docHeight, 0, 1) : 0

  const incomplete = options.sessionEndedAtMsFromDb === null
  const endMs = options.sessionEndedAtMsFromDb ?? lastTimestampMs
  const duration = Math.max(
    0,
    Math.round((endMs - options.sessionStartedAtMs) / 1000),
  )

  const summary: SessionSummary = {
    duration,
    deviceType,
    viewport: `${viewportWidth}x${viewportHeight}`,
    scrollDepth: round2(scrollDepth),
    clicks,
    formInteractions,
    rageClicks,
    deadClicks,
    exitElement,
    // TODO: error tracking — отдельный коммит, нужен window.onerror в трекере.
    errors: [],
  }

  return { ok: true, summary, incomplete }
}

export type CollectSessionsResult = {
  summaries: SessionSummary[]
  // Счётчики отсева — рунер по ним различает «0 содержательных, но сессии
  // были пустыми» vs «0 из-за повреждённых/недоступных данных».
  skipped: {
    corrupted: number
    noFullSnapshot: number
    noPackets: number
    noInteractions: number
  }
}

export async function collectSessionsForAnalysis(
  targetId: string,
  options: { limit: number },
): Promise<CollectSessionsResult> {
  const cutoff = new Date(Date.now() - INCOMPLETE_GRACE_MS)
  const sessions = await prisma.session.findMany({
    where: {
      analysisTargetId: targetId,
      OR: [{ endedAt: { not: null } }, { startedAt: { lt: cutoff } }],
    },
    select: {
      id: true,
      sessionToken: true,
      siteId: true,
      startedAt: true,
      endedAt: true,
      userAgent: true,
    },
    take: options.limit * 2, // запас на skip из-за corrupted/no_full_snapshot
    orderBy: { startedAt: "desc" },
  })

  if (sessions.length === 0) {
    return {
      summaries: [],
      skipped: { corrupted: 0, noFullSnapshot: 0, noPackets: 0, noInteractions: 0 },
    }
  }

  // Стратификация по deviceType (по UA, без download S3).
  const sampled = stratifySample(sessions, options.limit)

  const results = await withConcurrency(
    sampled,
    SESSION_CONCURRENCY,
    async (s) => {
      const result = await extractSessionSummary(s.siteId, s.sessionToken, {
        sessionStartedAtMs: s.startedAt.getTime(),
        sessionEndedAtMsFromDb: s.endedAt?.getTime() ?? null,
        userAgent: s.userAgent ?? null,
      })
      return result
    },
  )

  const summaries: SessionSummary[] = []
  const counts = {
    corrupted_json: 0,
    no_full_snapshot: 0,
    no_packets: 0,
    no_interactions: 0,
    incomplete: 0,
  }
  for (const r of results) {
    if (r.ok) {
      // Фильтр пустых сессий: bounce (снапшот, 0 действий) и пассивные
      // (только фоновые Tilda-мутации) дают summary с clicks:[],
      // scrollDepth:0, formInteractions:[] — пустышка, которая тратит
      // токены/внимание Claude, ничего не давая. Содержательна сессия,
      // если есть хотя бы одно ДЕЙСТВИЕ: клик, скролл или взаимодействие
      // с полем. (mousemove в summary не попадает — и это не действие.)
      // rage/deadClicks производны от clicks — отдельно проверять не нужно.
      // Данные сессии НЕ трогаем (budget/S3/БД) — только исключаем из
      // выборки для промпта. B (Meta без FullSnapshot, пустой nodeById)
      // тоже даёт 0 действий → отсеивается здесь же.
      const s = r.summary
      const meaningful =
        s.clicks.length > 0 ||
        s.scrollDepth > 0 ||
        s.formInteractions.length > 0
      if (!meaningful) {
        counts.no_interactions++
        continue
      }
      summaries.push(s)
      if (r.incomplete) counts.incomplete++
    } else {
      counts[r.reason]++
    }
  }
  // Observability: сколько запрошено/сэмплировано/собрано/пропущено — для
  // диагностики боевого анализа (6.3d).
  console.log("[session-pre-processor] collectSessionsForAnalysis", {
    targetId,
    queried: sessions.length,
    sampled: sampled.length,
    ok: summaries.length,
    incomplete: counts.incomplete,
    skipped_corrupted: counts.corrupted_json,
    skipped_no_full_snapshot: counts.no_full_snapshot,
    skipped_no_packets: counts.no_packets,
    skipped_no_interactions: counts.no_interactions,
  })
  return {
    summaries: summaries.slice(0, options.limit),
    skipped: {
      corrupted: counts.corrupted_json,
      noFullSnapshot: counts.no_full_snapshot,
      noPackets: counts.no_packets,
      noInteractions: counts.no_interactions,
    },
  }
}

// ─── node-id-map helpers (6.3b) ─────────────────────────────────────────

function indexNodes(node: SerNode, map: Map<number, SerNode>): void {
  if (!node || typeof node !== "object") return
  if (node.type === 2 && typeof node.id === "number") {
    map.set(node.id, node)
  }
  const kids = node.childNodes
  if (Array.isArray(kids)) {
    for (const c of kids) indexNodes(c, map)
  }
}

// Идентифицирующий (не полный путь) CSS-селектор: tag#id / tag.class / tag.
// Для AI важнее «.t-btn "Записаться"», чем «div>div>div», поэтому текст
// элемента (elementText) несёт основной сигнал, а селектор — вспомогательный.
function selectorFor(n: SerNode): string {
  const tag = String(n.tagName || "node").toLowerCase()
  const attrs = n.attributes || {}
  const idAttr = attrs.id
  if (typeof idAttr === "string" && idAttr.trim()) {
    return `${tag}#${idAttr.trim()}`
  }
  const cls = attrs.class
  if (typeof cls === "string" && cls.trim()) {
    const first = cls.trim().split(/\s+/)[0]
    if (first) return `${tag}.${first}`
  }
  return tag
}

// Имя поля формы для AI. Приоритет: placeholder (видимая метка, что юзер
// реально видел) → name → type → селектор. ВСЁ это — метаданные формы
// (публичный контент страницы), НЕ данные юзера: 152-ФЗ-safe.
function fieldNameFor(n: SerNode | undefined, id: number): string {
  if (!n) return `unknown#${id}`
  const attrs = n.attributes || {}
  const ph = attrs.placeholder
  if (typeof ph === "string" && ph.trim()) return ph.trim().slice(0, 40)
  const name = attrs.name
  if (typeof name === "string" && name.trim()) return name.trim().slice(0, 40)
  const t = attrs.type
  if (typeof t === "string" && t.trim()) {
    return `${String(n.tagName || "input").toLowerCase()}[type=${t.trim()}]`
  }
  return selectorFor(n)
}

// Видимый текст элемента: конкатенация textContent всех текстовых узлов
// поддерева (метка кнопки может быть во вложенном span), схлопнуть
// пробелы, обрезать до cap.
function elementText(n: SerNode, cap: number): string {
  let out = ""
  const stack: SerNode[] = [n]
  while (stack.length > 0 && out.length < cap * 2) {
    const cur = stack.shift()
    if (!cur) continue
    if (cur.type === 3 && typeof cur.textContent === "string") {
      out += cur.textContent + " "
    }
    const kids = cur.childNodes
    if (Array.isArray(kids)) stack.push(...kids)
  }
  return out.replace(/\s+/g, " ").trim().slice(0, cap)
}

// Есть ли Mutation-timestamp в окне [t, t+windowMs]. sortedTs — по возр.
// Включаем t (реакция клика часто с тем же timestamp — иначе консент-
// клик, удаливший баннер в тот же мс, ложно попал бы в dead).
function hasMutationAfter(
  sortedTs: number[],
  t: number,
  windowMs: number,
): boolean {
  for (const m of sortedTs) {
    if (m < t) continue
    return m <= t + windowMs // первый m≥t: в окне → true, иначе → false
  }
  return false
}

function detectRageClicks(
  clickEvents: Array<{ id: number; timestamp: number }>,
  nodeById: Map<number, SerNode>,
  startMs: number,
): Array<{ selector: string; count: number; timeMs: number }> {
  const byId = new Map<number, number[]>()
  for (const c of clickEvents) {
    const arr = byId.get(c.id) ?? []
    arr.push(c.timestamp)
    byId.set(c.id, arr)
  }
  const out: Array<{ selector: string; count: number; timeMs: number }> = []
  for (const [id, tsArr] of Array.from(byId.entries())) {
    tsArr.sort((a, b) => a - b)
    let i = 0
    for (let j = 0; j < tsArr.length; j++) {
      while (tsArr[j] - tsArr[i] > RAGE_WINDOW_MS) i++
      if (j - i + 1 >= RAGE_MIN) {
        const n = nodeById.get(id)
        out.push({
          selector: n ? selectorFor(n) : `unknown#${id}`,
          count: j - i + 1,
          timeMs: Math.max(0, Math.round(tsArr[i] - startMs)),
        })
        break // одна rage-запись на узел
      }
    }
  }
  return out
}

// ─── sampling / device helpers ──────────────────────────────────────────

type SessionForUaSample = { userAgent: string | null }

function stratifySample<T extends SessionForUaSample>(
  sessions: T[],
  limit: number,
): T[] {
  const groups: Record<"mobile" | "tablet" | "desktop", T[]> = {
    mobile: [],
    tablet: [],
    desktop: [],
  }
  for (const s of sessions) {
    groups[classifyDeviceByUA(s.userAgent)].push(s)
  }
  const total = sessions.length
  const out: T[] = []
  for (const key of ["mobile", "tablet", "desktop"] as const) {
    const group = groups[key]
    if (group.length === 0) continue
    const ratio = group.length / total
    const k = Math.round(ratio * limit)
    const shuffled = shuffle(group)
    out.push(...shuffled.slice(0, k))
  }
  // Math.round может дать out.length > limit (на 1-2). Trim.
  return out.slice(0, limit)
}


function classifyDevice(
  viewportWidth: number,
  userAgent: string | null,
): "mobile" | "tablet" | "desktop" {
  if (viewportWidth < 768) return "mobile"
  if (viewportWidth <= 1024) return "tablet"
  // Для десктопного viewport дополнительно сверяемся с UA — на iPad с
  // подключённой клавиатурой ширина может быть 1180+, но это всё ещё
  // tablet по продуктовой семантике.
  if (userAgent && /iPad/i.test(userAgent)) return "tablet"
  return "desktop"
}

function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo
  if (x > hi) return hi
  return x
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}

// Inline semaphore. Запускает n воркеров, каждый берёт из очереди.
// Порядок результатов НЕ совпадает с порядком items — pre-processor'у
// порядок безразличен (стратификация уже выбрала, дальше только агрегат).
async function withConcurrency<T, R>(
  items: T[],
  n: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  const queue = items.slice()
  async function worker() {
    while (queue.length) {
      const item = queue.shift()
      if (item === undefined) return
      results.push(await fn(item))
    }
  }
  await Promise.all(Array.from({ length: n }, worker))
  return results
}
