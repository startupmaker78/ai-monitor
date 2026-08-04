import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getConnectionStatus } from "@/lib/connection-status"
import { getSelectedSiteId } from "@/lib/selected-site"
import { toUnicodeDomain } from "@/lib/domain-display"
import { SitesClient } from "./sites-client"

export const metadata = { title: "Сайты — Вебмонитор" }

export default async function SitesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const op = await prisma.ownerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!op) redirect("/login")

  // Выбранный сайт (глобальный селектор, cookie) — карточка показывает его.
  const selectedId = await getSelectedSiteId(session.user.id)

  const sites = await prisma.site.findMany({
    where: { ownerId: op.id, isDemo: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      domain: true,
      name: true,
      trackingToken: true,
      isDemo: true,
      createdAt: true,
    },
  })

  // Статус подключения на каждый сайт (дёшево, только DB). Сайтов мало —
  // последовательный map по индексированным запросам ок.
  const statuses = Object.fromEntries(
    await Promise.all(
      sites.map(async (s) => [s.id, await getConnectionStatus(s.id)] as const),
    ),
  )

  // Punycode → человекочитаемый домен для показа (декодируем на сервере).
  const sitesForClient = sites.map((s) => ({
    ...s,
    displayDomain: toUnicodeDomain(s.domain),
  }))

  return (
    <SitesClient
      initialSites={sitesForClient}
      statuses={statuses}
      selectedId={selectedId}
    />
  )
}
