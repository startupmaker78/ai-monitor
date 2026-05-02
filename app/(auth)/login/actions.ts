"use server"

import { signIn } from "@/auth"
import { AuthError } from "next-auth"
import { z } from "zod"
import { redirect } from "next/navigation"

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

  redirect("/dashboard")
}
