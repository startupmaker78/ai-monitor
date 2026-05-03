"use client"

import { useRouter, usePathname } from "next/navigation"
import type { ChangeEvent } from "react"

type Props = {
  sites: Array<{ id: string; domain: string; isDemo: boolean }>
  selectedSiteId: string | null
  currentSort: "newest" | "oldest"
}

export function SiteFilter({ sites, selectedSiteId, currentSort }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  function handleChange(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    const params = new URLSearchParams()
    if (value !== "all") params.set("site", value)
    if (currentSort === "oldest") params.set("sort", "oldest")

    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <select
      value={selectedSiteId ?? "all"}
      onChange={handleChange}
      className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="all">Все сайты</option>
      {sites.map((s) => (
        <option key={s.id} value={s.id}>
          {s.domain}
          {s.isDemo ? " (демо)" : ""}
        </option>
      ))}
    </select>
  )
}
