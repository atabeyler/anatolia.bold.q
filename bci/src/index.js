import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { runMigrations } from './db/migrate.js';

const app = createApp();

app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'BCI API listening');
});

runMigrations().catch((err) => {
  logger.error({ err }, 'BCI startup migrations failed');
});
