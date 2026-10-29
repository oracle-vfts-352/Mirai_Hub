import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { putObject, deleteObject, mediaUrl } from '../lib/storage';
import { toWebp } from '../lib/images';

export interface ProjectInput {
  name: string;
  slug: string;
  tagline?: string;
  vision?: string;
}

export type ProjectSort = 'new' | 'followers';

// The storage key stays on the server; clients get a URL (or null).
function withLogo<T extends { logoKey: string | null }>(project: T) {
  const { logoKey, ...rest } = project;
  return { ...rest, logoUrl: mediaUrl(logoKey) };
}

export async function createProject(ownerId: string, data: ProjectInput) {
  try {
    return withLogo(await prisma.project.create({ data: { ...data, ownerId } }));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'That slug is already taken');
    }
    throw err;
  }
}

// Public browse list: owner name only (never the email), no vision text
export async function listProjects(sort: ProjectSort) {
  const projects = await prisma.project.findMany({
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
      logoKey: true,
      createdAt: true,
      owner: { select: { id: true, name: true } },
      _count: { select: { followers: true, feedback: true } },
    },
  });
  return projects.map(withLogo);
}

export async function getBySlug(slug: string) {
  const project = await prisma.project.findUnique({
    where: { slug },
    include: {
      owner: { select: { id: true, name: true, avatarKey: true } }, // never the email
      _count: { select: { followers: true, feedback: true } },
    },
  });
  if (!project) throw new AppError(404, 'Project not found');
  const { owner, ...rest } = project;
  return {
    ...withLogo(rest),
    owner: { id: owner.id, name: owner.name, avatarUrl: mediaUrl(owner.avatarKey) },
  };
}

export async function listMine(ownerId: string) {
  const projects = await prisma.project.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
  });
  return projects.map(withLogo);
}

// Loads a project and checks the caller owns it. Shared by update and the logo routes.
async function getOwnedProject(userId: string, projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, 'Project not found');
  if (project.ownerId !== userId) throw new AppError(403, 'Not your project');
  return project;
}

export async function updateProject(
  userId: string,
  projectId: string,
  data: Partial<Pick<ProjectInput, 'name' | 'tagline' | 'vision'>>,
) {
  await getOwnedProject(userId, projectId);
  return withLogo(await prisma.project.update({ where: { id: projectId }, data }));
}

// One optional logo per project. Uploading again replaces it.
// The whole logo is fitted inside 256x256 on a transparent background (never cropped).
export async function setLogo(userId: string, projectId: string, file: Buffer) {
  const project = await getOwnedProject(userId, projectId);
  const image = await toWebp(file, (img) =>
    img.resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }),
  );

  const key = `logos/${projectId}/${randomUUID()}.webp`;
  try {
    await putObject(key, image, 'image/webp');
  } catch (err) {
    console.error('Logo upload to storage failed:', err);
    throw new AppError(503, 'Image storage is unavailable, please try again later');
  }

  try {
    await prisma.project.update({ where: { id: projectId }, data: { logoKey: key } });
  } catch (err) {
    await deleteObject(key); // don't leave an unreferenced object behind
    throw err;
  }

  if (project.logoKey) await deleteObject(project.logoKey);
  return { logoUrl: mediaUrl(key) };
}

// Repeatable: removing when there is no logo is fine.
export async function removeLogo(userId: string, projectId: string) {
  const project = await getOwnedProject(userId, projectId);
  if (project.logoKey) {
    await prisma.project.update({ where: { id: projectId }, data: { logoKey: null } });
    await deleteObject(project.logoKey);
  }
  return { logoUrl: null };
}

export async function projectIdFromSlug(slug: string) {
  const p = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
  if (!p) throw new AppError(404, 'Project not found');
  return p.id;
}