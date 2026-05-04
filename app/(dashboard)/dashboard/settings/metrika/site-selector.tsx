"use client"

import { useRouter, usePathname } from "next/navigation"
import type { ChangeEvent } from "react"

type Props = {
  sites: Array<{ id: string; domain: string; isDemo: boolean }>
  selectedSiteId: string
}

export function SiteSelector({ sites, selectedSiteId }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  function handleChange(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    router.push(`${pathname}?site=${encodeURIComponent(value)}`)
  }

  return (
    <select
      value={selectedSiteId}
      onChange={handleChange}
      className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {sites.map((s) => (
        <option key={s.id} value={s.id}>
          {s.domain}
          {s.isDemo ? " (демо)" : ""}
        </option>
      ))}
    </select>
  )
}
