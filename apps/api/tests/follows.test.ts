import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { anon, scenario, makeUser, loginAs } from './helpers';

describe('following', () => {
  it('requires login', async () => {
    const { project } = await scenario();
    const res = await anon().put(`/api/projects/${project.slug}/follow`);
    expect(res.status).toBe(401);
  });

  it('a consumer can follow; following twice keeps one row; it shows in /me/follows', async () => {
    const { project } = await scenario();
    const fan3 = await makeUser('fan3');
    const api = await loginAs(fan3.email);

    await api.put(`/api/projects/${project.slug}/follow`).expect(200);
    await api.put(`/api/projects/${project.slug}/follow`).expect(200);

    expect(await prisma.follow.count({ where: { userId: fan3.id } })).toBe(1);
    const list = await api.get('/api/me/follows');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].project.slug).toBe(project.slug);
  });

  it('the owner cannot follow their own project', async () => {
    const { owner, project, ownerApi } = await scenario();
    const res = await ownerApi.put(`/api/projects/${project.slug}/follow`);
    expect(res.status).toBe(400);
    expect(await prisma.follow.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("another DEV can follow someone else's project", async () => {
    const { project } = await scenario();
    const other = await makeUser('otherdev', 'DEV');
    const api = await loginAs(other.email);
    const res = await api.put(`/api/projects/${project.slug}/follow`);
    expect(res.status).toBe(200);
  });

  it('unfollow removes the row and can be repeated', async () => {
    const { fan1, project, fan1Api } = await scenario(); // fan1 already follows
    await fan1Api.delete(`/api/projects/${project.slug}/follow`).expect(200);
    await fan1Api.delete(`/api/projects/${project.slug}/follow`).expect(200);
    expect(await prisma.follow.count({ where: { userId: fan1.id } })).toBe(0);
  });

  it('following an unknown project returns 404', async () => {
    const { fan1Api } = await scenario();
    const res = await fan1Api.put('/api/projects/does-not-exist/follow');
    expect(res.status).toBe(404);
  });
});