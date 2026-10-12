import { Worker } from 'bullmq';
import { createQueueConnection, NOTIFICATIONS_QUEUE, NotifyJob } from './lib/queue';
import { fanOut } from './services/notifications';

const worker = new Worker<NotifyJob>(
  NOTIFICATIONS_QUEUE,
  async (job) => {
    const created = await fanOut(job.data);
    console.log(`[${job.data.type}] ${job.id}: ${created} notifications created`);
  },
  { connection: createQueueConnection(), concurrency: 5 },
);

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
});
worker.on('error', (err) => console.error('Worker error:', err.message));

async function shutdown() {
  await worker.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('Notification worker started');