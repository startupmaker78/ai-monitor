"use client"

import { useRouter, usePathname } from "next/navigation"
import type { ChangeEvent } from "react"

// Фильтр по целевому действию страницы. Показывает сессии всех страниц, у
// которых задано выбранное действие (одно действие может стоять на разных
// страницах). Скрыт, если ни у одной страницы действия нет.
type Props = {
  goalActions: string[]
  selectedGoal: string | null
  selectedSiteId: string | null
  selectedTargetId: string | null
  currentSort: "newest" | "oldest"
}

export function GoalFilter({
  goalActions,
  selectedGoal,
  selectedSiteId,
  selectedTargetId,
  currentSort,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()

  if (goalActions.length === 0) return null

  function handleChange(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    const params = new URLSearchParams()
    // Сохраняем сайт, фильтр страницы и сортировку при смене действия.
    if (selectedSiteId) params.set("site", selectedSiteId)
    if (selectedTargetId) params.set("targetId", selectedTargetId)
    if (value !== "all") params.set("goal", value)
    if (currentSort === "oldest") params.set("sort", "oldest")

    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <select
      value={selectedGoal ?? "all"}
      onChange={handleChange}
      aria-label="Фильтр по целевому действию"
      className="max-w-[14rem] truncate rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="all">Все действия</option>
      {goalActions.map((g) => (
        <option key={g} value={g}>
          {g}
        </option>
      ))}
    </select>
  )
}
