import { record } from '@rrweb/record'
import { EventBuffer } from './buffer'
import { recordConfig } from './rrweb-config'

const PREFIX = '[webmonitor]'
const SHOULD_RECORD_TIMEOUT_MS = 3000

function parseSiteToken(): string | null {
  const script = document.currentScript
  if (!script || !(script instanceof HTMLScriptElement)) {
    return null
  }
  // Приоритет — data-token атрибут (<script src="/tracker.js"
  // data-token="...">): токен НЕ в URL → не течёт в платформенный
  // access-лог при загрузке бандла (GET /tracker.js без query).
  // Fallback — ?token= из script.src: старый embed на academy ещё шлёт
  // токен в query, работает до обновления <script> (backward-compat).
  const dataToken = script.dataset.token
  if (dataToken) return dataToken
  if (!script.src) return null
  try {
    return new URL(script.src).searchParams.get('token')
  } catch {
    return null
  }
}

// Origin, с которого загружен tracker.js — это же origin для
// /api/tracking/should-record и /api/tracking/collect. Ни при каких
// условиях НЕ полагаемся на window.location.origin — сайт хостится
// на customer domain (nolim.cc), API — на нашем staging.вебмонитор.рф.
function deriveApiOrigin(): string | null {
  const script = document.currentScript
  if (script instanceof HTMLScriptElement && script.src) {
    try {
      const url = new URL(script.src)
      return `${url.protocol}//${url.host}`
    } catch {
      return null
    }
  }
  return null
}

function isDebugEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('wm-debug') === '1'
  } catch {
    return false
  }
}

function generateSessionToken(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  // Fallback for browsers without crypto.randomUUID (Safari < 15.4).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

type ShouldRecordResponse = {
  record: boolean
  targetId?: string
  reason?: string
}

// fail CLOSED: любой сбой связи с /should-record → трекер не стартует.
// Причина всегда бросается как Error, чтобы вызывающий код мог
// сформировать чёткий console.warn — silent no-op не приемлем
// (см. DECISIONS 2026-05-08 «record only on target URLs»).
async function checkShouldRecord(
  apiOrigin: string,
  siteToken: string,
  pageUrl: string,
): Promise<ShouldRecordResponse> {
  // Токен уходит в заголовке X-Site-Token, НЕ в URL — иначе он течёт в
  // платформенный access-лог (`GET …?token=… 200`). В query остаётся
  // только url= (pageUrl). Кастомный заголовок на cross-origin GET →
  // браузер шлёт preflight OPTIONS; сервер should-record разрешает
  // X-Site-Token (DECISIONS 2026-07-13, фаза 1) и принимает legacy
  // ?token= как fallback, так что рассинхрон клиент/сервер не ломает.
  const url =
    apiOrigin +
    '/api/tracking/should-record?url=' +
    encodeURIComponent(pageUrl)

  const ctrl = new AbortController()
  const timeoutId = setTimeout(() => ctrl.abort(), SHOULD_RECORD_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-Site-Token': siteToken },
      signal: ctrl.signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) {
      throw new Error('http_' + res.status)
    }
    let data: unknown
    try {
      data = await res.json()
    } catch {
      throw new Error('invalid_response')
    }
    if (!data || typeof data !== 'object') {
      throw new Error('invalid_response')
    }
    return data as ShouldRecordResponse
  } catch (err) {
    clearTimeout(timeoutId)
    const e = err as Error
    if (e.name === 'AbortError') throw new Error('timeout')
    throw e
  }
}

function warnNotRecording(reason: string): void {
  // ОБЯЗАТЕЛЬНО в любом exit-path (независимо от debugMode), чтобы
  // владелец сайта / QA могли найти причину в DevTools через grep
  // [webmonitor]. Silent no-op → невозможно отладить «почему у меня
  // ничего не пишется».
  console.warn(PREFIX + ' not recording — should-record failed: ' + reason)
}

const siteToken = parseSiteToken()
const apiOrigin = deriveApiOrigin()

if (!siteToken) {
  console.warn(
    PREFIX + ' missing ?token=... in script src; tracker disabled',
  )
} else if (!apiOrigin) {
  warnNotRecording('cannot_derive_api_origin')
} else {
  const debugMode = isDebugEnabled()
  const log: (...args: unknown[]) => void = debugMode
    ? (...args) => console.log(PREFIX, ...args)
    : () => {}

  void (async () => {
    let result: ShouldRecordResponse
    try {
      result = await checkShouldRecord(
        apiOrigin,
        siteToken,
        window.location.href,
      )
    } catch (err) {
      const e = err as Error
      warnNotRecording('network_error: ' + e.name + ':' + e.message)
      return
    }

    if (!result.record) {
      warnNotRecording(result.reason || 'unknown')
      return
    }
    if (!result.targetId) {
      warnNotRecording('missing_target_id_in_response')
      return
    }

    const sessionToken = generateSessionToken()
    const startedAt = Date.now()

    log('starting tracker', {
      sessionToken,
      siteToken,
      targetId: result.targetId,
      debug: debugMode,
      pageUrl: window.location.href,
    })

    const buffer = new EventBuffer({
      sessionToken,
      siteToken,
      targetId: result.targetId,
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      startedAt,
      log,
    })

    buffer.start()

    record({
      ...recordConfig,
      emit(event) {
        buffer.add(event)
      },
    })
  })()
}
