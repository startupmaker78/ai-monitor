"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"

type Props = {
  siteId: string
  metrikaConfigured: boolean
}

type SyncState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string }

export function SyncButton({ siteId, metrikaConfigured }: Props) {
  const router = useRouter()
  const [state, setState] = useState<SyncState>({ kind: "idle" })

  // Если Метрика не настроена — показываем ссылку, а не кнопку.
  if (!metrikaConfigured) {
    return (
      <Link
        href="/dashboard/settings/metrika"
        className="inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm hover:bg-accent"
      >
        Настроить Метрику
      </Link>
    )
  }

  async function handleSync() {
    setState({ kind: "pending" })
    try {
      const res = await fetch("/api/metrika/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId }),
      })
      const data = await res.json()

      if (!res.ok) {
        setState({
          kind: "error",
          message: data.message ?? data.error ?? "Ошибка синхронизации",
        })
        setTimeout(() => setState({ kind: "idle" }), 5000)
        return
      }

      const total = (data.snapshotsCreated ?? 0) + (data.snapshotsUpdated ?? 0)
      setState({
        kind: "success",
        message: `Готово. Обновлено дней: ${total}`,
      })
      router.refresh()
      setTimeout(() => setState({ kind: "idle" }), 3000)
    } catch {
      setState({
        kind: "error",
        message: "Не удалось связаться с сервером",
      })
      setTimeout(() => setState({ kind: "idle" }), 5000)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        onClick={handleSync}
        disabled={state.kind === "pending"}
      >
        {state.kind === "pending" ? "Синхронизация..." : "Обновить сейчас"}
      </Button>
      {state.kind === "success" && (
        <span className="text-sm text-green-600">{state.message}</span>
      )}
      {state.kind === "error" && (
        <span className="text-sm text-destructive">{state.message}</span>
      )}
    </div>
  )
}
