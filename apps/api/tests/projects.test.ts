import { describe, it, expect } from 'vitest';
import { anon, makeUser, loginAs } from './helpers';

describe('projects', () => {
  it('a CONSUMER cannot create a project', async () => {
    const fan = await makeUser('fan1');
    const api = await loginAs(fan.email);
    const res = await api.post('/api/projects').send({ slug: 'my-game', name: 'My Game' });
    expect(res.status).toBe(403);
  });

  it('an anonymous visitor cannot create a project', async () => {
    const res = await anon().post('/api/projects').send({ slug: 'my-game', name: 'My Game' });
    expect(res.status).toBe(401);
  });

  it('a DEV can create a project, and a duplicate slug returns 409', async () => {
    const dev = await makeUser('dev1', 'DEV');
    const api = await loginAs(dev.email);
    const first = await api.post('/api/projects').send({ slug: 'my-game', name: 'My Game' });
    expect([200, 201]).toContain(first.status);
    const second = await api.post('/api/projects').send({ slug: 'my-game', name: 'Another' });
    expect(second.status).toBe(409);
  });
});