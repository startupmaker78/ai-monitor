// Raw-классификация сессии для МЕТРИКИ ВОВЛЕЧЁННОСТИ цели. Используется:
//   1) collect — денормализация interactionCount/hasFullSnapshot в Session;
//   2) backfill-скрипт — заполнение существующих сессий;
//   3) агрегат вовлечённости по цели (Фаза 2 UI).
//
// ⚠️ ЭТО НЕ ТО ЖЕ, что summary-фильтр пре-процессора (64807d6). Здесь —
// ШИРОКОЕ определение: посетитель «сделал ХОТЬ ЧТО-ТО» (любой клик/скролл/
// ввод по raw-событиям). Пре-процессор СТРОЖЕ: scrollDepth>0 (реально
// прокрутил, с округлением), forms по node-map (ввод именно в input/
// textarea/select). Разница НАМЕРЕННА:
//   вовлечённость = «сделал что-то» (эта метрика),
//   анализ        = «поведение, достойное AI-разбора» (summary-фильтр).
// НЕ УНИФИЦИРОВАТЬ: замена summary-фильтра на этот raw-хелпер вернёт в
// AI-промпт ~7 почти-пустых сессий (стрей-скролл/не-form-ввод) → регресс
// 64807d6. Пре-процессор/фильтр анализа этот файл НЕ трогает.
// (Эмпирика 2026-07-20: 10/93 сессий классифицируются иначе, чем
// summary-фильтр — это ожидаемо и корректно, см. DECISIONS.)

// Минимальный тип rrweb-события: нужны только type и data.{source,type}.
export type ClassifiableEvent = {
  type: number
  data?: unknown
}

export type SessionClass = "useful" | "passive" | "bounce" | "incomplete"

// «Действие» посетителя (НЕ mousemove, НЕ фоновая мутация Tilda):
//   IncrementalSnapshot (type 3), по data.source:
//     3 Scroll                              — скролл страницы
//     5 Input                               — ввод в поле формы
//     2 MouseInteraction + data.type===2    — Click
// Исключены: source 1 (MouseMove — пассивно), source 0 (Mutation —
// фоновая возня скриптов Tilda). Совпадает с сигналами pre-processor
// (clicks src2·type2 + scroll src3 + input src5).
export function countInteractions(events: ClassifiableEvent[]): number {
  let n = 0
  for (const ev of events) {
    if (ev.type !== 3) continue
    const d = ev.data as { source?: number; type?: number } | null | undefined
    if (!d || typeof d.source !== "number") continue
    if (d.source === 3 || d.source === 5) n++
    else if (d.source === 2 && d.type === 2) n++
  }
  return n
}

// Есть ли FullSnapshot (type 2) — без него rrweb не восстановит DOM
// (сессия «неполная»).
export function hasFullSnapshot(events: ClassifiableEvent[]): boolean {
  return events.some((e) => e.type === 2)
}

// Классификация по денормализованным полям (без чтения S3):
//   useful     — есть ≥1 действие (клик/скролл/ввод);
//   incomplete — нет FullSnapshot (ушёл до записи / битая запись);
//   passive    — снапшот есть, событий >5, но 0 действий (смотрел,
//                но не взаимодействовал — только фоновые мутации);
//   bounce     — снапшот есть, ≤5 событий, 0 действий (мгновенный отскок).
export function classifySession(input: {
  interactionCount: number
  hasFullSnapshot: boolean
  eventsCount: number
}): SessionClass {
  if (input.interactionCount > 0) return "useful"
  if (!input.hasFullSnapshot) return "incomplete"
  if (input.eventsCount > 5) return "passive"
  return "bounce"
}

// Содержательна ли сессия для анализа (≥1 действие). Тонкий враппер для
// читаемости фильтра в pre-processor. Эквивалент classifySession==='useful'.
export function isMeaningfulSession(interactionCount: number): boolean {
  return interactionCount > 0
}
