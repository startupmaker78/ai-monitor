import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { validateSiteOwnership } from "@/lib/site-data"
import { fetchMetrikaDaily } from "@/lib/metrika-client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const schema = z.object({ siteId: z.string().min(1) })

const userMessages: Record<string, string> = {
  auth_failed:
    "Токен Метрики недействителен. Проверьте правильность и срок действия.",
  // 403 на этом эндпоинте неоднозначен: и битый токен, и «нет доступа к
  // счётчику» дают 403 (проверено эмпирикой). Поэтому текст комбинированный —
  // как в блоке конверсии, не врём про конкретную причину.
  counter_forbidden:
    "Метрика отклонила запрос — токен недействителен или у него нет доступа к этому счётчику. Проверьте токен; если он рабочий — запросите доступ у владельца счётчика.",
  counter_not_found: "Счётчик не найден или нет доступа.",
  network_error: "Ошибка соединения с Метрикой. Попробуйте позже.",
  invalid_response: "Неожиданный ответ от Метрики.",
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 })
  }

  const owns = await validateSiteOwnership(parsed.data.siteId, session.user.id)
  if (!owns) {
    return NextResponse.json({ error: "site_not_found" }, { status: 404 })
  }

  const site = await prisma.site.findUnique({
    where: { id: parsed.data.siteId },
    select: { metrikaCounterId: true, metrikaToken: true },
  })
  if (!site || !site.metrikaCounterId || !site.metrikaToken) {
    return NextResponse.json(
      {
        error: "metrika_not_configured",
        message:
          "Сначала введите Counter ID и токен в настройках",
      },
      { status: 400 },
    )
  }

  const result = await fetchMetrikaDaily(
    site.metrikaCounterId,
    site.metrikaToken,
  )
  if (!result.ok) {
    console.error(
      `[metrika-sync] siteId=${parsed.data.siteId} error=${result.error} details=${result.details ?? ""}`,
    )
    const httpStatus =
      result.error === "auth_failed"
        ? 401
        : result.error === "counter_forbidden"
          ? 403
          : 502
    return NextResponse.json(
      { error: result.error, message: userMessages[result.error] },
      { status: httpStatus },
    )
  }

  let created = 0
  let updated = 0
  const errors: string[] = []

  for (const snap of result.snapshots) {
    try {
      const r = await prisma.metricsSnapshot.upsert({
        where: {
          siteId_date: { siteId: parsed.data.siteId, date: snap.date },
        },
        create: {
          siteId: parsed.data.siteId,
          date: snap.date,
          visits: snap.visits,
          uniqueVisitors: snap.uniqueVisitors,
          conversions: 0, // MVP: goals не парсим
          bounceRate: snap.bounceRate,
          avgSessionDuration: snap.avgSessionDuration,
          goals: {}, // MVP: empty
        },
        update: {
          visits: snap.visits,
          uniqueVisitors: snap.uniqueVisitors,
          bounceRate: snap.bounceRate,
          avgSessionDuration: snap.avgSessionDuration,
          // НЕ обновляем conversions/goals — на MVP они не используются;
          // в будущих этапах могут парситься отдельным процессом.
        },
      })
      // Эвристика create vs update: если createdAt свежий (<2 сек назад) —
      // считаем create. Точное различение через upsert Prisma не даёт.
      const createdRecently = Date.now() - r.createdAt.getTime() < 2000
      if (createdRecently) created++
      else updated++
    } catch (err) {
      errors.push(
        `${snap.date.toISOString().slice(0, 10)}: ${(err as Error).message}`,
      )
    }
  }

  console.log(
    `[metrika-sync] siteId=${parsed.data.siteId} created=${created} updated=${updated} errors=${errors.length}`,
  )

  return NextResponse.json({
    ok: true,
    snapshotsCreated: created,
    snapshotsUpdated: updated,
    errors: errors.slice(0, 10),
  })
}
