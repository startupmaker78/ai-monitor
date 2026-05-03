"use client"

import { useEffect, useRef } from "react"
import { useFormState, useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { updatePassword, type ActionResult } from "./actions"

const initialState: ActionResult | null = null

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Сохранение..." : "Изменить пароль"}
    </Button>
  )
}

export function PasswordForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction] = useFormState(updatePassword, initialState)

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset()
    }
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="currentPassword">Текущий пароль</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="newPassword">Новый пароль</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <p className="text-xs text-muted-foreground">Минимум 8 символов</p>
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-600">{state.message}</p>}

      <SubmitButton />
    </form>
  )
}
