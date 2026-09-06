import { defineConfig } from 'vitest/config';

// Pure architecture/normalization checks that do not require PostgreSQL.
// The complete suite remains configured in vitest.config.js.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/analysisPlanner.test.js', 'test/normalize.test.js', 'test/engines.activeScan.test.js'],
    fileParallelism: false,
    env: { NODE_ENV: 'test', BCI_JWT_SECRET: 'test-secret', LOG_LEVEL: 'silent' },
  },
});
