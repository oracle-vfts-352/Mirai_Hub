import * as dotenv from 'dotenv';
import { startCampaignWorker } from './workers/campaign_worker';

dotenv.config();

console.log('⚡ Starting detached background processing thread...');
startCampaignWorker();
