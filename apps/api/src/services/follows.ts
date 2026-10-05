import { prisma } from '../lib/prisma';

export async function follow(userId: string, projectId: string) {
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