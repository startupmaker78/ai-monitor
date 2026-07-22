"use client"

import { useRouter, usePathname } from "next/navigation"
import type { ChangeEvent } from "react"

type Props = {
  targets: Array<{ id: string; url: string; name: string | null }>
  selectedTargetId: string | null
  selectedSiteId: string | null
  currentSort: "newest" | "oldest"
}

export function TargetFilter({
  targets,
  selectedTargetId,
  selectedSiteId,
  currentSort,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()

  // У сайта нет целей — фильтр не нужен.
  if (targets.length === 0) return null

  function handleChange(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    const params = new URLSearchParams()
    // Сохраняем сайт и сортировку при смене цели.
    if (selectedSiteId) params.set("site", selectedSiteId)
    if (value !== "all") params.set("targetId", value)
    if (currentSort === "oldest") params.set("sort", "oldest")

    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <select
      value={selectedTargetId ?? "all"}
      onChange={handleChange}
      aria-label="Фильтр по цели"
      className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="all">Все цели</option>
      {targets.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name ?? t.url}
        </option>
      ))}
    </select>
  )
}
