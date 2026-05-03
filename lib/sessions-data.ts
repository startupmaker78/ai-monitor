import { prisma } from "@/lib/prisma"

export type SessionsForUser = {
  sites: Array<{ id: string; domain: string; isDemo: boolean }>
  sessions: Array<{
    id: string
    sessionToken: string
    startedAt: Date
    endedAt: Date | null
    eventsCount: number
    ipHash: string
    site: { id: string; domain: string; isDemo: boolean }
    analysisTarget: { id: string; url: string } | null
  }>
  selectedSiteId: string | null
}

export async function getSessionsForUser(
  userId: string,
  options: { siteId?: string; sort?: "newest" | "oldest" } = {},
): Promise<SessionsForUser> {
  const ownerProfile = await prisma.ownerProfile.findUnique({
    where: { userId },
    include: {
      sites: {
        orderBy: { createdAt: "asc" },
        select: { id: true, domain: true, isDemo: true },
      },
    },
  })

  if (!ownerProfile || ownerProfile.sites.length === 0) {
    return { sites: [], sessions: [], selectedSiteId: null }
  }

  const sites = ownerProfile.sites
  const siteIds = sites.map((s) => s.id)

  // Защита от чужих ID в URL: игнорируем siteId если его нет в списке
  // сайтов юзера.
  const validatedSiteId =
    options.siteId && siteIds.includes(options.siteId) ? options.siteId : null

  const sessions = await prisma.session.findMany({
    where: { siteId: validatedSiteId ?? { in: siteIds } },
    orderBy: { startedAt: options.sort === "oldest" ? "asc" : "desc" },
    take: 50,
    include: {
      site: { select: { id: true, domain: true, isDemo: true } },
      analysisTarget: { select: { id: true, url: true } },
    },
  })

  return { sites, sessions, selectedSiteId: validatedSiteId }
}
