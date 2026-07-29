"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { validateSiteOwnership } from "@/lib/site-data"
import { fetchMetrikaCounters, type CountersResult } from "@/lib/metrika-goals"

const schema = z.object({
  siteId: z.string().min(1),
  counterId: z
    .string()
    .regex(/^\d+$/, "Counter ID должен быть числом")
    .min(1)
    .max(20),
  token: z
    .string()
    .min(30, "Токен слишком короткий — проверьте что скопировали полностью")
    .max(200),
})

export type MetrikaActionResult = {
  ok: boolean
  message?: string
  error?: string
}

export async function saveMetrikaSettings(
  _prevState: MetrikaActionResult | null,
  formData: FormData,
): Promise<MetrikaActionResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: "Не авторизован" }

  const parsed = schema.safeParse({
    siteId: formData.get("siteId"),
    counterId: formData.get("counterId"),
    token: formData.get("token"),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message }
  }

  // Критично: проверка что siteId принадлежит юзеру.
  const owns = await validateSiteOwnership(
    parsed.data.siteId,
    session.user.id,
  )
  if (!owns) return { ok: false, error: "Сайт не найден" }

  await prisma.site.update({
    where: { id: parsed.data.siteId },
    data: {
      metrikaCounterId: parsed.data.counterId,
      metrikaToken: parsed.data.token,
    },
  })

  revalidatePath("/dashboard/settings/metrika")
  revalidatePath("/dashboard")

  return {
    ok: true,
    message: "Настройки сохранены. Откройте дашборд чтобы запустить синхронизацию.",
  }
}

// Ленивая загрузка счётчиков для дропдауна. Токен: введённый в форме (если
// передан) ИЛИ сохранённый в Site (тогда клиент токен не шлёт — читаем из БД).
// 403/протухший токен → внятный reason (CountersResult), не пустой список.
export async function loadMetrikaCounters(
  siteId: string,
  enteredToken: string,
): Promise<CountersResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, reason: "auth_failed" }

  const owns = await validateSiteOwnership(siteId, session.user.id)
  if (!owns) return { ok: false, reason: "counter_forbidden" }

  let token = enteredToken.trim()
  if (!token) {
    // Токен не ввели — пробуем сохранённый (для повторного выбора счётчика
    // без повторного ввода). В клиент токен не отдаём — только используем.
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { metrikaToken: true },
    })
    if (!site?.metrikaToken) return { ok: false, reason: "auth_failed" }
    token = site.metrikaToken
  }
  return fetchMetrikaCounters(token)
}
