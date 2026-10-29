import * as dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Reads one value from apps/api/.env WITHOUT loading the whole file into process.env.
// Tests run from apps/api (npm test), so the file is in the current folder.
function fromEnvFile(name: string): string | undefined {
  const file = resolve(process.cwd(), '.env');
  if (!existsSync(file)) return undefined;
  return dotenv.parse(readFileSync(file))[name];
}

// Local runs: TEST_DATABASE_URL in apps/api/.env. CI: set in the workflow. No fallback password here.
const url = process.env.TEST_DATABASE_URL ?? fromEnvFile('TEST_DATABASE_URL');
if (!url) {
  throw new Error('TEST_DATABASE_URL is required (add it to apps/api/.env, database name mirai_hub_test)');
}
if (new URL(url).pathname !== '/mirai_hub_test') {
  throw new Error('TEST_DATABASE_URL must point at the database "mirai_hub_test"');
}

export const TEST_DB_URL = url;

export const TEST_ENV = {
  NODE_ENV: 'test', // also switches the rate limiters off
  DATABASE_URL: TEST_DB_URL,
  REDIS_URL: 'redis://localhost:6380',
  JWT_SECRET: 'test-only-secret-test-only-secret-test-only-secret',
  RP_ID: 'localhost',
  ORIGIN: 'http://localhost:5173',
  ENABLE_DEV_LOGIN: 'true',
};