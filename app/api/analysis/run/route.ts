import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/auth"
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
  target_not_ready: 409,
  previous_recs_open: 409,
  monthly_limit: 429,
  race_condition: 409,
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
