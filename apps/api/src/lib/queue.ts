import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { NotificationType } from '@prisma/client';
import { config } from './config';

export const NOTIFICATIONS_QUEUE = 'notifications';

export type NotifyJob = {
  type: NotificationType;
  projectId: string;
  refId: string; // feedback id or post id
  dedupeKey: string; // same event => same key, so retries never double-notify
};

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

// Never throws: the user's action already succeeded, a queue hiccup must not turn it into a 500.
export async function enqueueNotification(job: NotifyJob) {
  try {
    // jobId must not contain ":"; the dedupeKeys below use "-" only
    await getQueue().add('fan-out', job, { jobId: job.dedupeKey });
  } catch (err) {
    console.error('Failed to enqueue notification:', err);
  }
}