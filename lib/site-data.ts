import { prisma } from "@/lib/prisma"

export type OwnerSite = {
  id: string
  domain: string
  isDemo: boolean
  metrikaCounterId: string | null
  metrikaToken: string | null
}

// Все сайты, принадлежащие юзеру через OwnerProfile.userId. Сортировка по
// дате создания (стабильно для UI: первый сайт всегда наверху).
//
// Возвращает metrikaToken — caller сам решает не передавать его в Client
// Component и не светить в UI (form'а ниже использует только factual флаг
// "токен установлен" через initialTokenSet=Boolean(metrikaToken)).
export async function getOwnerSitesByUserId(
  userId: string,
): Promise<OwnerSite[]> {
  const op = await prisma.ownerProfile.findUnique({
    where: { userId },
    include: {
      sites: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          domain: true,
          isDemo: true,
          metrikaCounterId: true,
          metrikaToken: true,
        },
      },
    },
  })
  return op?.sites ?? []
}

// Защита от чужих ID в URL/form: проверяем что siteId принадлежит юзеру
// (через OwnerProfile.userId). Возвращает true только если связка ровная.
export async function validateSiteOwnership(
  siteId: string,
  userId: string,
): Promise<boolean> {
  const op = await prisma.ownerProfile.findUnique({
    where: { userId },
    select: { sites: { where: { id: siteId }, select: { id: true } } },
  })
  return (op?.sites.length ?? 0) > 0
}
