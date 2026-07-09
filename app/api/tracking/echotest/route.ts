// ⚠️ TEMP DIAGNOSTIC ROUTE — DELETE AFTER TEST (2026-07-09).
// Purpose: determine how the YC serverless container proxy mangles
// request bodies (base64 vs utf8-mangle) to decide the gzip transport
// scheme. NOT part of prod logic. Remove app/api/tracking/echotest/
// once the diagnosis is done.
//
// NB: folder is `echotest` (no leading underscore) — App Router treats
// `_`-prefixed folders as private and does NOT route them (→ 404).
import { NextResponse } from "next/server"
import zlib from "node:zlib"
import crypto from "node:crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, route: "echotest alive" })
}

export async function POST(req: Request): Promise<NextResponse> {
  const diag: Record<string, unknown> = {}
  try {
    const buf = Buffer.from(await req.arrayBuffer())
    diag.contentEncoding = req.headers.get("content-encoding")
    diag.contentType = req.headers.get("content-type")
    diag.wireBytes = buf.length
    diag.first8Hex = buf.subarray(0, 8).toString("hex")
    diag.asUtf8First40 = buf.toString("utf8").slice(0, 40)
    diag.sha256Hex = crypto.createHash("sha256").update(buf).digest("hex")

    // Interpretation 1: bytes ARE raw gzip → gunzip succeeds.
    try {
      const inf = zlib.gunzipSync(buf)
      diag.rawGunzipOk = true
      diag.rawInflatedLen = inf.length
    } catch {
      diag.rawGunzipOk = false
    }

    // Interpretation 2: bytes are base64(gzip) text → decode then gunzip.
    try {
      const b64 = Buffer.from(buf.toString("utf8"), "base64")
      const inf2 = zlib.gunzipSync(b64)
      diag.base64DecodeThenGunzipOk = true
      diag.base64InflatedLen = inf2.length
    } catch {
      diag.base64DecodeThenGunzipOk = false
    }

    return NextResponse.json({ ok: true, diag })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message, diag })
  }
}
