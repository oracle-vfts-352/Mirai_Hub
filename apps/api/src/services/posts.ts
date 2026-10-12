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

// Loads a post and checks the caller owns its project. Shared by update and delete.
async function getOwnedPost(userId: string, postId: string) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { project: { select: { ownerId: true } } },
  });
  if (!post) throw new AppError(404, 'Post not found');
  if (post.project.ownerId !== userId) throw new AppError(403, 'Only the project owner can change this post');
  return post;
}

// Editing never notifies followers again.
export async function updatePost(
  userId: string,
  postId: string,
  data: { type?: PostType; title?: string; body?: string },
) {
  await getOwnedPost(userId, postId);
  return prisma.post.update({ where: { id: postId }, data });
}

// Also removes the NEW_POST notifications for this post so followers don't see dead entries.
export async function deletePost(userId: string, postId: string) {
  await getOwnedPost(userId, postId);
  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { type: 'NEW_POST', refId: postId } }),
    prisma.post.delete({ where: { id: postId } }),
  ]);
}