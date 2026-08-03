"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { setSelectedSite } from "./site-actions"
import type { OwnerSiteLite } from "@/lib/selected-site"

// Глобальный переключатель сайта в хедере дашборда — единственный источник
// выбора (локальные SiteSelector убраны). Пишет cookie через server-action +
// router.refresh(). Скрыт при одном сайте (нечего переключать).
export function SiteSwitcher({
  sites,
  selectedId,
}: {
  sites: OwnerSiteLite[]
  selectedId: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  if (sites.length <= 1) return null

  return (
    <select
      value={selectedId ?? ""}
      disabled={pending}
      onChange={(e) => {
        const id = e.target.value
        startTransition(async () => {
          await setSelectedSite(id)
          router.refresh()
        })
      }}
      aria-label="Выбрать сайт"
      className="ml-auto rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
    >
      {sites.map((s) => (
        <option key={s.id} value={s.id}>
          {s.displayDomain}
        </option>
      ))}
    </select>
  )
}
