import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// /api/health — дешёвый liveness (всегда 200, БД не трогает).
// /api/health?deep=1 — дополнительно пингует БД (SELECT 1) и кладёт db в тело.
// Используется smoke-тестом деплоя: проверяет путь КОНТЕЙНЕР→БД (SSL-cert в
// рантайм-образе, DATABASE_URL из Lockbox, сеть). Схемо-мисматч ловит отдельный
// CI-гейт миграций; здесь — connectivity. Всегда 200, чтобы liveness не зависел
// от блипа БД; smoke сам проверяет "db":"ok".
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.has("deep")
  let db: "ok" | "error" | "skipped" = "skipped"
  if (deep) {
    try {
      await prisma.$queryRaw`SELECT 1`
      db = "ok"
    } catch {
      db = "error"
    }
  }
  return NextResponse.json({
    status: "ok",
    db,
    timestamp: new Date().toISOString(),
  })
}
