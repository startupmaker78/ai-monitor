"use client"

import { useEffect, useRef, useState } from "react"
import "rrweb-player/dist/style.css"
import { Card, CardContent } from "@/components/ui/card"

type RrwebEvent = { type: number; data: unknown; timestamp: number }

type StoredPacket = {
  packetIndex: number
  events: RrwebEvent[]
}

type PacketRef = { url: string; packetIndex: number }

type FetchState =
  | { kind: "fetching_manifest" }
  | { kind: "fetching_packets" }
  | { kind: "error"; status: number; message: string }
  | { kind: "ready"; events: RrwebEvent[]; active: boolean }

type Props = { sessionId: string; active: boolean }

// Динамический импорт rrweb-player делается внутри useEffect (не на
// top-level), чтобы код плеера не попал в SSR-bundle и не упал на
// `window`/`document` при первичном рендере. CSS-импорт выше top-level
// — он не использует браузерные API и Next 14 нормально его бандлит.
export function SessionPlayer({ sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<FetchState>({
    kind: "fetching_manifest",
  })

  // Шаг 1: получаем manifest (presigned URLs) от нашего endpoint'а.
  // Шаг 2: parallel скачивание каждого пакета напрямую с YOS.
  // Такая двухступенчатая схема обходит YC API Gateway response body
  // cap ~3.5 MB — сессии с 5+ FullSnapshot'ами (по 1.2 MiB каждый)
  // раньше валили endpoint с 502.
  useEffect(() => {
    let cancelled = false

    async function loadSession() {
      try {
        // Шаг 1: manifest
        const manifestRes = await fetch(`/api/sessions/${sessionId}/events`)
        if (cancelled) return
        if (!manifestRes.ok) {
          const data = (await manifestRes.json().catch(() => ({}))) as {
            message?: string
          }
          setState({
            kind: "error",
            status: manifestRes.status,
            message: data.message ?? `Ошибка ${manifestRes.status}`,
          })
          return
        }
        const manifest = (await manifestRes.json()) as {
          packets: PacketRef[]
          meta: {
            totalPackets: number
            active: boolean
            startedAt: string
            endedAt: string | null
          }
        }
        if (cancelled) return

        // Шаг 2: parallel скачивание пакетов с YOS.
        setState({ kind: "fetching_packets" })
        const packetJsons = await Promise.all(
          manifest.packets.map((p) =>
            fetch(p.url).then(async (r) => {
              if (!r.ok) {
                throw new Error(
                  `packet ${p.packetIndex} fetch failed: HTTP ${r.status}`,
                )
              }
              return (await r.json()) as StoredPacket
            }),
          ),
        )
        if (cancelled) return

        // Собираем events + сортируем по timestamp (как раньше делал
        // server, теперь на клиенте после concatenation).
        const events: RrwebEvent[] = []
        for (const p of packetJsons) {
          if (Array.isArray(p.events)) events.push(...p.events)
        }
        events.sort((a, b) => a.timestamp - b.timestamp)

        setState({
          kind: "ready",
          events,
          active: manifest.meta.active,
        })
      } catch (err: unknown) {
        if (cancelled) return
        const message =
          err instanceof Error ? err.message : "Ошибка сети"
        setState({ kind: "error", status: 0, message })
      }
    }

    void loadSession()

    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Шаг 2: инициализация rrweb-player когда events готовы.
  useEffect(() => {
    if (state.kind !== "ready") return
    if (state.events.length === 0) return
    // Без FullSnapshot (type 2) rrweb не соберёт стартовый DOM и бросит
    // при инициализации — не пытаемся, ниже показываем graceful-состояние.
    if (!state.events.some((e) => e.type === 2)) return
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

  if (state.kind === "fetching_manifest") {
    return <Notice>Получение доступа…</Notice>
  }

  if (state.kind === "fetching_packets") {
    return <Notice>Загрузка записи…</Notice>
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
    return (
      <Notice>
        Посетитель ушёл слишком быстро — запись не велась (bounce).
        Метаданные сессии показаны выше.
      </Notice>
    )
  }

  // events есть, но нет FullSnapshot (type 2) — rrweb не восстановит
  // стартовый DOM (обрезанная/битая запись). Не рендерим плеер в пустой
  // div (иначе тихий белый экран), показываем осмысленное состояние.
  if (!state.events.some((e) => e.type === 2)) {
    return (
      <Notice tone="amber">
        Запись неполна — стартовый снимок страницы не сохранился,
        воспроизведение недоступно. Метаданные сессии показаны выше.
      </Notice>
    )
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
