import { prisma, withDbRetry } from "@/lib/prisma"

export type SessionsForUser = {
  sites: Array<{ id: string; domain: string; isDemo: boolean }>
  sessions: Array<{
    id: string
    sessionToken: string
    startedAt: Date
    endedAt: Date | null
    // Время последнего долетевшего пакета — для статуса «онлайн» (свежий)
    // vs «не завершена» (пакеты стихли). null у legacy-сессий до миграции.
    lastPacketAt: Date | null
    eventsCount: number
    ipHash: string
    site: { id: string; domain: string; isDemo: boolean }
    analysisTarget: { id: string; url: string; name: string | null } | null
  }>
  selectedSiteId: string | null
}

export async function getSessionsForUser(
  userId: string,
  options: { siteId?: string; sort?: "newest" | "oldest" } = {},
): Promise<SessionsForUser> {
  // withDbRetry: SSR-страницы дашборда на scale-to-zero контейнере ловят
  // idle-обрыв TCP к Managed PG на первом запросе после простоя. Без
  // ретрая transient-throw роняет весь SSR → 502 (единообразно с
  // collect/should-record/finalize).
  const ownerProfile = await withDbRetry(() =>
    prisma.ownerProfile.findUnique({
      where: { userId },
      include: {
        sites: {
          orderBy: { createdAt: "asc" },
          select: { id: true, domain: true, isDemo: true },
        },
      },
    }),
  )

  if (!ownerProfile || ownerProfile.sites.length === 0) {
    return { sites: [], sessions: [], selectedSiteId: null }
  }

  const sites = ownerProfile.sites
  const siteIds = sites.map((s) => s.id)

  // Защита от чужих ID в URL: игнорируем siteId если его нет в списке
  // сайтов юзера.
  const validatedSiteId =
    options.siteId && siteIds.includes(options.siteId) ? options.siteId : null

  const sessions = await withDbRetry(() =>
    prisma.session.findMany({
      where: { siteId: validatedSiteId ?? { in: siteIds } },
      orderBy: { startedAt: options.sort === "oldest" ? "asc" : "desc" },
      take: 50,
      include: {
        site: { select: { id: true, domain: true, isDemo: true } },
        analysisTarget: { select: { id: true, url: true, name: true } },
      },
    }),
  )

  return { sites, sessions, selectedSiteId: validatedSiteId }
}

export type OwnedSession = {
  id: string
  sessionToken: string
  siteId: string
  storageKey: string | null
  startedAt: Date
  endedAt: Date | null
  lastPacketAt: Date | null
  eventsCount: number
  ipHash: string
  site: { domain: string; isDemo: boolean }
  analysisTarget: { id: string; url: string; name: string | null } | null
}

// Загружает Session по id и проверяет, что она принадлежит юзеру через
// цепочку User → OwnerProfile → Site → Session. Возвращает null если
// сессия не найдена ИЛИ принадлежит другому юзеру (не палим
// существование чужих ID).
export async function loadOwnedSession(
  sessionId: string,
  userId: string,
): Promise<OwnedSession | null> {
  const op = await withDbRetry(() =>
    prisma.ownerProfile.findUnique({
      where: { userId },
      select: { id: true },
    }),
  )
  if (!op) return null

  const found = await withDbRetry(() =>
    prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        site: { select: { ownerId: true, domain: true, isDemo: true } },
        analysisTarget: { select: { id: true, url: true, name: true } },
      },
    }),
  )
  if (!found || found.site.ownerId !== op.id) return null

  return {
    id: found.id,
    sessionToken: found.sessionToken,
    siteId: found.siteId,
    storageKey: found.storageKey,
    startedAt: found.startedAt,
    endedAt: found.endedAt,
    lastPacketAt: found.lastPacketAt,
    eventsCount: found.eventsCount,
    ipHash: found.ipHash,
    site: { domain: found.site.domain, isDemo: found.site.isDemo },
    analysisTarget: found.analysisTarget,
  }
}
