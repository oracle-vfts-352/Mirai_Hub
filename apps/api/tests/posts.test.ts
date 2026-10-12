import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { enqueueNotification } from '../src/lib/queue';
import { anon, scenario, makeUser, loginAs } from './helpers';

const body = { type: 'ANNOUNCEMENT', title: 'Hello world', body: 'First update.' };

describe('creating posts', () => {
  it('the owner can post, and a NEW_POST job is queued', async () => {
    const { project, ownerApi } = await scenario();
    const res = await ownerApi.post(`/api/projects/${project.slug}/posts`).send(body);
    expect(res.status).toBe(201);
    expect(enqueueNotification).toHaveBeenCalledTimes(1);
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'NEW_POST',
        projectId: project.id,
        refId: res.body.id,
        dedupeKey: `post-${res.body.id}`,
      }),
    );
  });

  it('a consumer cannot post (403) and nothing is created or queued', async () => {
    const { project, fan1Api } = await scenario();
    const res = await fan1Api.post(`/api/projects/${project.slug}/posts`).send(body);
    expect(res.status).toBe(403);
    expect(await prisma.post.count()).toBe(0);
    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it('a DEV who does not own the project cannot post', async () => {
    const { project } = await scenario();
    const other = await makeUser('otherdev', 'DEV');
    const otherApi = await loginAs(other.email);
    const res = await otherApi.post(`/api/projects/${project.slug}/posts`).send(body);
    expect(res.status).toBe(403);
  });

  it('anonymous gets 401, unknown project 404, bad type 400', async () => {
    const { project, ownerApi } = await scenario();
    expect((await anon().post(`/api/projects/${project.slug}/posts`).send(body)).status).toBe(401);
    expect((await ownerApi.post('/api/projects/does-not-exist/posts').send(body)).status).toBe(404);
    expect((await ownerApi.post(`/api/projects/${project.slug}/posts`).send({ ...body, type: 'BOGUS' })).status).toBe(400);
  });
});

describe('listing posts', () => {
  it('is public and newest first', async () => {
    const { project } = await scenario();
    await prisma.post.create({
      data: { projectId: project.id, type: 'CHANGELOG', title: 'Older', body: 'x', createdAt: new Date('2026-01-01') },
    });
    await prisma.post.create({
      data: { projectId: project.id, type: 'CHANGELOG', title: 'Newer', body: 'x', createdAt: new Date('2026-02-01') },
    });
    const res = await anon().get(`/api/projects/${project.slug}/posts`);
    expect(res.status).toBe(200);
    expect(res.body.map((p: { title: string }) => p.title)).toEqual(['Newer', 'Older']);
  });
});

describe('editing posts', () => {
  async function withPost() {
    const ctx = await scenario();
    const post = await prisma.post.create({
      data: { projectId: ctx.project.id, type: 'ANNOUNCEMENT', title: 'Original', body: 'Original body' },
    });
    return { ...ctx, post };
  }

  it('the owner can edit, and followers are not notified again', async () => {
    const { post, ownerApi } = await withPost();
    const res = await ownerApi.patch(`/api/posts/${post.id}`).send({ body: 'Fixed body' });
    expect(res.status).toBe(200);
    expect(res.body.body).toBe('Fixed body');
    expect(res.body.title).toBe('Original');
    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it('a consumer cannot edit, and the post stays unchanged', async () => {
    const { post, fan1Api } = await withPost();
    const res = await fan1Api.patch(`/api/posts/${post.id}`).send({ title: 'Hacked' });
    expect(res.status).toBe(403);
    const after = await prisma.post.findUnique({ where: { id: post.id } });
    expect(after?.title).toBe('Original');
  });

  it('a DEV who does not own the project cannot edit', async () => {
    const { post } = await withPost();
    const other = await makeUser('otherdev', 'DEV');
    const otherApi = await loginAs(other.email);
    expect((await otherApi.patch(`/api/posts/${post.id}`).send({ title: 'Hacked' })).status).toBe(403);
  });

  it('rejects an empty body, a bad type and a non-UUID id with 400; unknown id gets 404', async () => {
    const { post, ownerApi } = await withPost();
    expect((await ownerApi.patch(`/api/posts/${post.id}`).send({})).status).toBe(400);
    expect((await ownerApi.patch(`/api/posts/${post.id}`).send({ type: 'BOGUS' })).status).toBe(400);
    expect((await ownerApi.patch('/api/posts/not-a-uuid').send({ title: 'abc' })).status).toBe(400);
    expect((await ownerApi.patch(`/api/posts/${randomUUID()}`).send({ title: 'abc' })).status).toBe(404);
  });
});

describe('deleting posts', () => {
  it('the owner can delete; its NEW_POST notifications go too, others stay', async () => {
    const { project, fan1, ownerApi } = await scenario();
    const doomed = await prisma.post.create({
      data: { projectId: project.id, type: 'ANNOUNCEMENT', title: 'Doomed', body: 'x' },
    });
    const kept = await prisma.post.create({
      data: { projectId: project.id, type: 'ANNOUNCEMENT', title: 'Kept', body: 'x' },
    });
    for (const p of [doomed, kept]) {
      await prisma.notification.create({
        data: { userId: fan1.id, projectId: project.id, type: 'NEW_POST', refId: p.id, dedupeKey: `post-${p.id}` },
      });
    }

    const res = await ownerApi.delete(`/api/posts/${doomed.id}`);
    expect(res.status).toBe(200);
    expect(await prisma.post.findUnique({ where: { id: doomed.id } })).toBeNull();
    expect(await prisma.notification.count({ where: { refId: doomed.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { refId: kept.id } })).toBe(1);

    // second delete: not found
    expect((await ownerApi.delete(`/api/posts/${doomed.id}`)).status).toBe(404);
  });

  it('a consumer cannot delete, and anonymous gets 401', async () => {
    const { project, fan1Api } = await scenario();
    const post = await prisma.post.create({
      data: { projectId: project.id, type: 'ANNOUNCEMENT', title: 'Safe', body: 'x' },
    });
    expect((await fan1Api.delete(`/api/posts/${post.id}`)).status).toBe(403);
    expect((await anon().delete(`/api/posts/${post.id}`)).status).toBe(401);
    expect(await prisma.post.count()).toBe(1);
  });
});