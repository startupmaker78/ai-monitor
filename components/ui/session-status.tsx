"use client"

import { useEffect, useState } from "react"

// Пакеты трекера льются каждые ≤30с (FLUSH_INTERVAL_MS в buffer.ts),
// раньше — при 200 событиях или на FullSnapshot. Активный визит обновляет
// lastPacketAt минимум раз в 30с. Порог 90с (3 интервала) = надёжно
// «ушёл»: запас на один пропущенный/задержанный пакет + сеть, без мигания
// «онлайн»↔«офлайн» на нормальной 30с-паузе между флашами.
const ONLINE_THRESHOLD_MS = 90_000
// Как часто пересчитывать на клиенте, пока сессия потенциально «онлайн».
const TICK_MS = 15_000

type Props = {
  startedAtMs: number
  endedAtMs: number | null
  lastPacketAtMs: number | null
  // Время рендера на СЕРВЕРЕ — для детерминированного первого рендера
  // (SSR === гидратация), иначе hydration mismatch. После mount
  // пересчитываем по клиентскому Date.now() (тик), статус «онлайн» сам
  // гаснет когда пакеты стихли — без перезагрузки страницы.
  serverNowMs: number
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}с`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (sec < 3600) return `${m}м ${s}с`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h}ч ${mm}м`
}

export function SessionStatus({
  startedAtMs,
  endedAtMs,
  lastPacketAtMs,
  serverNowMs,
}: Props) {
  // Первый рендер (сервер + гидратация) считает от serverNowMs — одинаково
  // на обеих сторонах → mismatch невозможен. useEffect переключает на
  // клиентское now и запускает тик только для незавершённых сессий.
  const [nowMs, setNowMs] = useState(serverNowMs)

  useEffect(() => {
    setNowMs(Date.now())
    // Завершённая сессия (endedAt != null) статична — тик не нужен.
    if (endedAtMs !== null) return
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [endedAtMs])

  // (1) Завершённая — точная длительность (endedAt − startedAt).
  if (endedAtMs !== null) {
    return (
      <span>
        {formatDuration(Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000)))}
      </span>
    )
  }

  // (2) Активная (endedAt=null) + свежий пакет → «онлайн»: посетитель
  // прямо сейчас на сайте, запись идёт в реальном времени.
  const online =
    lastPacketAtMs !== null && nowMs - lastPacketAtMs < ONLINE_THRESHOLD_MS
  if (online) {
    return (
      <span className="inline-flex items-center gap-1.5 text-green-600">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
        онлайн
      </span>
    )
  }

  // (3) Активная в БД, но пакеты стихли → визит де-факто закончился,
  // финальный сигнал не долетел (закроется cron за ~60-75 мин). Показываем
  // приблизительную длительность до последнего пакета + «не завершена».
  // lastPacketAt=null (legacy до миграции) → приближаем нулём (startedAt).
  const endMs = lastPacketAtMs ?? startedAtMs
  const approx = Math.max(0, Math.round((endMs - startedAtMs) / 1000))
  return (
    <span
      className="text-muted-foreground"
      title="Визит не завершён — финальный сигнал не получен, длительность приблизительна"
    >
      ~{formatDuration(approx)}
    </span>
  )
}
