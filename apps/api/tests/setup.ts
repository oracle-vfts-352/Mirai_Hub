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