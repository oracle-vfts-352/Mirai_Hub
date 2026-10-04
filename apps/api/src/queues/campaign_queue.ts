import { Queue } from 'bullmq';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

// Instantiate the BullMQ Queue engine backed by our Redis container memory space
export const campaignQueue = new Queue('campaign-blast', {
  connection: {
    host: REDIS_HOST,
    port: REDIS_PORT,
  }
});
