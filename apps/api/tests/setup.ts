import { vi } from 'vitest';

// Tests must never touch the dev database: build the Prisma client with the test URL explicitly.
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client');
  const { TEST_DB_URL } = await import('./env');
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DB_URL }) };
});

// enqueueNotification is a spy around the REAL function: it records the call AND writes the
// outbox row (so transactions and rollbacks are really tested). Publishing to Redis is faked.
vi.mock('../src/lib/queue', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/queue')>('../src/lib/queue');
  return {
    enqueueNotification: vi.fn(actual.enqueueNotification),
    publishNotification: vi.fn(async () => undefined),
  };
});

// Tests never touch object storage either; URLs are predictable.
vi.mock('../src/lib/storage', () => ({
  putObject: vi.fn(async () => undefined),
  deleteObject: vi.fn(async () => undefined),
  ensureBucket: vi.fn(async () => undefined),
  publicUrl: (key: string) => `http://media.test/${key}`,
  mediaUrl: (key: string | null | undefined) => (key ? `http://media.test/${key}` : null),
}));