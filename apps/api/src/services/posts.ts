import { PostType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { enqueueNotification } from '../lib/queue';
import { putObject, deleteObject, mediaUrl } from '../lib/storage';
import { toWebp } from '../lib/images';

// The storage key stays on the server; clients get a URL (or null).
function toPublic<T extends { coverKey: string | null }>(post: T) {
  const { coverKey, ...rest } = post;
  return { ...rest, coverUrl: mediaUrl(coverKey) };
}

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
  return toPublic(post);
}

export async function listPosts(slug: string, opts: { type?: PostType }) {
  const project = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
  if (!project) throw new AppError(404, 'Project not found');

  const posts = await prisma.post.findMany({
    where: { projectId: project.id, ...(opts.type ? { type: opts.type } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 50, // pagination comes later
  });
  return posts.map(toPublic);
}

// Loads a post and checks the caller owns its project. Shared by update, delete and covers.
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
  return toPublic(await prisma.post.update({ where: { id: postId }, data }));
}

// Also removes the NEW_POST notifications for this post so followers don't see dead entries,
// and the cover image object.
export async function deletePost(userId: string, postId: string) {
  const post = await getOwnedPost(userId, postId);
  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { type: 'NEW_POST', refId: postId } }),
    prisma.post.delete({ where: { id: postId } }),
  ]);
  if (post.coverKey) await deleteObject(post.coverKey);
}

// One optional cover image per post. Uploading again replaces it.
export async function setCover(userId: string, postId: string, file: Buffer) {
  const post = await getOwnedPost(userId, postId);
  const image = await toWebp(file, (img) => img.resize({ width: 1600, withoutEnlargement: true }));

  const key = `covers/${postId}/${randomUUID()}.webp`;
  try {
    await putObject(key, image, 'image/webp');
  } catch (err) {
    console.error('Cover upload to storage failed:', err);
    throw new AppError(503, 'Image storage is unavailable, please try again later');
  }

  try {
    await prisma.post.update({ where: { id: postId }, data: { coverKey: key } });
  } catch (err) {
    await deleteObject(key); // don't leave an unreferenced object behind
    throw err;
  }

  if (post.coverKey) await deleteObject(post.coverKey);
  return { coverUrl: mediaUrl(key) };
}

// Repeatable: removing when there is no cover is fine.
export async function removeCover(userId: string, postId: string) {
  const post = await getOwnedPost(userId, postId);
  if (post.coverKey) {
    await prisma.post.update({ where: { id: postId }, data: { coverKey: null } });
    await deleteObject(post.coverKey);
  }
  return { coverUrl: null };
}