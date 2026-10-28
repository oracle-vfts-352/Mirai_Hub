import { describe, it, expect } from 'vitest';
import { anon, scenario } from './helpers';

describe('GET /api/projects/:slug', () => {
  it('includes the owner id and name but never an email', async () => {
    const { owner, project } = await scenario();
    const res = await anon().get(`/api/projects/${project.slug}`);
    expect(res.status).toBe(200);
        expect(res.body.owner).toEqual({ id: owner.id, name: 'owner', avatarUrl: null });
    expect(res.body._count).toEqual({ followers: 2, feedback: 0 });
    expect(JSON.stringify(res.body)).not.toContain('@test.com');
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await anon().get('/api/projects/does-not-exist');
    expect(res.status).toBe(404);
  });
});