import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { anon, scenario, makeUser, loginAs } from './helpers';

describe('GET /api/users/:id (public profile)', () => {
  it('is public and never contains the email', async () => {
    const fan = await makeUser('fanprofile');
    await prisma.user.update({ where: { id: fan.id }, data: { bio: 'I love cozy games' } });

    const res = await anon().get(`/api/users/${fan.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: fan.id,
      name: 'fanprofile',
      bio: 'I love cozy games',
      role: 'CONSUMER',
    });
    expect(res.body).not.toHaveProperty('email');
    expect(JSON.stringify(res.body)).not.toContain('@test.com');
  });

  it('a DEV profile lists their projects with counts; a consumer has none', async () => {
    const { owner, fan1 } = await scenario(); // owner owns my-game, which has 2 followers

    const dev = await anon().get(`/api/users/${owner.id}`);
    expect(dev.status).toBe(200);
    expect(dev.body.projects).toHaveLength(1);
    expect(dev.body.projects[0].slug).toBe('my-game');
    expect(dev.body.projects[0]._count).toEqual({ followers: 2, feedback: 0 });

    const consumer = await anon().get(`/api/users/${fan1.id}`);
    expect(consumer.body.projects).toEqual([]);
  });

  it('bio is null when it was never set', async () => {
    const fan = await makeUser('nobio');
    const res = await anon().get(`/api/users/${fan.id}`);
    expect(res.body.bio).toBeNull();
  });

  it('rejects a non-UUID id with 400', async () => {
    const res = await anon().get('/api/users/not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown user', async () => {
    const res = await anon().get(`/api/users/${randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/me (edit your own profile)', () => {
  it('requires login', async () => {
    const res = await anon().patch('/api/me').send({ name: 'Someone' });
    expect(res.status).toBe(401);
  });

  it('updates name and bio, and the public profile shows them', async () => {
    const fan = await makeUser('fanedit');
    const api = await loginAs(fan.email);

    const res = await api.patch('/api/me').send({ name: 'Fan Edited', bio: 'Hello there' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: fan.id, name: 'Fan Edited', bio: 'Hello there', role: 'CONSUMER', avatarUrl: null });

    const profile = await anon().get(`/api/users/${fan.id}`);
    expect(profile.body.name).toBe('Fan Edited');
    expect(profile.body.bio).toBe('Hello there');
  });

  it('an empty bio clears it back to null', async () => {
    const fan = await makeUser('fanclear');
    await prisma.user.update({ where: { id: fan.id }, data: { bio: 'old bio' } });
    const api = await loginAs(fan.email);

    const res = await api.patch('/api/me').send({ bio: '' });
    expect(res.status).toBe(200);
    expect(res.body.bio).toBeNull();
  });

  it('rejects an empty body, an empty name and a too long bio with 400', async () => {
    const fan = await makeUser('fanbad');
    const api = await loginAs(fan.email);

    expect((await api.patch('/api/me').send({})).status).toBe(400);
    expect((await api.patch('/api/me').send({ name: '   ' })).status).toBe(400);
    expect((await api.patch('/api/me').send({ bio: 'x'.repeat(501) })).status).toBe(400);
  });

  it('cannot change role or email', async () => {
    const fan = await makeUser('fanrole');
    const api = await loginAs(fan.email);

    // extra fields are ignored, the allowed field is applied
    const res = await api
      .patch('/api/me')
      .send({ name: 'Still Fan', role: 'DEV', email: 'hacker@test.com' });
    expect(res.status).toBe(200);
    const row = await prisma.user.findUnique({ where: { id: fan.id } });
    expect(row?.role).toBe('CONSUMER');
    expect(row?.email).toBe('fanrole@test.com');
    expect(row?.name).toBe('Still Fan');

    // only forbidden fields: nothing to update
    expect((await api.patch('/api/me').send({ role: 'DEV' })).status).toBe(400);
  });
});