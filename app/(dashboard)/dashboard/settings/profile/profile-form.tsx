"use client"

import { useFormState, useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { updateName, type ActionResult } from "./actions"

const initialState: ActionResult | null = null

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Сохранение..." : "Сохранить"}
    </Button>
  )
}

export function ProfileForm({ initialName }: { initialName: string }) {
  const [state, formAction] = useFormState(updateName, initialState)

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Имя</Label>
        <Input
          id="name"
          name="name"
          defaultValue={initialName}
          required
          autoComplete="name"
        />
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-600">{state.message}</p>}

      <SubmitButton />
    </form>
  )
}
