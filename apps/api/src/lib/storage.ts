import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { storageConfig } from './config';

let cached: { client: S3Client; cfg: ReturnType<typeof storageConfig> } | undefined;

function get() {
  if (!cached) {
    const cfg = storageConfig();
    const client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: true, // bucket in the path: works for SeaweedFS and R2
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Newer SDK versions add checksum headers that some S3-compatible services reject
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    cached = { client, cfg };
  }
  return cached;
}

// Keys must be unique per upload (e.g. avatars/{userId}/{uuid}.webp), so the long cache time is safe.
export async function putObject(key: string, body: Buffer, contentType: string) {
  const { client, cfg } = get();
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

// Best effort: a leftover object is a storage cost, not a reason to fail the user's request.
export async function deleteObject(key: string) {
  try {
    const { client, cfg } = get();
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
  } catch (err) {
    console.error('Failed to delete object:', key, err);
  }
}

// The browser loads images straight from here, not through the API.
export function publicUrl(key: string) {
  return `${get().cfg.publicUrl}/${key}`;
}

// Dev helper: creates the bucket if it doesn't exist (in production the bucket is made in Cloudflare).
export async function ensureBucket() {
  const { client, cfg } = get();
  try {
    await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw err;
  }
}