"use client"

import { useRouter, usePathname } from "next/navigation"
import type { ChangeEvent } from "react"

type Props = {
  targets: Array<{ id: string; url: string; name: string | null }>
  selectedTargetId: string | null
  selectedSiteId: string | null
  selectedGoal: string | null
  currentSort: "newest" | "oldest"
}

export function TargetFilter({
  targets,
  selectedTargetId,
  selectedSiteId,
  selectedGoal,
  currentSort,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()

  // У сайта нет страниц — фильтр не нужен.
  if (targets.length === 0) return null

  function handleChange(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    const params = new URLSearchParams()
    // Сохраняем сайт, фильтр действия и сортировку при смене страницы.
    if (selectedSiteId) params.set("site", selectedSiteId)
    if (value !== "all") params.set("targetId", value)
    if (selectedGoal) params.set("goal", selectedGoal)
    if (currentSort === "oldest") params.set("sort", "oldest")

    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <select
      value={selectedTargetId ?? "all"}
      onChange={handleChange}
      aria-label="Фильтр по странице"
      className="max-w-[14rem] truncate rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="all">Все страницы</option>
      {targets.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name ?? t.url}
        </option>
      ))}
    </select>
  )
}
