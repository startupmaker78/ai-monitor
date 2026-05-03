"use server"

import { randomUUID } from "crypto"
import { z } from "zod"
import bcrypt from "bcrypt"
import { Prisma } from "@prisma/client"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { seedDemoSite } from "@/lib/seed-demo"

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

  let userId: string
  let siteId: string

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name,
          role: "OWNER",
        },
      })

      const ownerProfile = await tx.ownerProfile.create({
        data: {
          userId: user.id,
          contractorId: null,
        },
      })

      const site = await tx.site.create({
        data: {
          ownerId: ownerProfile.id,
          domain: "demo.example.com",
          trackingToken: randomUUID().replace(/-/g, ""),
          isDemo: true,
        },
      })

      return { userId: user.id, siteId: site.id }
    })
    userId = result.userId
    siteId = result.siteId
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "Пользователь с таким email уже зарегистрирован" }
    }
    console.error("Signup error:", e)
    return { error: "Не удалось создать аккаунт. Попробуйте позже." }
  }

  // Seed демо-данных в отдельной транзакции. Если упадёт — юзер всё равно
  // сможет залогиниться, увидит пустой дашборд (degraded experience).
  try {
    await seedDemoSite({ siteId, userId })
  } catch (e) {
    console.error("Demo seed error (non-fatal):", e)
  }

  redirect("/login?registered=1")
}
