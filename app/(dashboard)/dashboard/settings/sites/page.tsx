import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
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

  const sites = await prisma.site.findMany({
    where: { ownerId: op.id },
    orderBy: [{ isDemo: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      domain: true,
      name: true,
      trackingToken: true,
      isDemo: true,
      createdAt: true,
    },
  })

  return <SitesClient initialSites={sites} />
}
