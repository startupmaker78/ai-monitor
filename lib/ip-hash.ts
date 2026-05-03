import { createHash } from "crypto"

// 152-ФЗ: оригинальный IP не сохраняется. Salt из env, ротации не предусмотрено
// (см. .env.local: "после установки никогда не меняй — иначе все хэши
// инвалидируются").
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT
  if (!salt) {
    throw new Error(
      "IP_HASH_SALT is not set. Required for hashing client IPs (152-ФЗ).",
    )
  }
  return createHash("sha256").update(ip + ":" + salt).digest("hex")
}

// За прокси (Yandex API Gateway → Serverless Container) реальный IP клиента
// приходит в X-Forwarded-For (список через запятую, первый = клиент).
// На локали без прокси берём из NextRequest.ip или fallback "0.0.0.0".
export function extractClientIp(req: {
  headers: { get(name: string): string | null }
  ip?: string | null
}): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0].trim()
    if (first) return first
  }
  const xreal = req.headers.get("x-real-ip")
  if (xreal) return xreal.trim()
  if ("ip" in req && req.ip) return req.ip
  return "0.0.0.0"
}
