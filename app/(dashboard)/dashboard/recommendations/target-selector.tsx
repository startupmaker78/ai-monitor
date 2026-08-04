"use client"

import { useRouter } from "next/navigation"

type Target = { id: string; name: string | null; url: string }

type Props = {
  targets: Target[]
  selectedId: string
}

export function TargetSelector({ targets, selectedId }: Props) {
  const router = useRouter()

  if (targets.length <= 1) return null

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const id = e.target.value
    const params = new URLSearchParams()
    params.set("targetId", id)
    router.push("/dashboard/recommendations?" + params.toString())
  }

  return (
    <select
      value={selectedId}
      onChange={handleChange}
      className="rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent"
      aria-label="Выбрать страницу"
    >
      {targets.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name ?? t.url}
        </option>
      ))}
    </select>
  )
}
