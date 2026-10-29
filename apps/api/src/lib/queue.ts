import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { NotificationType, Prisma } from '@prisma/client';
import { config } from './config';
import { prisma } from './prisma';

export const NOTIFICATIONS_QUEUE = 'notifications';

export type NotifyJob = {
  type: NotificationType;
  projectId: string;
  refId: string; // feedback id or post id
  dedupeKey: string; // same event => same key, so retries never double-notify
};

// Accepts the global client or a transaction client.
type OutboxDb = Pick<Prisma.TransactionClient, 'outboxEvent'>;

// BullMQ needs its own connection with maxRetriesPerRequest: null
export function createQueueConnection() {
  return new Redis(config.redisUrl, { maxRetriesPerRequest: null });
}

let queue: Queue<NotifyJob> | undefined;

function getQueue() {
  if (!queue) {
    queue = new Queue<NotifyJob>(NOTIFICATIONS_QUEUE, {
      connection: createQueueConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
    queue.on('error', (err) => console.error('Queue error:', err.message));
  }
  return queue;
}

// Records the event in the outbox table (the API never talks to Redis for this).
// Pass a transaction client so the row commits or rolls back together with the user's action.
// skipDuplicates: the same dedupeKey twice (e.g. a reply deleted and rewritten) is a no-op.
export async function enqueueNotification(job: NotifyJob, db: OutboxDb = prisma) {
  await db.outboxEvent.createMany({ data: [job], skipDuplicates: true });
}

// Used by the outbox relay only. Throws on failure, so the row stays unpublished and is retried.
// jobId must not contain ":"; the dedupeKeys use "-" only.
export async function publishNotification(job: NotifyJob) {
  await getQueue().add('fan-out', job, { jobId: job.dedupeKey });
}