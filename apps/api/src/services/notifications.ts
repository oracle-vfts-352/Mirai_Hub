import { NotificationType } from '@prisma/client';
import { prisma } from '../lib/prisma';

const BATCH = 500;

// Inserts one Notification per follower (except the project owner), in batches.
// Safe to run twice: the unique (userId, dedupeKey) + skipDuplicates ignores repeats.
export async function fanOut(job: {
  type: NotificationType;
  projectId: string;
  refId: string;
  dedupeKey: string;
}) {
  const project = await prisma.project.findUnique({
    where: { id: job.projectId },
    select: { ownerId: true },
  });
  if (!project) return 0;

  let after: string | undefined;
  let created = 0;

  for (;;) {
    const followers = await prisma.follow.findMany({
      where: {
        projectId: job.projectId,
        userId: { not: project.ownerId, ...(after ? { gt: after } : {}) },
      },
      orderBy: { userId: 'asc' },
      take: BATCH,
      select: { userId: true },
    });
    if (followers.length === 0) break;

    const res = await prisma.notification.createMany({
      data: followers.map((f) => ({
        userId: f.userId,
        projectId: job.projectId,
        type: job.type,
        refId: job.refId,
        dedupeKey: job.dedupeKey,
      })),
      skipDuplicates: true,
    });
    created += res.count;

    after = followers[followers.length - 1].userId;
    if (followers.length < BATCH) break;
  }
  return created;
}