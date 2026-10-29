import { prisma } from '../lib/prisma';
import { mediaUrl } from '../lib/storage';

const EXCERPT_LENGTH = 240;

function excerpt(body: string): string {
  return body.length > EXCERPT_LENGTH ? `${body.slice(0, EXCERPT_LENGTH).trimEnd()}…` : body;
}

// Recent posts across projects. With followerId: only projects that person follows.
export async function listFeed(opts: { followerId?: string }) {
  const posts = await prisma.post.findMany({
    where: opts.followerId
      ? { project: { followers: { some: { userId: opts.followerId } } } }
      : {},
    orderBy: { createdAt: 'desc' },
    take: 50, // pagination comes later
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      coverKey: true,
      createdAt: true,
      project: { select: { slug: true, name: true, logoKey: true } },
    },
  });

  // Send a short excerpt, never the full body, and URLs, never storage keys
  return posts.map(({ body, coverKey, project, ...post }) => ({
    ...post,
    excerpt: excerpt(body),
    coverUrl: mediaUrl(coverKey),
    project: { slug: project.slug, name: project.name, logoUrl: mediaUrl(project.logoKey) },
  }));
}