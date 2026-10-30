import * as dotenv from 'dotenv';
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwtSecret: required('JWT_SECRET'),
  redisUrl: required('REDIS_URL'),
  rpId: required('RP_ID'),
  origin: required('ORIGIN'),
};

// Object storage for images (SeaweedFS locally, Cloudflare R2 in production).
// Read lazily on first use: the worker, the tests and CI never touch storage,
// so they don't need these variables.
export function storageConfig() {
  return {
    endpoint: required('S3_ENDPOINT'),
    region: process.env.S3_REGION || 'us-east-1', // R2 uses "auto"
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    bucket: required('S3_BUCKET'),
    publicUrl: required('MEDIA_PUBLIC_URL').replace(/\/+$/, ''), // no trailing slash
  };
}

// Outgoing mail over plain SMTP (Mailpit locally; any provider in production, chosen at deploy time).
// Read lazily on first use, like storageConfig(). SMTP_USER and SMTP_PASS are only needed for providers.
export function smtpConfig() {
  return {
    host: required('SMTP_HOST'),
    port: Number(process.env.SMTP_PORT) || 1025,
    secure: process.env.SMTP_SECURE === 'true', // true = TLS from the start (usually port 465)
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: required('SMTP_FROM'),
  };
}