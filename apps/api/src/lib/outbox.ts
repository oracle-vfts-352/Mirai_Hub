import { prisma } from './prisma';
import { publishNotification } from './queue';

const BATCH = 100;
const POLL_MS = 1000;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const PURGE_EVERY_MS = 60 * 60 * 1000;

// Publishes one batch of unpublished events to BullMQ, oldest first.
// If publishing fails midway, the ones already published are still marked, and the error is rethrown.
export async function relayOnce(): Promise<number> {
  const rows = await prisma.outboxEvent.findMany({
    where: { publishedAt: null },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });

  const done: string[] = [];
  try {
    for (const r of rows) {
      await publishNotification({
        type: r.type,
        projectId: r.projectId,
        refId: r.refId,
        dedupeKey: r.dedupeKey,
      });
      done.push(r.id);
    }
  } finally {
    if (done.length) {
      await prisma.outboxEvent.updateMany({
        where: { id: { in: done } },
        data: { publishedAt: new Date() },
      });
    }
  }
  return done.length;
}

export async function purgePublished() {
  const res = await prisma.outboxEvent.deleteMany({
    where: { publishedAt: { lt: new Date(Date.now() - KEEP_MS) } },
  });
  return res.count;
}

// Polls the outbox. Returns a function that stops it.
export function startOutboxRelay() {
  let busy = false;
  let lastPurge = 0;

  const timer = setInterval(async () => {
    if (busy) return; // never overlap ticks
    busy = true;
    try {
      while ((await relayOnce()) === BATCH) {
        // more waiting: keep going
      }
      if (Date.now() - lastPurge > PURGE_EVERY_MS) {
        lastPurge = Date.now();
        await purgePublished();
      }
    } catch (err) {
      console.error('Outbox relay error:', err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  }, POLL_MS);

  return () => clearInterval(timer);
}