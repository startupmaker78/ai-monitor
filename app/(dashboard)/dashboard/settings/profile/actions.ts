"use server"

import { z } from "zod"
import bcrypt from "bcrypt"
import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const updateNameSchema = z.object({
  name: z
    .string()
    .min(1, "Имя не может быть пустым")
    .max(100, "Слишком длинное имя"),
})

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Введите текущий пароль"),
  newPassword: z.string().min(8, "Минимум 8 символов"),
})

export type ActionResult = {
  ok: boolean
  message?: string
  error?: string
}

export async function updateName(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: "Не авторизован" }

  const parsed = updateNameSchema.safeParse({
    name: formData.get("name"),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name },
  })

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/settings/profile")

  return { ok: true, message: "Имя обновлено" }
}

export async function updatePassword(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: "Не авторизован" }

  const parsed = updatePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message }
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  })

  if (!user) return { ok: false, error: "Пользователь не найден" }

  const isValid = await bcrypt.compare(
    parsed.data.currentPassword,
    user.passwordHash,
  )
  if (!isValid) {
    return { ok: false, error: "Неверный текущий пароль" }
  }

  const newHash = await bcrypt.hash(parsed.data.newPassword, 10)

  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash: newHash },
  })

  return { ok: true, message: "Пароль обновлён" }
}
