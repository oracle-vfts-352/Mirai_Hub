import { vi } from 'vitest';

// Tests must never touch the dev database: build the Prisma client with the test URL explicitly.
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client');
  const { TEST_DB_URL } = await import('./env');
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DB_URL }) };
});

// Tests check that a job was requested, they never touch the real queue.
vi.mock('../src/lib/queue', () => ({
  enqueueNotification: vi.fn(async () => undefined),
}));

// Tests never touch object storage either; URLs are predictable.
vi.mock('../src/lib/storage', () => ({
  putObject: vi.fn(async () => undefined),
  deleteObject: vi.fn(async () => undefined),
  ensureBucket: vi.fn(async () => undefined),
  publicUrl: (key: string) => `http://media.test/${key}`,
  mediaUrl: (key: string | null | undefined) => (key ? `http://media.test/${key}` : null),
}));