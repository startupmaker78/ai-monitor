"use client"

import { useEffect, useRef, useState } from "react"
import "rrweb-player/dist/style.css"
import { Card, CardContent } from "@/components/ui/card"

type RrwebEvent = { type: number; data: unknown; timestamp: number }

type FetchState =
  | { kind: "loading" }
  | { kind: "error"; status: number; message: string }
  | { kind: "ready"; events: RrwebEvent[]; active: boolean }

type Props = { sessionId: string; active: boolean }

// Динамический импорт rrweb-player делается внутри useEffect (не на
// top-level), чтобы код плеера не попал в SSR-bundle и не упал на
// `window`/`document` при первичном рендере. CSS-импорт выше top-level
// — он не использует браузерные API и Next 14 нормально его бандлит.
export function SessionPlayer({ sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<FetchState>({ kind: "loading" })

  // Шаг 1: загрузка events через API.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/sessions/${sessionId}/events`)
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            message?: string
          }
          setState({
            kind: "error",
            status: res.status,
            message: data.message ?? `Ошибка ${res.status}`,
          })
          return
        }
        const data = (await res.json()) as {
          events: RrwebEvent[]
          active: boolean
        }
        setState({
          kind: "ready",
          events: data.events,
          active: data.active,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message =
          err instanceof Error ? err.message : "Ошибка сети"
        setState({ kind: "error", status: 0, message })
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Шаг 2: инициализация rrweb-player когда events готовы.
  useEffect(() => {
    if (state.kind !== "ready") return
    if (state.events.length === 0) return
    const target = containerRef.current
    if (!target) return

    let player: { $destroy?: () => void } | null = null
    let aborted = false

    void (async () => {
      try {
        const mod = await import("rrweb-player")
        if (aborted) return
        const RrwebPlayer = mod.default as new (opts: unknown) => {
          $destroy?: () => void
        }
        const { width, height } = detectViewport(state.events)
        player = new RrwebPlayer({
          target,
          props: {
            events: state.events,
            width,
            height,
            autoPlay: false,
            showController: true,
          },
        })
      } catch (err) {
        console.error("[session-player] init failed:", err)
      }
    })()

    return () => {
      aborted = true
      try {
        player?.$destroy?.()
      } catch (e) {
        console.warn("[session-player] $destroy failed:", e)
      }
      // Defensive cleanup — alpha-версия rrweb-player не всегда чисто
      // снимает свои DOM-ноды.
      target.innerHTML = ""
    }
  }, [state])

  if (state.kind === "loading") {
    return <Notice>Загрузка записи сессии…</Notice>
  }

  if (state.kind === "error") {
    if (state.status === 410) {
      return (
        <Notice>
          Запись больше не доступна (сессии хранятся 30 дней).
        </Notice>
      )
    }
    if (state.status === 404) {
      return <Notice>Сессия не найдена.</Notice>
    }
    return <Notice tone="destructive">{state.message}</Notice>
  }

  if (state.events.length === 0) {
    if (state.active) {
      return (
        <Notice tone="amber">
          Сессия только начинается, события подгружаются…
        </Notice>
      )
    }
    return <Notice>В сессии нет записанных событий.</Notice>
  }

  return (
    <div className="space-y-3">
      {state.active && (
        <Notice tone="amber">
          Сессия ещё активна. Обновите страницу через несколько минут
          чтобы увидеть свежие события.
        </Notice>
      )}
      <div ref={containerRef} className="rrweb-player-host" />
    </div>
  )
}

function detectViewport(events: RrwebEvent[]): {
  width: number
  height: number
} {
  for (const ev of events) {
    if (ev.type === 4 && typeof ev.data === "object" && ev.data !== null) {
      const d = ev.data as { width?: unknown; height?: unknown }
      if (typeof d.width === "number" && typeof d.height === "number") {
        return { width: d.width, height: d.height }
      }
    }
  }
  return { width: 1280, height: 720 }
}

function Notice({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode
  tone?: "neutral" | "amber" | "destructive"
}) {
  const className =
    tone === "destructive"
      ? "border-destructive/50 bg-destructive/10 text-destructive"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50/60 text-amber-900"
        : ""
  return (
    <Card className={className}>
      <CardContent className="py-4 text-sm">{children}</CardContent>
    </Card>
  )
}
