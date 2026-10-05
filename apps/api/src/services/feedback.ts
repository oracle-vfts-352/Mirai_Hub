import { FeedbackStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

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

export async function setStatus(userId: string, feedbackId: string, status: FeedbackStatus) {
  const fb = await prisma.feedback.findUnique({
    where: { id: feedbackId },
    include: { project: { select: { ownerId: true } } },
  });
  if (!fb) throw new AppError(404, 'Feedback not found');
  if (fb.project.ownerId !== userId) throw new AppError(403, 'Only the project owner can change status');

  const updated = await prisma.feedback.update({ where: { id: feedbackId }, data: { status } });
  // TODO Phase 2: enqueue a "notify followers" job here
  return updated;
}