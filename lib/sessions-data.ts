import { prisma, withDbRetry } from "@/lib/prisma"
import { classifyDeviceByUA, type DeviceType } from "@/lib/device"
import { classifySession, type SessionClass } from "@/lib/session-classification"

export type SessionListItem = {
  id: string
  sessionToken: string
  startedAt: Date
  endedAt: Date | null
  // Время последнего долетевшего пакета — для статуса «онлайн» (свежий)
  // vs «не завершена» (пакеты стихли). null у legacy-сессий до миграции.
  lastPacketAt: Date | null
  ipHash: string
  // Денормализованные/вычисленные на сервере (raw userAgent/eventsCount в
  // клиент не отдаём). deviceType — по UA; sessionClass — classifySession
  // (interactionCount/hasFullSnapshot/eventsCount, Фаза 1).
  deviceType: DeviceType
  interactionCount: number
  sessionClass: SessionClass
  site: { id: string; domain: string; isDemo: boolean }
  // metrikaGoalName — целевое действие, заданное для СТРАНИЦЫ (не факт о
  // сессии: достижение в конкретной записи мы не определяем, см. DECISIONS).
  analysisTarget: {
    id: string
    url: string
    name: string | null
    metrikaGoalName: string | null
  } | null
}

export type SessionsForUser = {
  sites: Array<{ id: string; domain: string; isDemo: boolean }>
  // Активные страницы выбранного сайта — для фильтра по странице.
  targets: Array<{
    id: string
    url: string
    name: string | null
    metrikaGoalName: string | null
  }>
  // Уникальные целевые действия среди страниц сайта — для фильтра по действию.
  goalActions: string[]
  sessions: SessionListItem[]
  selectedSiteId: string | null
  selectedTargetId: string | null
  selectedGoal: string | null
}

export async function getSessionsForUser(
  userId: string,
  options: {
    siteId?: string
    targetId?: string
    goal?: string
    sort?: "newest" | "oldest"
  } = {},
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
    return {
      sites: [],
      targets: [],
      goalActions: [],
      sessions: [],
      selectedSiteId: null,
      selectedTargetId: null,
      selectedGoal: null,
    }
  }

  const sites = ownerProfile.sites
  const siteIds = sites.map((s) => s.id)

  // Защита от чужих ID в URL: игнорируем siteId если его нет в списке
  // сайтов юзера.
  const validatedSiteId =
    options.siteId && siteIds.includes(options.siteId) ? options.siteId : null

  // Цели принадлежат сайту. «Эффективный» сайт для фильтра целей: выбранный,
  // либо единственный сайт юзера (частый случай). При мультисайте без выбора
  // — целей не показываем (неоднозначно).
  const effectiveSiteId =
    validatedSiteId ?? (sites.length === 1 ? sites[0].id : null)

  const targets = effectiveSiteId
    ? await withDbRetry(() =>
        prisma.analysisTarget.findMany({
          where: { siteId: effectiveSiteId, archivedAt: null },
          orderBy: { createdAt: "asc" },
          select: { id: true, url: true, name: true, metrikaGoalName: true },
        }),
      )
    : []

  // Валидируем targetId: только цель из списка (принадлежит сайту юзера).
  // Смена сайта → targetId чужого сайта не пройдёт → null (сброс).
  const validatedTargetId =
    options.targetId && targets.some((t) => t.id === options.targetId)
      ? options.targetId
      : null

  // Уникальные целевые действия среди страниц сайта (для фильтра по действию).
  // Одно действие может стоять на нескольких страницах — фильтр покажет их все.
  const goalActions = Array.from(
    new Set(
      targets
        .map((t) => t.metrikaGoalName)
        .filter((g): g is string => Boolean(g)),
    ),
  ).sort((a, b) => a.localeCompare(b, "ru"))

  // Валидируем goal: только из списка действий сайта.
  const validatedGoal =
    options.goal && goalActions.includes(options.goal) ? options.goal : null

  const rows = await withDbRetry(() =>
    prisma.session.findMany({
      where: {
        siteId: validatedSiteId ?? { in: siteIds },
        ...(validatedTargetId ? { analysisTargetId: validatedTargetId } : {}),
        // Фильтр по действию: сессии страниц, у которых задано это целевое
        // действие. Комбинируется с фильтром страницы (AND).
        ...(validatedGoal
          ? { analysisTarget: { metrikaGoalName: validatedGoal } }
          : {}),
      },
      orderBy: { startedAt: options.sort === "oldest" ? "asc" : "desc" },
      take: 50,
      select: {
        id: true,
        sessionToken: true,
        startedAt: true,
        endedAt: true,
        lastPacketAt: true,
        ipHash: true,
        userAgent: true,
        interactionCount: true,
        hasFullSnapshot: true,
        eventsCount: true,
        site: { select: { id: true, domain: true, isDemo: true } },
        analysisTarget: {
          select: { id: true, url: true, name: true, metrikaGoalName: true },
        },
      },
    }),
  )

  const sessions: SessionListItem[] = rows.map((r) => ({
    id: r.id,
    sessionToken: r.sessionToken,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    lastPacketAt: r.lastPacketAt,
    ipHash: r.ipHash,
    deviceType: classifyDeviceByUA(r.userAgent),
    interactionCount: r.interactionCount,
    sessionClass: classifySession({
      interactionCount: r.interactionCount,
      hasFullSnapshot: r.hasFullSnapshot,
      eventsCount: r.eventsCount,
    }),
    site: r.site,
    analysisTarget: r.analysisTarget,
  }))

  return {
    sites,
    targets,
    goalActions,
    sessions,
    selectedSiteId: validatedSiteId,
    selectedTargetId: validatedTargetId,
    selectedGoal: validatedGoal,
  }
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
