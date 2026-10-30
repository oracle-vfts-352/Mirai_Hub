import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { fanOut } from '../src/services/notifications';
import { anon, scenario, makeUser, makeFeedback } from './helpers';

function newPost(projectId: string) {
  return prisma.post.create({
    data: { projectId, type: 'ANNOUNCEMENT', title: 'Hello', body: 'x' },
  });
}

describe('fan-out', () => {
  it('notifies followers, never the owner, never non-followers', async () => {
    const { owner, fan1, fan2, project } = await scenario();
    await prisma.follow.create({ data: { userId: owner.id, projectId: project.id } }); // owner follows own project
    const stranger = await makeUser('stranger'); // follows nothing
    const post = await newPost(project.id);

    const created = await fanOut({
      type: 'NEW_POST',
      projectId: project.id,
      refId: post.id,
      dedupeKey: 'post-test-1',
    });

    expect(created).toBe(2);
    const rows = await prisma.notification.findMany({ select: { userId: true } });
    const ids = rows.map((r) => r.userId).sort();
    expect(ids).toEqual([fan1.id, fan2.id].sort());
    expect(ids).not.toContain(owner.id);
    expect(ids).not.toContain(stranger.id);
  });

  it('is idempotent: running the same job twice creates no duplicates', async () => {
    const { project } = await scenario();
    const post = await newPost(project.id);
    const job = { type: 'NEW_POST' as const, projectId: project.id, refId: post.id, dedupeKey: 'post-test-2' };
    expect(await fanOut(job)).toBe(2);
    expect(await fanOut(job)).toBe(0);
    expect(await prisma.notification.count()).toBe(2);
  });

  it('a different event creates new notifications', async () => {
    const { project, fan1 } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    const refId = fb.id;
    await fanOut({ type: 'FEEDBACK_STATUS', projectId: project.id, refId, dedupeKey: 'status-a-PLANNED-1' });
    await fanOut({ type: 'FEEDBACK_STATUS', projectId: project.id, refId, dedupeKey: 'status-a-PLANNED-2' });
    expect(await prisma.notification.count()).toBe(4);
  });

  it('an unknown project creates nothing', async () => {
    await scenario();
    expect(await fanOut({ type: 'NEW_POST', projectId: randomUUID(), refId: randomUUID(), dedupeKey: 'x' })).toBe(0);
  });
});

describe('notification routes', () => {
  async function withNotification() {
    const ctx = await scenario();
    const post = await prisma.post.create({
      data: { projectId: ctx.project.id, type: 'ANNOUNCEMENT', title: 'Fishing is coming', body: 'x' },
    });
    await fanOut({ type: 'NEW_POST', projectId: ctx.project.id, refId: post.id, dedupeKey: `post-${post.id}` });
    return { ...ctx, post };
  }

  it('requires login', async () => {
    expect((await anon().get('/api/me/notifications')).status).toBe(401);
    expect((await anon().get('/api/me/notifications/unread-count')).status).toBe(401);
  });

  it('a follower sees their own notification with the post title', async () => {
    const { fan1Api } = await withNotification();
    const list = await fan1Api.get('/api/me/notifications');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].type).toBe('NEW_POST');
    expect(list.body[0].title).toBe('Fishing is coming');
    expect(list.body[0].read).toBe(false);
    const count = await fan1Api.get('/api/me/notifications/unread-count');
    expect(count.body.unread).toBe(1);
  });

  it('the owner has no notifications', async () => {
    const { ownerApi } = await withNotification();
    const count = await ownerApi.get('/api/me/notifications/unread-count');
    expect(count.body.unread).toBe(0);
  });

  it("users cannot mark each other's notifications read (404)", async () => {
    const { fan1Api, fan2Api } = await withNotification();
    const mine = await fan1Api.get('/api/me/notifications');
    const res = await fan2Api.patch(`/api/notifications/${mine.body[0].id}/read`);
    expect(res.status).toBe(404);
    const stillUnread = await fan1Api.get('/api/me/notifications/unread-count');
    expect(stillUnread.body.unread).toBe(1);
  });

  it('marking read lowers the count, and unread=true filters', async () => {
    const { fan1Api } = await withNotification();
    const list = await fan1Api.get('/api/me/notifications');
    await fan1Api.patch(`/api/notifications/${list.body[0].id}/read`).expect(200);
    expect((await fan1Api.get('/api/me/notifications/unread-count')).body.unread).toBe(0);
    expect((await fan1Api.get('/api/me/notifications?unread=true')).body).toHaveLength(0);
    expect((await fan1Api.get('/api/me/notifications')).body).toHaveLength(1);
  });

  it('read-all marks everything, a bad id gets 400', async () => {
    const { fan1Api } = await withNotification();
    const res = await fan1Api.post('/api/me/notifications/read-all');
    expect(res.body.marked).toBe(1);
    expect((await fan1Api.get('/api/me/notifications/unread-count')).body.unread).toBe(0);
    expect((await fan1Api.patch('/api/notifications/not-a-uuid/read')).status).toBe(400);
  });
});