import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { anon, makeUser } from './helpers';

async function addProject(ownerId: string, slug: string, name: string, tagline?: string, createdAt?: Date) {
  return prisma.project.create({
    data: { slug, name, tagline, ownerId, ...(createdAt ? { createdAt } : {}) },
  });
}

const slugs = (body: { slug: string }[]) => body.map((p) => p.slug);

describe('project search (GET /api/projects?q=)', () => {
  it('matches the name, ignoring letter case', async () => {
    const owner = await makeUser('owner', 'DEV');
    await addProject(owner.id, 'fishing-frenzy', 'Fishing Frenzy');
    await addProject(owner.id, 'space-miner', 'Space Miner');

    const lower = await anon().get('/api/projects').query({ q: 'fishing' });
    expect(lower.status).toBe(200);
    expect(slugs(lower.body)).toEqual(['fishing-frenzy']);

    const upper = await anon().get('/api/projects').query({ q: 'FISHING' });
    expect(slugs(upper.body)).toEqual(['fishing-frenzy']);
  });

  it('also matches the tagline', async () => {
    const owner = await makeUser('owner', 'DEV');
    await addProject(owner.id, 'farm-life', 'Farm Life', 'A cozy farming sim');
    await addProject(owner.id, 'space-miner', 'Space Miner', 'Dig deep');

    const res = await anon().get('/api/projects').query({ q: 'cozy' });
    expect(slugs(res.body)).toEqual(['farm-life']);
  });

  it('an empty or blank search behaves like no search', async () => {
    const owner = await makeUser('owner', 'DEV');
    await addProject(owner.id, 'one', 'One');
    await addProject(owner.id, 'two', 'Two');

    expect((await anon().get('/api/projects').query({ q: '' })).body).toHaveLength(2);
    expect((await anon().get('/api/projects').query({ q: '   ' })).body).toHaveLength(2);
  });

  it('returns an empty list (200) when nothing matches', async () => {
    const owner = await makeUser('owner', 'DEV');
    await addProject(owner.id, 'one', 'One');

    const res = await anon().get('/api/projects').query({ q: 'zzz-nothing' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('works together with the sort', async () => {
    const owner = await makeUser('owner', 'DEV');
    const fan = await makeUser('fan');
    const alpha = await addProject(owner.id, 'alpha', 'Alpha Game', undefined, new Date('2026-01-01'));
    await addProject(owner.id, 'beta', 'Beta Game', undefined, new Date('2026-02-01'));
    await addProject(owner.id, 'other', 'Other Thing');
    await prisma.follow.create({ data: { userId: fan.id, projectId: alpha.id } });

    const byFollowers = await anon().get('/api/projects').query({ q: 'game', sort: 'followers' });
    expect(slugs(byFollowers.body)).toEqual(['alpha', 'beta']);
    const byNew = await anon().get('/api/projects').query({ q: 'game', sort: 'new' });
    expect(slugs(byNew.body)).toEqual(['beta', 'alpha']);
  });

  it('treats % and _ as plain characters, not wildcards', async () => {
    const owner = await makeUser('owner', 'DEV');
    await addProject(owner.id, 'percent', '100% Fun');
    await addProject(owner.id, 'plain', 'Plain Game');
    await addProject(owner.id, 'under', 'a_b tool');
    await addProject(owner.id, 'nounder', 'axb tool');

    const percent = await anon().get('/api/projects').query({ q: '%' });
    expect(slugs(percent.body)).toEqual(['percent']);

    const underscore = await anon().get('/api/projects').query({ q: 'a_b' });
    expect(slugs(underscore.body)).toEqual(['under']);
  });

  it('rejects a search longer than 80 characters (400)', async () => {
    const res = await anon().get('/api/projects').query({ q: 'x'.repeat(81) });
    expect(res.status).toBe(400);
  });

  it('treats a backslash as a plain character too', async () => {
    const owner = await makeUser('owner', 'DEV');
    await addProject(owner.id, 'win-path', 'C:\\games tool');
    await addProject(owner.id, 'plain', 'Plain Game');

    const res = await anon().get('/api/projects').query({ q: '\\' });
    expect(slugs(res.body)).toEqual(['win-path']);
  });
});