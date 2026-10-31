import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { makeUser, makeProject, makeFeedback, loginAs } from './helpers';

async function setup() {
  const owner = await makeUser('owner', 'DEV');
  const project = await makeProject(owner.id);
  const author = await makeUser('author');
  const fb = await makeFeedback(project.id, author.id);
  const newbie = await makeUser('newbie', 'CONSUMER', false); // email NOT verified
  const newbieApi = await loginAs(newbie.email);
  return { owner, project, fb, newbie, newbieApi };
}

describe('email verification gate', () => {
  it('an unverified user cannot follow (403 with a clear message)', async () => {
    const { project, newbieApi } = await setup();
    const res = await newbieApi.put(`/api/projects/${project.slug}/follow`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/verify your email/i);
    expect(await prisma.follow.count()).toBe(0);
  });

  it('an unverified user cannot vote', async () => {
    const { fb, newbieApi } = await setup();
    const res = await newbieApi.put(`/api/feedback/${fb.id}/vote`);
    expect(res.status).toBe(403);
    expect(await prisma.vote.count()).toBe(0);
  });

  it('an unverified user cannot write feedback, and nothing is created or queued', async () => {
    const { project, newbieApi } = await setup();
    const res = await newbieApi
      .post(`/api/projects/${project.slug}/feedback`)
      .send({ title: 'Add fishing', body: 'Please' });
    expect(res.status).toBe(403);
    expect(await prisma.feedback.count()).toBe(1); // only the one made in setup
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('an unverified dev cannot create a project, a verified one can', async () => {
    const dev = await makeUser('newdev', 'DEV', false);
    const api = await loginAs(dev.email);
    const body = { name: 'New Game', slug: 'new-game' };

    expect((await api.post('/api/projects').send(body)).status).toBe(403);

    await prisma.user.update({ where: { id: dev.id }, data: { emailVerifiedAt: new Date() } });
    expect((await api.post('/api/projects').send(body)).status).toBe(201);
  });

  it('an unverified user cannot upload an avatar', async () => {
    const { newbieApi } = await setup();
    const res = await newbieApi.post('/api/me/avatar');
    expect(res.status).toBe(403);
  });

  it('an unverified user can still read, undo and edit their profile', async () => {
    const { project, fb, newbie, newbieApi } = await setup();
    expect((await newbieApi.get(`/api/projects/${project.slug}/feedback`)).status).toBe(200);
    expect((await newbieApi.delete(`/api/projects/${project.slug}/follow`)).status).toBe(200);
    expect((await newbieApi.delete(`/api/feedback/${fb.id}/vote`)).status).toBe(200);
    const edit = await newbieApi.patch('/api/me').send({ bio: 'Hello' });
    expect(edit.status).toBe(200);
    expect(newbie.id).toBeTruthy();
  });

  it('verifying takes effect immediately, without a new login', async () => {
    const { project, newbie, newbieApi } = await setup();
    expect((await newbieApi.put(`/api/projects/${project.slug}/follow`)).status).toBe(403);

    await prisma.user.update({ where: { id: newbie.id }, data: { emailVerifiedAt: new Date() } });
    expect((await newbieApi.put(`/api/projects/${project.slug}/follow`)).status).toBe(200);
  });
});