"use client"

import { useFormState, useFormStatus } from "react-dom"
import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  saveMetrikaSettings,
  loadMetrikaCounters,
  type MetrikaActionResult,
} from "./actions"
import type { MetrikaCounter } from "@/lib/metrika-goals"

type Props = {
  siteId: string
  siteDomain: string
  isDemo: boolean
  initialCounterId: string
  initialTokenSet: boolean
}

const initialState: MetrikaActionResult | null = null

const PERMISSION_LABELS: Record<string, string> = {
  own: "владелец",
  edit: "редактирование",
  view: "просмотр",
  guest_see: "гость (просмотр)",
}

const LOAD_ERROR: Record<string, string> = {
  auth_failed: "Токен недействителен или истёк — проверьте и введите заново.",
  counter_forbidden: "Токен не даёт доступа к счётчикам.",
  rate_limited: "Слишком много обращений к Метрике — подождите пару минут.",
  metrika_unavailable: "Метрика недоступна — попробуйте позже.",
}

// Нормализация хоста для сверки доменов (кириллица → punycode через URL).
function normHost(d: string): string {
  try {
    return new URL(d.includes("://") ? d : "https://" + d).hostname.toLowerCase()
  } catch {
    return d.toLowerCase()
  }
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Сохранение..." : "Сохранить"}
    </Button>
  )
}

export function MetrikaForm({
  siteId,
  siteDomain,
  isDemo,
  initialCounterId,
  initialTokenSet,
}: Props) {
  const [state, formAction] = useFormState(saveMetrikaSettings, initialState)
  const [token, setToken] = useState("")
  const [counterId, setCounterId] = useState(initialCounterId)
  const [counters, setCounters] = useState<MetrikaCounter[] | null>(null)
  const [loadReason, setLoadReason] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleLoad() {
    setLoadReason(null)
    startTransition(async () => {
      const res = await loadMetrikaCounters(siteId, token)
      if (res.ok) {
        setCounters(res.counters)
        if (res.counters.length === 0) {
          setLoadReason(
            "У этого токена нет доступных счётчиков — проверьте права токена.",
          )
        }
      } else {
        setCounters(null)
        setLoadReason(LOAD_ERROR[res.reason] ?? "Не удалось загрузить счётчики.")
      }
    })
  }

  const selected = counters?.find((c) => c.id === counterId)
  const domainMismatch =
    selected && normHost(selected.domain) !== normHost(siteDomain)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{siteDomain}</CardTitle>
        <CardDescription>
          {isDemo
            ? "Демо-сайт — настройки не влияют на реальные данные."
            : "Подключите счётчик Яндекс.Метрики чтобы дашборд показывал реальную статистику."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form key={siteId} action={formAction} className="space-y-4">
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="counterId" value={counterId} />

          {/* Токен вводится первым — по нему грузим список счётчиков. */}
          <div className="space-y-2">
            <Label htmlFor="token">API-токен</Label>
            <Input
              id="token"
              name="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={initialTokenSet ? "••••••••••••••••••••" : "y0_..."}
              required
            />
            <p className="text-xs text-muted-foreground">
              Создайте OAuth-токен на oauth.yandex.ru с доступом к Метрике
              (read-only).
              {initialTokenSet && " Поле перезапишет существующий токен."}
            </p>
          </div>

          {/* Счётчик выбирается из списка токена (не вводится руками — иначе
              легко указать чужой счётчик опечаткой). */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Счётчик</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLoad}
                disabled={pending}
              >
                {pending ? "Загрузка…" : "Загрузить счётчики"}
              </Button>
            </div>

            {counters && counters.length > 0 ? (
              <select
                value={counterId}
                onChange={(e) => setCounterId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— выберите счётчик —</option>
                {counters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.favorite ? "★ " : ""}
                    {c.name} — {c.domain} · {PERMISSION_LABELS[c.permission] ?? c.permission} (id {c.id})
                  </option>
                ))}
              </select>
            ) : (
              // Список не загружен — показываем текущий счётчик (обратная
              // совместимость: он мог быть введён старым способом).
              <p className="text-sm text-muted-foreground">
                {counterId
                  ? `Текущий счётчик: ${counterId}. Нажмите «Загрузить счётчики», чтобы выбрать из списка.`
                  : "Введите токен и нажмите «Загрузить счётчики»."}
              </p>
            )}

            {loadReason && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                {loadReason}
                {counterId && ` Текущий счётчик (${counterId}) сохранён.`}
              </p>
            )}

            {domainMismatch && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                Счётчик привязан к домену «{selected!.domain}», а сайт — «
                {siteDomain}». Проверьте, тот ли счётчик (сохранить можно —
                поддомены и мультидомен допустимы).
              </p>
            )}
          </div>

          {state?.ok === false && state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          {state?.ok === true && state.message && (
            <p className="text-sm text-green-600">{state.message}</p>
          )}

          <SubmitButton />
        </form>
      </CardContent>
    </Card>
  )
}
