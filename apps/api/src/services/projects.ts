import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';

export interface ProjectInput {
  name: string;
  slug: string;
  tagline?: string;
  vision?: string;
}

export type ProjectSort = 'new' | 'followers';

export async function createProject(ownerId: string, data: ProjectInput) {
  try {
    return await prisma.project.create({ data: { ...data, ownerId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'That slug is already taken');
    }
    throw err;
  }
}

// Public browse list: owner name only (never the email), no vision text
export function listProjects(sort: ProjectSort) {
  return prisma.project.findMany({
    orderBy:
      sort === 'followers'
        ? [{ followers: { _count: 'desc' } }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }],
    take: 50, // pagination comes later
    select: {
      id: true,
      slug: true,
      name: true,
      tagline: true,
      createdAt: true,
      owner: { select: { id: true, name: true } },
      _count: { select: { followers: true, feedback: true } },
    },
  });
}

export async function getBySlug(slug: string) {
  const project = await prisma.project.findUnique({
    where: { slug },
    include: {
      owner: { select: { id: true, name: true } }, // never the email
      _count: { select: { followers: true, feedback: true } },
    },
  });
  if (!project) throw new AppError(404, 'Project not found');
  return project;
}

export function listMine(ownerId: string) {
  return prisma.project.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateProject(
  userId: string,
  projectId: string,
  data: Partial<Pick<ProjectInput, 'name' | 'tagline' | 'vision'>>,
) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, 'Project not found');
  if (project.ownerId !== userId) throw new AppError(403, 'Not your project');
  return prisma.project.update({ where: { id: projectId }, data });
}

export async function projectIdFromSlug(slug: string) {
  const p = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
  if (!p) throw new AppError(404, 'Project not found');
  return p.id;
}