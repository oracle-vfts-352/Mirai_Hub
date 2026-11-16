import { app } from './app';
import { config } from './lib/config';

app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});

// Demo deployment: no separate worker process. Loading run-worker starts the BullMQ
// worker, the outbox relay and the orphan cleanup inside this process.
if (process.env.RUN_WORKER === 'true') {
  try {
    require('./run-worker');
    console.log('Embedded worker started');
  } catch (err) {
    console.error('Embedded worker failed:', err);
  }
}