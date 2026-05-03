import * as dotenv from 'dotenv'

import { putJson, getJson, listKeys, deleteObject } from '../lib/storage'

dotenv.config({ path: '.env.local' })

async function main() {
  const ts = Date.now()
  const key = `test/lib-storage-smoke-${ts}.json`
  const payload = { hello: 'world', ts }

  const put = await putJson(key, payload)
  if (put.key !== key) {
    throw new Error(`putJson returned wrong key: ${put.key}`)
  }

  const got = await getJson<typeof payload>(key)
  if (got.hello !== 'world' || got.ts !== ts) {
    throw new Error(`getJson roundtrip mismatch: ${JSON.stringify(got)}`)
  }

  const keys = await listKeys('test/')
  if (!keys.includes(key)) {
    throw new Error(
      `listKeys did not return ${key}, got ${keys.length} keys`,
    )
  }

  await deleteObject(key)

  const keysAfter = await listKeys('test/')
  if (keysAfter.includes(key)) {
    throw new Error(`deleteObject did not remove ${key}`)
  }

  console.log('✅ lib/storage.ts works')
}

main().catch((err) => {
  console.error(`❌ ${(err as Error).message}`)
  process.exit(1)
})
