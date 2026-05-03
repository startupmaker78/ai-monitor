import { record } from '@rrweb/record'
import { EventBuffer } from './buffer'
import { recordConfig } from './rrweb-config'

const PREFIX = '[webmonitor]'

function parseSiteToken(): string | null {
  const script = document.currentScript
  if (!script || !(script instanceof HTMLScriptElement) || !script.src) {
    return null
  }
  try {
    return new URL(script.src).searchParams.get('token')
  } catch {
    return null
  }
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
  // Not cryptographically secure, but acceptable for a session id —
  // collision space is large enough for our scale.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const siteToken = parseSiteToken()

if (!siteToken) {
  console.warn(
    `${PREFIX} missing ?token=... in script src; tracker disabled`,
  )
} else {
  const debugMode = isDebugEnabled()
  const log: (...args: unknown[]) => void = debugMode
    ? (...args) => console.log(PREFIX, ...args)
    : () => {}

  const sessionToken = generateSessionToken()
  const startedAt = Date.now()

  log('starting tracker', {
    sessionToken,
    siteToken,
    debug: debugMode,
    pageUrl: window.location.href,
  })

  const buffer = new EventBuffer({
    sessionToken,
    siteToken,
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
}
