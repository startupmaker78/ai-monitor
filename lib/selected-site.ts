import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { toUnicodeDomain } from "@/lib/domain-display"

// Единый источник выбранного сайта для всех страниц дашборда (cookie-based).
// Порядок: ?site=override (deep-link) → cookie wm_site → первый сайт. Каждый
// кандидат ВАЛИДИРУЕТСЯ на принадлежность юзеру — подделанная cookie с чужим
// siteId падает на фолбэк (первый свой сайт), не утечка чужих данных.

export const SELECTED_SITE_COOKIE = "wm_site"

// displayDomain — человекочитаемый (Punycode декодирован), для показа в UI.
// domain — исходный (может быть xn--…), для технических нужд.
export type OwnerSiteLite = {
  id: string
  domain: string
  displayDomain: string
}

export async function getOwnerRealSites(
  userId: string,
): Promise<OwnerSiteLite[]> {
  const op = await prisma.ownerProfile.findUnique({
    where: { userId },
    include: {
      // isDemo:false — демо-сайт не участвует в переключателе (у него своя
      // страница /demo); консистентно с getDashboardData.
      sites: {
        where: { isDemo: false },
        orderBy: { createdAt: "asc" },
        select: { id: true, domain: true },
      },
    },
  })
  return (op?.sites ?? []).map((s) => ({
    ...s,
    displayDomain: toUnicodeDomain(s.domain),
  }))
}

export async function getUserSitesAndSelected(
  userId: string,
  override?: string,
): Promise<{ sites: OwnerSiteLite[]; selectedId: string | null }> {
  const sites = await getOwnerRealSites(userId)
  if (sites.length === 0) return { sites, selectedId: null }
  const owned = new Set(sites.map((s) => s.id))
  const cookieVal = cookies().get(SELECTED_SITE_COOKIE)?.value
  const selectedId =
    [override, cookieVal].find((v) => v && owned.has(v)) ?? sites[0].id
  return { sites, selectedId }
}

// Только валидированный siteId (для data-функций, которым нужен id, не список).
export async function getSelectedSiteId(
  userId: string,
  override?: string,
): Promise<string | null> {
  const { selectedId } = await getUserSitesAndSelected(userId, override)
  return selectedId
}
