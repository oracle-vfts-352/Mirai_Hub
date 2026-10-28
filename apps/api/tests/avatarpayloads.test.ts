import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { anon, scenario } from './helpers';

describe('avatarUrl in other payloads', () => {
  it('/auth/me has avatarUrl null by default and never the storage key', async () => {
    const { fan1Api } = await scenario();
    const res = await fan1Api.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBeNull();
    expect(res.body).not.toHaveProperty('avatarKey');
  });

  it('/auth/me returns the avatar URL once there is an avatar', async () => {
    const { fan1, fan1Api } = await scenario();
    await prisma.user.update({ where: { id: fan1.id }, data: { avatarKey: 'avatars/a/b.webp' } });
    const res = await fan1Api.get('/api/auth/me');
    expect(res.body.avatarUrl).toBe('http://media.test/avatars/a/b.webp');
    expect(res.body).not.toHaveProperty('avatarKey');
  });

  it('the project owner carries avatarUrl, never the key or the email', async () => {
    const { owner, project } = await scenario();
    const before = await anon().get(`/api/projects/${project.slug}`);
    expect(before.body.owner).toEqual({ id: owner.id, name: 'owner', avatarUrl: null });

    await prisma.user.update({ where: { id: owner.id }, data: { avatarKey: 'avatars/o/p.webp' } });
    const after = await anon().get(`/api/projects/${project.slug}`);
    expect(after.body.owner).toEqual({
      id: owner.id,
      name: 'owner',
      avatarUrl: 'http://media.test/avatars/o/p.webp',
    });
  });
});