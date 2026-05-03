import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3"

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
