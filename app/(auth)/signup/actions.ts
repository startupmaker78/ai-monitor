"use server"

import { z } from "zod"
import bcrypt from "bcrypt"
import { Prisma } from "@prisma/client"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"

const signupSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(8, "Пароль должен быть минимум 8 символов"),
  name: z.string().min(1, "Имя не может быть пустым").max(100, "Имя слишком длинное"),
})

export type SignupState = {
  error?: string
  fieldErrors?: {
    email?: string[]
    password?: string[]
    name?: string[]
  }
}

export async function signup(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
  }

  const parsed = signupSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const { email, password, name } = parsed.data
  const passwordHash = await bcrypt.hash(password, 10)

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name,
          role: "OWNER",
        },
      })

      await tx.ownerProfile.create({
        data: {
          userId: user.id,
          contractorId: null,
        },
      })
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "Пользователь с таким email уже зарегистрирован" }
    }
    console.error("Signup error:", e)
    return { error: "Не удалось создать аккаунт. Попробуйте позже." }
  }

  redirect("/login?registered=1")
}
