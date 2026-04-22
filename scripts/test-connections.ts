import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as https from 'https'
import * as os from 'os'
import * as path from 'path'

import { Client } from 'pg'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

dotenv.config({ path: '.env.local' })

const YANDEX_CA_URL = 'https://storage.yandexcloud.net/cloud-certs/CA.pem'
const CERT_PATH = path.join(os.homedir(), '.postgresql', 'root.crt')

function downloadCert(): Promise<string> {
  if (fs.existsSync(CERT_PATH)) {
    return Promise.resolve(fs.readFileSync(CERT_PATH, 'utf8'))
  }

  console.log(`Сертификат не найден, скачиваю в ${CERT_PATH}...`)
  const dir = path.dirname(CERT_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(CERT_PATH)
    https.get(YANDEX_CA_URL, (res) => {
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        console.log('Сертификат сохранён.')
        resolve(fs.readFileSync(CERT_PATH, 'utf8'))
      })
    }).on('error', (err) => {
      fs.unlink(CERT_PATH, () => {})
      reject(new Error(
        `Не удалось скачать сертификат: ${err.message}\n` +
        `Скачай вручную: ${YANDEX_CA_URL}\n` +
        `Сохрани в: ${CERT_PATH}`
      ))
    })
  })
}

async function testPostgres(): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    console.log('❌ PostgreSQL FAILED: DATABASE_URL не задан в .env.local')
    return false
  }

  const certContent = fs.readFileSync(CERT_PATH, 'utf8')
  if (!certContent.startsWith('-----BEGIN CERTIFICATE-----')) {
    console.log('❌ Сертификат битый. Удали ~/.postgresql/root.crt и запусти заново')
    process.exit(1)
  }

  const url = new URL(process.env.DATABASE_URL)
  url.searchParams.delete('sslmode')
  const cleanConnectionString = url.toString()

  const client = new Client({
    connectionString: cleanConnectionString,
    ssl: {
      rejectUnauthorized: true,
      ca: certContent,
    },
  })

  try {
    await client.connect()
    const { rows } = await client.query<{ time: Date }>('SELECT NOW() as time')
    console.log(`✅ PostgreSQL OK, текущее время сервера: ${rows[0].time}`)
    return true
  } catch (err) {
    console.log(`❌ PostgreSQL FAILED: ${(err as Error).message}`)
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

async function testObjectStorage(): Promise<boolean> {
  const bucket = process.env.YOS_BUCKET_NAME
  if (!bucket || !process.env.YOS_ACCESS_KEY_ID || !process.env.YOS_SECRET_ACCESS_KEY) {
    console.log('❌ Object Storage FAILED: YOS_BUCKET_NAME, YOS_ACCESS_KEY_ID или YOS_SECRET_ACCESS_KEY не заданы в .env.local')
    return false
  }

  const client = new S3Client({
    region: process.env.YOS_REGION ?? 'ru-central1',
    endpoint: process.env.YOS_ENDPOINT ?? 'https://storage.yandexcloud.net',
    credentials: {
      accessKeyId: process.env.YOS_ACCESS_KEY_ID,
      secretAccessKey: process.env.YOS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  })

  try {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket }))
    console.log(`✅ Object Storage OK, объектов в бакете: ${res.KeyCount ?? 0}`)
    return true
  } catch (err) {
    console.log(`❌ Object Storage FAILED: ${(err as Error).message}`)
    return false
  }
}

async function main() {
  try {
    await downloadCert()
  } catch (err) {
    console.log(`❌ PostgreSQL FAILED: ${(err as Error).message}`)
    process.exit(1)
  }

  const pgOk = await testPostgres()
  const s3Ok = await testObjectStorage()

  if (pgOk && s3Ok) {
    console.log('\n🎉 ЭТАП 0 ЗАКРЫТ')
  } else {
    process.exit(1)
  }
}

main()
