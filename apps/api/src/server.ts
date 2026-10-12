import { app } from './app';
import { config } from './lib/config';

app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});