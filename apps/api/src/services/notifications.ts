import { NotificationType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

const BATCH = 500;

type FanOutJob = {
  type: NotificationType;
  projectId: string;
  refId: string;
  dedupeKey: string;
};

// Entry point used by the worker: picks the recipients by event type.
export async function fanOut(job: FanOutJob) {
  if (job.type === 'FEEDBACK_REPLY') return fanOutReply(job);
  if (job.type === 'NEW_FEEDBACK') return fanOutNewFeedback(job);
  return fanOutToFollowers(job);
}

// True while the item the job points at still exists in the job's project.
// NEW_POST points at a post, FEEDBACK_STATUS at a feedback item.
async function refExists(job: FanOutJob) {
  if (job.type === 'NEW_POST') {
    const post = await prisma.post.findUnique({
      where: { id: job.refId },
      select: { projectId: true },
    });
    return post?.projectId === job.projectId;
  }
  const fb = await prisma.feedback.findUnique({
    where: { id: job.refId },
    select: { projectId: true },
  });
  return fb?.projectId === job.projectId;
}

// Inserts one Notification per follower (except the project owner), in batches.
// Safe to run twice: the unique (userId, dedupeKey) + skipDuplicates ignores repeats.
// Creates nothing when the post / feedback was deleted before the job ran.
async function fanOutToFollowers(job: FanOutJob) {
  const project = await prisma.project.findUnique({
    where: { id: job.projectId },
    select: { ownerId: true },
  });
  if (!project) return 0;
  if (!(await refExists(job))) return 0; // deleted, or belongs to another project

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

// Owner replied to a feedback item: notify its author and everyone who voted for it
// (never the project owner). Same idempotency as above.
async function fanOutReply(job: FanOutJob) {
  const [project, fb] = await Promise.all([
    prisma.project.findUnique({ where: { id: job.projectId }, select: { ownerId: true } }),
    prisma.feedback.findUnique({
      where: { id: job.refId },
      select: { authorId: true, projectId: true },
    }),
  ]);
  if (!project || !fb || fb.projectId !== job.projectId) return 0; // feedback deleted or mismatched

  const row = (userId: string) => ({
    userId,
    projectId: job.projectId,
    type: job.type,
    refId: job.refId,
    dedupeKey: job.dedupeKey,
  });

  let created = 0;

  // The author first (skipped if the author is the owner, e.g. old data).
  const exclude = [project.ownerId];
  if (fb.authorId !== project.ownerId) {
    const res = await prisma.notification.createMany({
      data: [row(fb.authorId)],
      skipDuplicates: true,
    });
    created += res.count;
    exclude.push(fb.authorId);
  }

  // Then the voters, in batches (keyset on userId), skipping the owner and the author.
  let after: string | undefined;
  for (;;) {
    const voters = await prisma.vote.findMany({
      where: {
        feedbackId: job.refId,
        userId: { notIn: exclude, ...(after ? { gt: after } : {}) },
      },
      orderBy: { userId: 'asc' },
      take: BATCH,
      select: { userId: true },
    });
    if (voters.length === 0) break;

    const res = await prisma.notification.createMany({
      data: voters.map((v) => row(v.userId)),
      skipDuplicates: true,
    });
    created += res.count;

    after = voters[voters.length - 1].userId;
    if (voters.length < BATCH) break;
  }
  return created;
}

// Someone left feedback: notify the project OWNER, and only the owner.
// Same idempotency as above (one row per owner and feedback item).
async function fanOutNewFeedback(job: FanOutJob) {
  const [project, fb] = await Promise.all([
    prisma.project.findUnique({ where: { id: job.projectId }, select: { ownerId: true } }),
    prisma.feedback.findUnique({
      where: { id: job.refId },
      select: { authorId: true, projectId: true },
    }),
  ]);
  if (!project || !fb || fb.projectId !== job.projectId) return 0; // feedback deleted or mismatched
  if (fb.authorId === project.ownerId) return 0; // never notify people about their own actions

  const res = await prisma.notification.createMany({
    data: [
      {
        userId: project.ownerId,
        projectId: job.projectId,
        type: job.type,
        refId: job.refId,
        dedupeKey: job.dedupeKey,
      },
    ],
    skipDuplicates: true,
  });
  return res.count;
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
  const feedbackIds = items
    .filter((n) => n.type !== 'NEW_POST')
    .map((n) => n.refId);
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
    const ref = n.type === 'NEW_POST' ? postById.get(n.refId) : feedbackById.get(n.refId);
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