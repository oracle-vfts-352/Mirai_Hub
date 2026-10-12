import { defineConfig } from 'vitest/config';
import { TEST_ENV } from './tests/env.ts';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    env: TEST_ENV,
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false, // all files share one database, so run them one at a time
    clearMocks: true,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});