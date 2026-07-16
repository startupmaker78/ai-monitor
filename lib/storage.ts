import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NodeHttpHandler } from "@smithy/node-http-handler"
import { Agent } from "https"

type RequiredEnv =
  | "YOS_BUCKET_NAME"
  | "YOS_ENDPOINT"
  | "YOS_REGION"
  | "YOS_ACCESS_KEY_ID"
  | "YOS_SECRET_ACCESS_KEY"

function readRequiredEnv(name: RequiredEnv): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Yandex Object Storage env var ${name} is not set. ` +
        `Check .env.local in dev or Lockbox secrets in prod.`,
    )
  }
  return value
}

const globalForStorage = globalThis as unknown as {
  s3Client: S3Client | undefined
}

function createS3Client(): S3Client {
  return new S3Client({
    region: readRequiredEnv("YOS_REGION"),
    endpoint: readRequiredEnv("YOS_ENDPOINT"),
    credentials: {
      accessKeyId: readRequiredEnv("YOS_ACCESS_KEY_ID"),
      secretAccessKey: readRequiredEnv("YOS_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: true,
    // Явные таймауты + пул сокетов. Дефолт AWS SDK v3 — БЕЗ таймаутов
    // (бесконечное ожидание): подвисший сокет к YOS из контейнера висел
    // вечно → пре-процессор (до 50 параллельных getJson) деадлочил на
    // >300с, Gateway отдавал 504 (инцидент 2026-07-15). Теперь подвисшее
    // соединение падает за 3-10с → SDK ретраит (self-heal transient) или
    // чисто ошибается. maxSockets 64 > 50 concurrent (SESSION×PACKET) =
    // запас в пуле. Величины безопасны для всех операций: пакеты ≤~3 MiB
    // (putJson/getJson) уходят за секунды; presigned-URL генерится
    // локально (сети нет); list/delete — мелкие. keepAlive — переиспольз.
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 3000,
      // throwOnRequestTimeout: без него requestTimeout ТОЛЬКО логирует WARN,
      // а запрос на протухшем keep-alive сокете (YOS/egress молча роняет
      // idle-соединение, singleton-клиент переиспользует «мёртвый») висит
      // дальше → деадлок сбора на 300с/60с (инцидент 2026-07-15). С флагом:
      // обрыв за 10с → SDK ретраит на СВЕЖЕМ сокете → self-heal.
      requestTimeout: 10000,
      throwOnRequestTimeout: true,
      httpsAgent: new Agent({ keepAlive: true, maxSockets: 64 }),
    }),
  })
}

function createLazyS3Client(): S3Client {
  let instance: S3Client | undefined

  return new Proxy({} as S3Client, {
    get(_target, prop) {
      if (!instance) {
        instance = globalForStorage.s3Client ?? createS3Client()
        if (process.env.NODE_ENV !== "production") {
          globalForStorage.s3Client = instance
        }
      }
      return Reflect.get(instance, prop, instance)
    },
  })
}

export const s3Client: S3Client = createLazyS3Client()

export function getBucketName(): string {
  return readRequiredEnv("YOS_BUCKET_NAME")
}

export async function putJson(
  key: string,
  data: unknown,
  contentType: string = "application/json; charset=utf-8",
): Promise<{ key: string; etag: string | undefined }> {
  const body = JSON.stringify(data)
  const result = await s3Client.send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
  return { key, etag: result.ETag }
}

// Presigned GET URL для прямой скачки объекта клиентом через
// storage.yandexcloud.net, минуя наш API Gateway (у которого response
// body cap ~3.5 MB). Используем для отдачи rrweb-пакетов сессии в
// player: response endpoint'а /api/sessions/[id]/events содержит
// только массив URL'ов, а сами объекты (по 1-2 MiB каждый) браузер
// стягивает параллельно с YOS.
//
// ⚠️ Bucket должен иметь CORS-policy разрешающую GET от нашего origin
// (staging.вебмонитор.рф / production). Иначе браузер заблокирует
// чтение response body несмотря на успешный 200 от YOS.
export async function getPresignedGetUrl(
  key: string,
  expiresInSeconds: number = 300,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  })
  // Cast через Parameters<> — @aws-sdk/client-s3 и
  // @aws-sdk/s3-request-presigner тянут разные копии @smithy/types
  // в дереве, из-за чего TS видит их S3Client как несовместимые типы
  // (private property `handlers` объявлена отдельно в каждой копии).
  // Runtime-совместимость гарантирована — оба используют одинаковый
  // signing protocol.
  const client = s3Client as unknown as Parameters<typeof getSignedUrl>[0]
  return await getSignedUrl(client, command, {
    expiresIn: expiresInSeconds,
  })
}

export async function getJson<T = unknown>(key: string): Promise<T> {
  const result = await s3Client.send(
    new GetObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    }),
  )
  if (!result.Body) {
    throw new Error(`Object Storage: empty body for key ${key}`)
  }
  const text = await result.Body.transformToString("utf-8")
  return JSON.parse(text) as T
}

export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = []
  let continuationToken: string | undefined

  do {
    const result = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: getBucketName(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    )
    if (result.Contents) {
      for (const item of result.Contents) {
        if (item.Key) keys.push(item.Key)
      }
    }
    continuationToken = result.IsTruncated
      ? result.NextContinuationToken
      : undefined
  } while (continuationToken)

  return keys
}

export async function deleteObject(key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    }),
  )
}

// Удаляет до 1000 объектов одним batch-запросом.
// S3 API limit: 1000 ключей за вызов.
// Возвращает массив ключей которые НЕ удалились (errors).
export async function deleteObjects(keys: string[]): Promise<string[]> {
  if (keys.length === 0) return []
  if (keys.length > 1000) {
    throw new Error("deleteObjects: max 1000 keys per call")
  }
  const result = await s3Client.send(
    new DeleteObjectsCommand({
      Bucket: getBucketName(),
      Delete: {
        Objects: keys.map((Key) => ({ Key })),
        Quiet: true,
      },
    }),
  )
  return (result.Errors ?? []).map((e) => e.Key ?? "<unknown>")
}
