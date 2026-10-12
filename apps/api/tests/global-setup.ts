import { spawnSync } from 'node:child_process';
import { TEST_ENV } from './env';

// Runs once before all tests: applies migrations to the test database.
export default function setup() {
  if (!TEST_ENV.DATABASE_URL.includes('mirai_hub_test')) {
    throw new Error('Refusing to run: DATABASE_URL must point at mirai_hub_test');
  }

  const res = spawnSync(
    'npx prisma migrate deploy --schema=../../packages/database/schema.prisma',
    { cwd: process.cwd(), shell: true, encoding: 'utf8', env: { ...process.env, DATABASE_URL: TEST_ENV.DATABASE_URL } },
  );
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;

  // Judge by the output, not the exit code: Prisma on Node 24 prints a harmless UV_HANDLE_CLOSING assertion at exit.
  if (!/No pending migrations|successfully applied/i.test(out)) {
    throw new Error(`Could not migrate the test database:\n${out}`);
  }
}