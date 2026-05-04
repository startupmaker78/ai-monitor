"use client"

// React 18 pattern: useFormState/useFormStatus from react-dom.
// useActionState (React 19) is not yet in the codebase — staying consistent
// with profile-form.tsx.
import { useFormState, useFormStatus } from "react-dom"
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
import { saveMetrikaSettings, type MetrikaActionResult } from "./actions"

type Props = {
  siteId: string
  siteDomain: string
  isDemo: boolean
  initialCounterId: string
  initialTokenSet: boolean
}

const initialState: MetrikaActionResult | null = null

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
        {/* siteId меняется при выборе из dropdown — key пересоздаёт форму
            с новыми defaultValue, иначе React сохранит предыдущие. */}
        <form
          key={siteId}
          action={formAction}
          className="space-y-4"
        >
          <input type="hidden" name="siteId" value={siteId} />

          <div className="space-y-2">
            <Label htmlFor="counterId">ID счётчика</Label>
            <Input
              id="counterId"
              name="counterId"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="12345678"
              defaultValue={initialCounterId}
              required
            />
            <p className="text-xs text-muted-foreground">
              Найдите в Яндекс.Метрике в разделе «Настройка» → «Счётчик».
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="token">API-токен</Label>
            <Input
              id="token"
              name="token"
              type="password"
              placeholder={
                initialTokenSet
                  ? "••••••••••••••••••••"
                  : "y0_..."
              }
              required
            />
            <p className="text-xs text-muted-foreground">
              Создайте OAuth-токен на oauth.yandex.ru с доступом к Метрике
              (read-only).
              {initialTokenSet && " Поле перезапишет существующий токен."}
            </p>
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
