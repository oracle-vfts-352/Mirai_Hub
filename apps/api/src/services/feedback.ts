import { FeedbackStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { enqueueNotification } from '../lib/queue';

const NIL_UUID = '00000000-0000-0000-0000-000000000000'; // "nobody" for anonymous viewers

export function createFeedback(
  authorId: string,
  projectId: string,
  data: { title: string; body: string },
) {
  return prisma.feedback.create({ data: { ...data, projectId, authorId } });
}

export async function listFeedback(
  projectId: string,
  opts: { status?: FeedbackStatus; sort: 'votes' | 'new'; viewerId?: string },
) {
  const items = await prisma.feedback.findMany({
    where: { projectId, ...(opts.status ? { status: opts.status } : {}) },
    orderBy:
      opts.sort === 'votes'
        ? [{ votes: { _count: 'desc' } }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }],
    take: 50, // pagination comes later
    include: {
      author: { select: { id: true, name: true } },
      _count: { select: { votes: true } },
      votes: { where: { userId: opts.viewerId ?? NIL_UUID }, select: { userId: true } },
    },
  });

  return items.map(({ votes, _count, ...f }) => ({
    ...f,
    voteCount: _count.votes,
    hasVoted: votes.length > 0,
  }));
}

export async function addVote(userId: string, feedbackId: string) {
  try {
    await prisma.vote.upsert({
      where: { userId_feedbackId: { userId, feedbackId } },
      create: { userId, feedbackId },
      update: {},
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw new AppError(404, 'Feedback not found');
    }
    throw err;
  }
  return prisma.vote.count({ where: { feedbackId } });
}

export async function removeVote(userId: string, feedbackId: string) {
  await prisma.vote.deleteMany({ where: { userId, feedbackId } });
  return prisma.vote.count({ where: { feedbackId } });
}

// Loads a feedback item and checks that the user owns its project.
async function getFeedbackAsOwner(userId: string, feedbackId: string, forbiddenMsg: string) {
  const fb = await prisma.feedback.findUnique({
    where: { id: feedbackId },
    include: { project: { select: { ownerId: true } } },
  });
  if (!fb) throw new AppError(404, 'Feedback not found');
  if (fb.project.ownerId !== userId) throw new AppError(403, forbiddenMsg);
  return fb;
}

export async function setStatus(userId: string, feedbackId: string, status: FeedbackStatus) {
  const fb = await getFeedbackAsOwner(userId, feedbackId, 'Only the project owner can change status');

  const updated = await prisma.feedback.update({ where: { id: feedbackId }, data: { status } });

  // Only notify when the status actually changed. The timestamp makes
  // PLANNED -> IN_PROGRESS -> PLANNED produce three distinct events.
  if (fb.status !== status) {
    await enqueueNotification({
      type: 'FEEDBACK_STATUS',
      projectId: fb.projectId,
      refId: feedbackId,
      dedupeKey: `status-${feedbackId}-${status}-${updated.updatedAt.getTime()}`,
    });
  }
  return updated;
}

// One official owner reply per feedback item. PUT creates or overwrites it.
// Only the FIRST reply notifies (edits do not).
export async function setReply(userId: string, feedbackId: string, text: string) {
  const fb = await getFeedbackAsOwner(userId, feedbackId, 'Only the project owner can reply');
  const updated = await prisma.feedback.update({
    where: { id: feedbackId },
    data: { ownerReply: text, ownerReplyAt: new Date() },
  });

  if (fb.ownerReplyAt === null) {
    await enqueueNotification({
      type: 'FEEDBACK_REPLY',
      projectId: fb.projectId,
      refId: feedbackId,
      dedupeKey: `reply-${feedbackId}`,
    });
  }
  return updated;
}

// Clearing is repeatable: deleting a reply that does not exist is fine.
export async function clearReply(userId: string, feedbackId: string) {
  await getFeedbackAsOwner(userId, feedbackId, 'Only the project owner can reply');
  return prisma.feedback.update({
    where: { id: feedbackId },
    data: { ownerReply: null, ownerReplyAt: null },
  });
}