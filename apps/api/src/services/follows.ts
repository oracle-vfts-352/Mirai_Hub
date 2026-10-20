import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

export async function follow(userId: string, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });
  if (!project) throw new AppError(404, 'Project not found');
  if (project.ownerId === userId) throw new AppError(400, 'You cannot follow your own project');

  await prisma.follow.upsert({
    where: { userId_projectId: { userId, projectId } },
    create: { userId, projectId },
    update: {},
  });
}

export async function unfollow(userId: string, projectId: string) {
  await prisma.follow.deleteMany({ where: { userId, projectId } });
}

export function listFollowed(userId: string) {
  return prisma.follow.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { project: { select: { id: true, slug: true, name: true, tagline: true } } },
  });
}