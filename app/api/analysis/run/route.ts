import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import {
  runAnalysis,
  type RunAnalysisError,
} from "@/lib/analysis-runner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const schema = z.object({ targetId: z.string().min(1) })

const ERROR_TO_HTTP: Record<RunAnalysisError, number> = {
  unauthorized: 401,
  target_not_found: 404,
  not_enough_sessions: 409,
  no_sessions: 422,
  no_interactions: 422,
  collect_timeout: 503,
  monthly_limit: 429,
  race_condition: 409,
  provider_denied: 502,
  relay_unavailable: 503,
  claude_retriable: 502,
  claude_invalid: 502,
  internal: 500,
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "unauthorized", message: "Не авторизован" },
      { status: 401 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "Невалидный JSON" },
      { status: 400 },
    )
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", message: "Не указан targetId" },
      { status: 400 },
    )
  }

  // Гейт «завершённая страница» — ДО вызова runAnalysis (analysis-runner —
  // Path M, не трогаем; ставим отбой в обёртке). Завершённая = уже есть
  // DONE-анализ И собрано >= бюджета. Такая страница замерла: новых сессий
  // не будет (оба гейта сбора закрыты), повтор прогнал бы ТЕ ЖЕ данные и
  // сжёг бы слот месячного лимита. Единственная точка входа в runAnalysis —
  // этот роут (проверено), поэтому гейт здесь неминуем.
  // Цель ищем в scope владельца и НЕ архивную: если не найдена (чужая /
  // архивная / несуществующая) — не отбиваем тут, пусть runAnalysis отдаст
  // свой target_not_found (не плодим утечку существования и дубль логики).
  const gateTarget = await prisma.analysisTarget.findFirst({
    where: {
      id: parsed.data.targetId,
      archivedAt: null,
      site: { ownerId: session.user.id },
    },
    select: {
      sessionsCollected: true,
      sessionsBudget: true,
      analyses: { where: { status: "DONE" }, select: { id: true }, take: 1 },
    },
  })
  if (
    gateTarget &&
    gateTarget.analyses.length > 0 &&
    gateTarget.sessionsCollected >= gateTarget.sessionsBudget
  ) {
    return NextResponse.json(
      {
        error: "already_completed",
        message:
          "Сбор по этой странице завершён — новых сессий больше не будет. " +
          "Повторный анализ прогнал бы те же данные и потратил бы слот из " +
          "месячного лимита. Откройте рекомендации по странице или заведите " +
          "новую страницу.",
      },
      { status: 409 },
    )
  }

  const result = await runAnalysis(session.user.id, parsed.data.targetId)

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        message: result.message,
        analysisId: result.analysisId,
      },
      { status: ERROR_TO_HTTP[result.error] ?? 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    analysisId: result.analysisId,
    recommendationsCount: result.recommendationsCount,
  })
}
