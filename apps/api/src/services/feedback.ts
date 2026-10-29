import { FeedbackStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { enqueueNotification } from '../lib/queue';
import { mediaUrl } from '../lib/storage';

const NIL_UUID = '00000000-0000-0000-0000-000000000000'; // "nobody" for anonymous viewers
const OWNER_MSG = 'Project owners respond with replies, statuses and posts';

export async function createFeedback(
  authorId: string,
  projectId: string,
  data: { title: string; body: string; postId?: string },
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });
  if (!project) throw new AppError(404, 'Project not found');
  if (project.ownerId === authorId) throw new AppError(403, OWNER_MSG);

  // An optional link to an update: it must belong to the SAME project.
  if (data.postId) {
    const post = await prisma.post.findUnique({
      where: { id: data.postId },
      select: { projectId: true },
    });
    if (!post || post.projectId !== projectId) {
      throw new AppError(400, 'That update does not belong to this project');
    }
  }

  const feedback = await prisma.feedback.create({
    data: { title: data.title, body: data.body, postId: data.postId, projectId, authorId },
  });

  // Tell the project owner. One notification per feedback item (the dedupe key makes retries harmless).
  await enqueueNotification({
    type: 'NEW_FEEDBACK',
    projectId,
    refId: feedback.id,
    dedupeKey: `feedback-${feedback.id}`,
  });

  return feedback;
}

export async function listFeedback(
  projectId: string,
  opts: { status?: FeedbackStatus; postId?: string; sort: 'votes' | 'new'; viewerId?: string },
) {
  const items = await prisma.feedback.findMany({
    where: {
      projectId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.postId ? { postId: opts.postId } : {}),
    },
    orderBy:
      opts.sort === 'votes'
        ? [{ votes: { _count: 'desc' } }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }],
    take: 50, // pagination comes later
    include: {
      author: { select: { id: true, name: true, avatarKey: true } },
      post: { select: { id: true, title: true } }, // null when unlinked or the post was deleted
      _count: { select: { votes: true } },
      votes: { where: { userId: opts.viewerId ?? NIL_UUID }, select: { userId: true } },
    },
  });

  return items.map(({ votes, _count, author, ...f }) => ({
    ...f,
    author: { id: author.id, name: author.name, avatarUrl: mediaUrl(author.avatarKey) },
    voteCount: _count.votes,
    hasVoted: votes.length > 0,
  }));
}

export async function addVote(userId: string, feedbackId: string) {
  const fb = await prisma.feedback.findUnique({
    where: { id: feedbackId },
    select: { project: { select: { ownerId: true } } },
  });
  if (!fb) throw new AppError(404, 'Feedback not found');
  if (fb.project.ownerId === userId) throw new AppError(403, OWNER_MSG);

  await prisma.vote.upsert({
    where: { userId_feedbackId: { userId, feedbackId } },
    create: { userId, feedbackId },
    update: {},
  });
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