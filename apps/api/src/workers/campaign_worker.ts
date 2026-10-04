import { Worker, Job } from 'bullmq';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

/**
 * 🐂 BULLMQ BACKGROUND ASYNC WORKER
 * Explicitly exported as a constant function to clear the runtime resolution error!
 */
export const startCampaignWorker = function(): void {
  const worker = new Worker(
    'campaign-blast',
    async (job: Job) => {
      const { campaignId, title, type, content, companyId } = job.data;
      
      console.log(`\n[📥 WORKER DETECTED JOB] Starting task execution for Job #${job.id}`);
      console.log(`🏢 Tenant Isolation Context: Company ID -> ${companyId}`);
      console.log(`📢 Title: "${title}" | Mode: [${type.toUpperCase()}]`);

      console.log(`⏳ Processing and deploying campaign payloads...`);
      await new Promise((resolve) => setTimeout(resolve, 3500)); // Simulates intensive workload

      console.log(`✅ [JOB SUCCESSFUL] Campaign "${title}" (ID: ${campaignId}) successfully broadcasted!\n`);
      return { success: true, processedAt: new Date() };
    },
    {
      connection: {
        host: REDIS_HOST,
        port: REDIS_PORT,
      }
    }
  );

  worker.on('completed', (job) => {
    console.log(`🎉 Job #${job.id} officially marked COMPLETED inside Redis state storage.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`🚨 Job #${job?.id} FAILED with exception parameters:`, err.message);
  });

  console.log('🏁 🐂 BullMQ Campaign Background Worker initialized and listening for incoming Redis segments...');
};
