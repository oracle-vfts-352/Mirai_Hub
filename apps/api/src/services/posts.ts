import { PostType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { enqueueNotification } from '../lib/queue';

export async function createPost(
  userId: string,
  slug: string,
  data: { type: PostType; title: string; body: string },
) {
  const project = await prisma.project.findUnique({
    where: { slug },
    select: { id: true, ownerId: true },
  });
  if (!project) throw new AppError(404, 'Project not found');
  if (project.ownerId !== userId) throw new AppError(403, 'Only the project owner can post');

    const post = await prisma.post.create({ data: { ...data, projectId: project.id } });
  await enqueueNotification({
    type: 'NEW_POST',
    projectId: project.id,
    refId: post.id,
    dedupeKey: `post-${post.id}`,
  });
  return post;
}

export async function listPosts(slug: string, opts: { type?: PostType }) {
  const project = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
  if (!project) throw new AppError(404, 'Project not found');

  return prisma.post.findMany({
    where: { projectId: project.id, ...(opts.type ? { type: opts.type } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 50, // pagination comes later
  });
}