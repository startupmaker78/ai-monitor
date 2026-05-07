"use server"

import { signIn } from "@/auth"
import { AuthError } from "next-auth"
import { z } from "zod"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"

const loginSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(1, "Введите пароль"),
})

export type LoginState = {
  error?: string
  fieldErrors?: {
    email?: string[]
    password?: string[]
  }
}

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
  }

  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: "Неверный email или пароль" }
    }
    console.error("Login error:", e)
    return { error: "Не удалось войти. Попробуйте позже." }
  }

  // Onboarding-redirect: новые юзеры (0 не-демо Sites) сразу попадают на
  // страницу подключения сайта вместо пустого дашборда. Старые юзеры с
  // подключёнными сайтами идут на /dashboard как раньше.
  //
  // Лукап через email (не через auth()) — cookies от signIn ещё не попадут
  // в текущий request, добираемся до user-id напрямую.
  let redirectTo = "/dashboard"
  try {
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { ownerProfile: { select: { id: true } } },
    })
    const ownerProfileId = user?.ownerProfile?.id
    if (ownerProfileId) {
      const sitesCount = await prisma.site.count({
        where: { ownerId: ownerProfileId, isDemo: false },
      })
      if (sitesCount === 0) {
        redirectTo = "/dashboard/settings/sites"
      }
    }
  } catch (e) {
    // Не критично: если лукап упал — просто идём на /dashboard, там есть
    // empty state на 0 sites.
    console.warn("Login post-signin redirect lookup failed:", e)
  }

  redirect(redirectTo)
}
