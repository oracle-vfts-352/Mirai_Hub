import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

// Public profile: the email is never selected, so it can never leak from here
export async function getPublicProfile(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      bio: true,
      role: true,
      createdAt: true,
      projects: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          slug: true,
          name: true,
          tagline: true,
          createdAt: true,
          _count: { select: { followers: true, feedback: true } },
        },
      },
    },
  });
  if (!user) throw new AppError(404, 'User not found');
  return user;
}

// Only name and bio can be edited; an empty bio clears it
export async function updateMe(userId: string, data: { name?: string; bio?: string }) {
  try {
    return await prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.bio !== undefined ? { bio: data.bio === '' ? null : data.bio } : {}),
      },
      select: { id: true, name: true, bio: true, role: true },
    });
  } catch (err) {
    // a still-valid cookie for a user that no longer exists
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new AppError(401, 'Not logged in');
    }
    throw err;
  }
}