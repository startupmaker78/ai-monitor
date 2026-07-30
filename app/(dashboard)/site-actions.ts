"use server"

import { cookies } from "next/headers"
import { auth } from "@/auth"
import { validateSiteOwnership } from "@/lib/site-data"
import { SELECTED_SITE_COOKIE } from "@/lib/selected-site"

// Сохранить выбранный сайт в cookie. Ставим ТОЛЬКО валидированный (свой)
// siteId — чужой/битый игнорируем (не даём подделкой указать чужой сайт).
export async function setSelectedSite(siteId: string): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) return
  const owns = await validateSiteOwnership(siteId, session.user.id)
  if (!owns) return
  cookies().set(SELECTED_SITE_COOKIE, siteId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
}
