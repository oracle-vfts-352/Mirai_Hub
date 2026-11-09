import sharp from 'sharp';
import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { deleteObject } from '../lib/storage';
import * as projectsSvc from '../services/projects';
import * as postsSvc from '../services/posts';
import * as feedbackSvc from '../services/feedback';
import * as followsSvc from '../services/follows';
import * as avatarsSvc from '../services/avatars';
import { DEMO_DOMAIN, DEMO_PROJECTS, DEMO_USERS } from './demoData';

type Log = (line: string) => void;
const noLog: Log = () => undefined;
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---- generated pictures (no files to ship: simple gradients and shapes rendered by sharp) ----
const PALETTE: [string, string][] = [
  ['#6366f1', '#22d3ee'],
  ['#f59e0b', '#ef4444'],
  ['#10b981', '#3b82f6'],
  ['#ec4899', '#8b5cf6'],
  ['#14b8a6', '#84cc16'],
];

function svgArt(w: number, h: number, index: number, kind: 'avatar' | 'logo' | 'cover') {
  const [a, b] = PALETTE[index % PALETTE.length]!;
  const shapes =
    kind === 'avatar'
      ? `<circle cx="${w / 2}" cy="${h * 0.38}" r="${w * 0.18}" fill="white" fill-opacity="0.9"/>` +
        `<ellipse cx="${w / 2}" cy="${h * 0.9}" rx="${w * 0.32}" ry="${h * 0.26}" fill="white" fill-opacity="0.9"/>`
      : kind === 'logo'
        ? `<circle cx="${w / 2}" cy="${h / 2}" r="${w * 0.28}" fill="white" fill-opacity="0.92"/>` +
          `<circle cx="${w / 2}" cy="${h / 2}" r="${w * 0.14}" fill="${a}"/>`
        : `<circle cx="${w * 0.25}" cy="${h * 0.6}" r="${h * 0.35}" fill="white" fill-opacity="0.18"/>` +
          `<circle cx="${w * 0.72}" cy="${h * 0.35}" r="${h * 0.5}" fill="white" fill-opacity="0.12"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/>` +
    `<stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>${shapes}</svg>`
  );
}

// PNG, because the upload services accept PNG / JPEG / WebP only (they re-encode it to WebP anyway)
const art = (w: number, h: number, index: number, kind: 'avatar' | 'logo' | 'cover') =>
  sharp(Buffer.from(svgArt(w, h, index, kind))).png().toBuffer();

// ---- seed ----
export type SeedOptions = { images: boolean; log?: Log };
export type SeedResult = {
  created: { users: number; projects: number; posts: number; feedback: number; images: number };
  imagesEnabled: boolean;
};

