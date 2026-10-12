import { NotificationType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

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

// ---- Read side (used by the API, not the worker) ----

export async function listNotifications(userId: string, opts: { unreadOnly: boolean }) {
  const items = await prisma.notification.findMany({
    where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 50, // pagination comes later
    include: { project: { select: { slug: true, name: true } } },
  });

  // refId points at a feedback item or a post depending on type: resolve titles in two batched queries
  const feedbackIds = items.filter((n) => n.type === 'FEEDBACK_STATUS').map((n) => n.refId);
  const postIds = items.filter((n) => n.type === 'NEW_POST').map((n) => n.refId);

  const [feedbackRows, postRows] = await Promise.all([
    feedbackIds.length
      ? prisma.feedback.findMany({
          where: { id: { in: feedbackIds } },
          select: { id: true, title: true, status: true },
        })
      : [],
    postIds.length
      ? prisma.post.findMany({
          where: { id: { in: postIds } },
          select: { id: true, title: true },
        })
      : [],
  ]);
  const feedbackById = new Map(feedbackRows.map((f) => [f.id, f]));
  const postById = new Map(postRows.map((p) => [p.id, p]));

  return items.map((n) => {
    const ref =
      n.type === 'FEEDBACK_STATUS'
        ? feedbackById.get(n.refId)
        : postById.get(n.refId);
    return {
      id: n.id,
      type: n.type,
      project: n.project,
      refId: n.refId,
      title: ref?.title ?? null, // null if the item was deleted
      status: n.type === 'FEEDBACK_STATUS' ? (ref as { status?: string } | undefined)?.status ?? null : null,
      read: n.readAt !== null,
      createdAt: n.createdAt,
    };
  });
}

export function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: string, notificationId: string) {
  // scoping by userId means you can only touch your own notifications
  const res = await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (res.count === 0) {
    const exists = await prisma.notification.findFirst({
      where: { id: notificationId, userId },
      select: { id: true },
    });
    if (!exists) throw new AppError(404, 'Notification not found');
  }
}

export async function markAllRead(userId: string) {
  const res = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return res.count;
}