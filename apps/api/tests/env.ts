// Local throwaway values for the test run only. The database name must stay "mirai_hub_test".
export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://mirai_admin:secure_postgres_pass@localhost:5433/mirai_hub_test?schema=public';

export const TEST_ENV = {
  NODE_ENV: 'test', // also switches the rate limiters off
  DATABASE_URL: TEST_DB_URL,
  REDIS_URL: 'redis://localhost:6380',
  JWT_SECRET: 'test-only-secret-test-only-secret-test-only-secret',
  RP_ID: 'localhost',
  ORIGIN: 'http://localhost:5173',
  ENABLE_DEV_LOGIN: 'true',
};