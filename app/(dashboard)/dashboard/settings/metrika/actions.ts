"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { validateSiteOwnership } from "@/lib/site-data"
import { verifyMetrikaCounter } from "@/lib/metrika-goals"

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
  ok: boolean // прошла ли валидация (false → красная ошибка, не сохранено)
  error?: string // pre-save ошибка (валидация/владение) — красным
  // Пост-сохранение: результат тест-вызова связи. Сохраняем ВСЕГДА (решено:
  // даёт починить одно поле позже), но зелёным — только реальный успех.
  status?: "connected" | "warn" // connected → зелёное, warn → янтарное
  message?: string
  showTokenGuide?: boolean // при auth_failed — ссылка на гайд #token
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

  // Тест-вызов ДО записи (с таймаутом внутри) — но сохраняем в любом случае:
  // даже при неудачной проверке поля остаются, чтобы починить одно из них
  // позже, не вводя оба заново. Зелёным — только реальный успех.
  const verify = await verifyMetrikaCounter(
    parsed.data.counterId,
    parsed.data.token,
  )

  await prisma.site.update({
    where: { id: parsed.data.siteId },
    data: {
      metrikaCounterId: parsed.data.counterId,
      metrikaToken: parsed.data.token,
    },
  })

  revalidatePath("/dashboard/settings/metrika")
  revalidatePath("/dashboard")

  if (verify.ok) {
    return {
      ok: true,
      status: "connected",
      message: `Подключено, счётчик отвечает. Целевых действий найдено: ${verify.goalCount}. Откройте дашборд, чтобы запустить синхронизацию.`,
    }
  }

  // Сохранили, но связь не подтвердилась — каждое сообщение говорит, ЧТО делать.
  const warn: Record<string, { message: string; showTokenGuide?: boolean }> = {
    auth_failed: {
      message:
        "Сохранили, но токен недействителен. Создайте новый токен и вставьте его сюда.",
      showTokenGuide: true,
    },
    // 403 неоднозначен (битый токен ИЛИ нет доступа) — на этом эндпоинте оба
    // дают 403, проверено эмпирикой. Текст покрывает оба; гайд по токену тоже
    // показываем (вдруг всё же токен).
    counter_forbidden: {
      message:
        "Сохранили, но Метрика отклонила запрос: токен недействителен или у него нет доступа к этому счётчику. Проверьте токен или запросите доступ у владельца счётчика.",
      showTokenGuide: true,
    },
    counter_not_found: {
      message:
        "Сохранили, но счётчик не найден. Проверьте ID счётчика в Метрике: Настройки → Счётчик.",
    },
    rate_limited: {
      message:
        "Сохранили, но проверить связь не удалось — Метрика ограничила запросы. Попробуйте сохранить ещё раз через минуту.",
    },
    metrika_unavailable: {
      message:
        "Сохранили, но проверить связь не смогли — Метрика не ответила. Попробуйте сохранить ещё раз через минуту.",
    },
  }
  const w = warn[verify.reason] ?? warn.metrika_unavailable
  return {
    ok: true,
    status: "warn",
    message: w.message,
    showTokenGuide: w.showTokenGuide,
  }
}
