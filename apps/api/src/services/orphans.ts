import { prisma } from '../lib/prisma';

const MAX_AGE_MS = 60 * 60 * 1000; // an hour: far longer than the 10-minute enroll window
const EVERY_MS = 10 * 60 * 1000;

// Deletes accounts that never finished passkey signup: no passkey, older than an hour,
// and no footprint (projects and feedback have no cascade and would block the delete anyway).
// Passkeys, votes, follows and notifications cascade, but an account with any of them is kept.
export async function cleanupOrphans(maxAgeMs = MAX_AGE_MS): Promise<number> {
  const res = await prisma.user.deleteMany({
    where: {
      createdAt: { lt: new Date(Date.now() - maxAgeMs) },
      passkeys: { none: {} },
      projects: { none: {} },
      feedback: { none: {} },
      follows: { none: {} },
      votes: { none: {} },
    },
  });
  return res.count;
}

// Runs once at start, then every 10 minutes. Returns a function that stops it.
export function startOrphanCleanup() {
  let busy = false;

  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const removed = await cleanupOrphans();
      if (removed > 0) console.log(`Orphan cleanup: removed ${removed} unfinished signup(s)`);
    } catch (err) {
      console.error('Orphan cleanup error:', err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  };

  void run();
  const timer = setInterval(run, EVERY_MS);
  return () => clearInterval(timer);
}