// Reconciles the database with the demo data: it only creates what is missing, so it can run again
// and again. Everything goes through the real services (same rules, outbox events as in real use).
export async function seedDemo(opts: SeedOptions): Promise<SeedResult> {
  const log = opts.log ?? noLog;
  const created = { users: 0, projects: 0, posts: 0, feedback: 0, images: 0 };
  let imagesOn = opts.images;

  // A failing image (storage down, wrong credentials) switches pictures off; the data still seeds.
  async function tryImage(label: string, work: () => Promise<unknown>) {
    if (!imagesOn) return;
    try {
      await work();
      created.images++;
    } catch (err) {
      imagesOn = false;
      log(`  images switched off after an error (${label}): ${msg(err)}`);
    }
  }

  // Users: there is no signup service (passkeys), so these rows are written directly. They are
  // verified, have no passkeys, and never receive mail.
  const users: Record<string, User> = {};
  for (const [i, def] of DEMO_USERS.entries()) {
    const existing = await prisma.user.findUnique({ where: { email: def.email } });
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            name: def.name,
            bio: def.bio,
            role: def.role,
            emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
          },
        })
      : await prisma.user.create({
          data: { email: def.email, name: def.name, bio: def.bio, role: def.role, emailVerifiedAt: new Date() },
        });
    if (!existing) created.users++;
    users[def.key] = user;
    log(`user    ${def.email} [${existing ? 'kept' : 'created'}]`);
    if (!user.avatarKey) {
      await tryImage(`avatar of ${def.email}`, async () =>
        avatarsSvc.setAvatar(user.id, await art(256, 256, i, 'avatar')),
      );
    }
  }
  const userOf = (key: string) => {
    const u = users[key];
    if (!u) throw new Error(`Demo data refers to an unknown user "${key}"`);
    return u;
  };

  for (const [pi, def] of DEMO_PROJECTS.entries()) {
    const owner = userOf(def.owner);

    let project = await prisma.project.findUnique({ where: { slug: def.slug } });
    if (project && project.ownerId !== owner.id) {
      throw new Error(
        `The address /p/${def.slug} is already used by another account, so the demo project cannot be created.`,
      );
    }
    if (!project) {
      await projectsSvc.createProject(owner.id, {
        name: def.name,
        slug: def.slug,
        tagline: def.tagline,
        vision: def.vision,
      });
      project = await prisma.project.findUniqueOrThrow({ where: { slug: def.slug } });
      created.projects++;
      log(`project ${def.slug} [created]`);
    } else {
      if (project.name !== def.name || project.tagline !== def.tagline || project.vision !== def.vision) {
        await projectsSvc.updateProject(owner.id, project.id, {
          name: def.name,
          tagline: def.tagline,
          vision: def.vision,
        });
      }
      log(`project ${def.slug} [kept]`);
    }
    const projectId = project.id;
    if (!project.logoKey) {
      await tryImage(`logo of ${def.slug}`, async () =>
        projectsSvc.setLogo(owner.id, projectId, await art(256, 256, pi, 'logo')),
      );
    }

    // Posts (oldest first, so the newest ends up on top)
    const postIds = new Map<string, string>();
    for (const p of def.posts) {
      const found = await prisma.post.findFirst({
        where: { projectId, title: p.title },
        select: { id: true, coverKey: true },
      });
      let postId: string;
      let coverKey: string | null;
      if (found) {
        postId = found.id;
        coverKey = found.coverKey;
      } else {
        const made = await postsSvc.createPost(owner.id, def.slug, { type: p.type, title: p.title, body: p.body });
        postId = made.id;
        coverKey = null;
        created.posts++;
        log(`  post  ${p.type} [created]`);
      }
      postIds.set(p.title, postId);
      if (p.cover && !coverKey) {
        await tryImage(`cover in ${def.slug}`, async () =>
          postsSvc.setCover(owner.id, postId, await art(1200, 600, pi + 2, 'cover')),
        );
      }
    }

    // Feedback, votes, status and the owner reply
    for (const f of def.feedback) {
      const author = userOf(f.by);
      const linkedPostId = f.aboutPost ? postIds.get(f.aboutPost) : undefined;
      if (f.aboutPost && !linkedPostId) {
        throw new Error(`Demo data: "${f.title}" refers to an unknown post "${f.aboutPost}"`);
      }
      let fb = await prisma.feedback.findFirst({
        where: { projectId, authorId: author.id, title: f.title },
      });
      if (!fb) {
        fb = await feedbackSvc.createFeedback(author.id, projectId, {
          title: f.title,
          body: f.body,
          postId: linkedPostId,
        });
        created.feedback++;
        log(`  feedback by ${f.by} [created]`);
      }
      for (const voter of f.votes) await feedbackSvc.addVote(userOf(voter).id, fb.id); // idempotent
      if (f.status && fb.status !== f.status) await feedbackSvc.setStatus(owner.id, fb.id, f.status);
      if (f.reply && fb.ownerReply !== f.reply) await feedbackSvc.setReply(owner.id, fb.id, f.reply);
    }

    for (const key of def.followers) await followsSvc.follow(userOf(key).id, projectId); // idempotent
  }

  return { created, imagesEnabled: imagesOn };
}

// ---- clean ----
export type CleanOptions = { force?: boolean; log?: Log };

// Removes the demo data: accounts ending in @demo.test, the projects they own (posts, feedback,
// follows and notifications go with them), their outbox events and their stored images.
// Never touches anything else.
export async function cleanDemo(opts: CleanOptions = {}) {
  const log = opts.log ?? noLog;

  const demoUsers = await prisma.user.findMany({
    where: { email: { endsWith: DEMO_DOMAIN } },
    select: { id: true, avatarKey: true },
  });
  if (demoUsers.length === 0) {
    log('Nothing to remove: no demo accounts found.');
    return { users: 0, projects: 0 };
  }
  const userIds = demoUsers.map((u) => u.id);

  const projects = await prisma.project.findMany({
    where: { ownerId: { in: userIds } },
    select: { id: true, logoKey: true, posts: { select: { coverKey: true } } },
  });
  const projectIds = projects.map((p) => p.id);

  // Feedback by demo accounts on projects that are not demo projects would block deleting the account
  const strayFeedback = await prisma.feedback.count({
    where: { authorId: { in: userIds }, projectId: { notIn: projectIds } },
  });
  if (strayFeedback > 0) {
    throw new Error(
      `Demo accounts wrote ${strayFeedback} feedback item(s) on projects that are not demo projects. Remove those by hand first.`,
    );
  }
  // Real visitors may have left feedback on the demo projects: it would be deleted with them
  const foreignFeedback = await prisma.feedback.count({
    where: { projectId: { in: projectIds }, authorId: { notIn: userIds } },
  });
  if (foreignFeedback > 0 && !opts.force) {
    throw new Error(
      `${foreignFeedback} feedback item(s) from other people sit on the demo projects and would be deleted with them. Run again with --force to delete them too.`,
    );
  }

  const keys = [
    ...demoUsers.map((u) => u.avatarKey),
    ...projects.map((p) => p.logoKey),
    ...projects.flatMap((p) => p.posts.map((x) => x.coverKey)),
  ].filter((k): k is string => Boolean(k));
  for (const key of keys) {
    try {
      await deleteObject(key);
    } catch (err) {
      log(`  could not delete image ${key}: ${msg(err)}`);
    }
  }

  await prisma.$transaction([
    prisma.outboxEvent.deleteMany({ where: { projectId: { in: projectIds } } }), // no foreign key
    prisma.project.deleteMany({ where: { id: { in: projectIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);
  log(`Removed ${demoUsers.length} demo account(s), ${projects.length} project(s) and ${keys.length} image(s).`);
  return { users: demoUsers.length, projects: projects.length };
}