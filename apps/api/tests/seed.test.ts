import { describe, it, expect, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { putObject, deleteObject } from '../src/lib/storage';
import { seedDemo, cleanDemo } from '../src/seed/demo';
import { DEMO_DOMAIN } from '../src/seed/demoData';
import { makeUser, makeProject, makeFeedback } from './helpers';

async function snapshot() {
  return {
    users: await prisma.user.count({ where: { email: { endsWith: DEMO_DOMAIN } } }),
    projects: await prisma.project.count(),
    posts: await prisma.post.count(),
    feedback: await prisma.feedback.count(),
    follows: await prisma.follow.count(),
    votes: await prisma.vote.count(),
    outbox: await prisma.outboxEvent.count(),
  };
}

const uploadedKeys = () => vi.mocked(putObject).mock.calls.map((c) => c[0]);

describe('demo seed', () => {
  it('creates the demo cast: verified users, 2 projects, posts, feedback, follows and votes', async () => {
    const result = await seedDemo({ images: false });
    expect(result.created).toEqual({ users: 6, projects: 2, posts: 6, feedback: 8, images: 0 });
    expect(await snapshot()).toMatchObject({ users: 6, projects: 2, posts: 6, feedback: 8, follows: 6, votes: 16 });

    expect(await prisma.user.count({ where: { email: { endsWith: DEMO_DOMAIN }, emailVerifiedAt: null } })).toBe(0);
    // the rules of the real services hold: owners write no feedback and cast no votes
    expect(await prisma.feedback.count({ where: { author: { role: 'DEV' } } })).toBe(0);
    expect(await prisma.vote.count({ where: { user: { role: 'DEV' } } })).toBe(0);
  });

  it('sets status, owner reply and the link to an update, and queues the events', async () => {
    await seedDemo({ images: false });
    const fb = await prisma.feedback.findFirstOrThrow({ where: { title: 'Add a colorblind-friendly mode' } });
    expect(fb.status).toBe('PLANNED');
    expect(fb.ownerReply).not.toBeNull();
    expect(fb.postId).not.toBeNull();

    expect(await prisma.outboxEvent.count({ where: { type: 'NEW_POST' } })).toBe(6);
    expect(await prisma.outboxEvent.count({ where: { type: 'NEW_FEEDBACK' } })).toBe(8);
    expect(await prisma.outboxEvent.count({ where: { type: 'FEEDBACK_REPLY' } })).toBe(4);
  });

  it('is idempotent: a second run creates nothing, uploads nothing and queues no new events', async () => {
    await seedDemo({ images: true });
    const first = await snapshot();
    const uploads = vi.mocked(putObject).mock.calls.length;

    const second = await seedDemo({ images: true });
    expect(second.created).toEqual({ users: 0, projects: 0, posts: 0, feedback: 0, images: 0 });
    expect(await snapshot()).toEqual(first);
    expect(vi.mocked(putObject).mock.calls.length).toBe(uploads);
  });

  it('stores avatars, logos and covers through the storage layer', async () => {
    const result = await seedDemo({ images: true });
    expect(result.created.images).toBe(10);
    const keys = uploadedKeys();
    expect(keys.filter((k) => k.startsWith('avatars/'))).toHaveLength(6);
    expect(keys.filter((k) => k.startsWith('logos/'))).toHaveLength(2);
    expect(keys.filter((k) => k.startsWith('covers/'))).toHaveLength(2);
    expect(await prisma.user.count({ where: { avatarKey: { not: null } } })).toBe(6);
  });

  it('uploads nothing when images are off', async () => {
    await seedDemo({ images: false });
    expect(putObject).not.toHaveBeenCalled();
  });

  it('keeps seeding the data when storage fails, and stops trying images', async () => {
    vi.mocked(putObject).mockRejectedValueOnce(new Error('storage down'));
    const result = await seedDemo({ images: true });
    expect(result.created.images).toBe(0);
    expect(result.imagesEnabled).toBe(false);
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(await snapshot()).toMatchObject({ users: 6, projects: 2, posts: 6, feedback: 8 });
  });

  it('refuses when a demo address is already used by someone else', async () => {
    const squatter = await makeUser('squatter', 'DEV');
    await makeProject(squatter.id, 'lantern-quest');
    await expect(seedDemo({ images: false })).rejects.toThrow(/already used/);
  });
});

describe('demo clean', () => {
  it('removes the demo data and its images and leaves everything else alone', async () => {
    const keeper = await makeUser('keeper', 'DEV');
    await makeProject(keeper.id, 'my-game');
    await seedDemo({ images: true });

    await cleanDemo();

    expect(await snapshot()).toMatchObject({ users: 0, projects: 1, posts: 0, feedback: 0, follows: 0, votes: 0, outbox: 0 });
    expect(await prisma.user.findUnique({ where: { email: 'keeper@test.com' } })).not.toBeNull();
    expect(deleteObject).toHaveBeenCalledTimes(10);
  });

  it("refuses to delete other people's feedback unless forced", async () => {
    await seedDemo({ images: false });
    const visitor = await makeUser('visitor');
    const lantern = await prisma.project.findUniqueOrThrow({ where: { slug: 'lantern-quest' } });
    await makeFeedback(lantern.id, visitor.id, 'A visitor idea');

    await expect(cleanDemo()).rejects.toThrow(/--force/);
    expect(await prisma.feedback.count({ where: { title: 'A visitor idea' } })).toBe(1);

    await cleanDemo({ force: true });
    expect(await prisma.feedback.count()).toBe(0);
    expect(await prisma.user.findUnique({ where: { email: 'visitor@test.com' } })).not.toBeNull();
  });

  it('does nothing on a database without demo data', async () => {
    expect(await cleanDemo()).toEqual({ users: 0, projects: 0 });
  });
});