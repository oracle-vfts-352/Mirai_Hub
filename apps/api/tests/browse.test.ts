import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { anon, scenario, makeUser, makeProject, loginAs } from './helpers';

describe('GET /api/projects (browse list)', () => {
  it('is public, newest first, with counts and the owner name but no email or vision', async () => {
    const { project, fan1 } = await scenario(); // my-game with 2 followers
    await prisma.project.update({
      where: { id: project.id },
      data: { createdAt: new Date('2026-01-01') },
    });
    const other = await makeUser('otherdev', 'DEV');
    const newer = await makeProject(other.id, 'newer-game');
    await prisma.feedback.create({
      data: { projectId: newer.id, authorId: fan1.id, title: 'Idea', body: 'x' },
    });

    const res = await anon().get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.map((p: { slug: string }) => p.slug)).toEqual(['newer-game', 'my-game']);
    expect(res.body[0]._count).toEqual({ followers: 0, feedback: 1 });
    expect(res.body[1]._count).toEqual({ followers: 2, feedback: 0 });
    expect(res.body[1].owner.name).toBe('owner');
    expect(res.body[1]).not.toHaveProperty('vision');
    expect(JSON.stringify(res.body)).not.toContain('@test.com');
  });

  it('sort=followers puts the most followed project first', async () => {
    const { project } = await scenario(); // my-game with 2 followers
    await prisma.project.update({
      where: { id: project.id },
      data: { createdAt: new Date('2026-01-01') },
    });
    const other = await makeUser('otherdev', 'DEV');
    await makeProject(other.id, 'newer-game'); // 0 followers, but newer

    const byFollowers = await anon().get('/api/projects?sort=followers');
    expect(byFollowers.body.map((p: { slug: string }) => p.slug)).toEqual(['my-game', 'newer-game']);
    const byNew = await anon().get('/api/projects?sort=new');
    expect(byNew.body.map((p: { slug: string }) => p.slug)).toEqual(['newer-game', 'my-game']);
  });

  it('rejects an invalid sort with 400', async () => {
    const res = await anon().get('/api/projects?sort=bogus');
    expect(res.status).toBe(400);
  });

  it('returns an empty list when there are no projects', async () => {
    const res = await anon().get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/feed', () => {
  it('is public, newest first across projects, with project info and no full body', async () => {
    const { project } = await scenario();
    const other = await makeUser('otherdev', 'DEV');
    const second = await makeProject(other.id, 'second-game');
    await prisma.post.create({
      data: { projectId: project.id, type: 'ANNOUNCEMENT', title: 'Older', body: 'x', createdAt: new Date('2026-01-01') },
    });
    await prisma.post.create({
      data: { projectId: second.id, type: 'CHANGELOG', title: 'Newer', body: 'y', createdAt: new Date('2026-02-01') },
    });

    const res = await anon().get('/api/feed');
    expect(res.status).toBe(200);
    expect(res.body.map((p: { title: string }) => p.title)).toEqual(['Newer', 'Older']);
    expect(res.body[0].project).toEqual({ slug: 'second-game', name: 'My Game' });
    expect(res.body[0].type).toBe('CHANGELOG');
    expect(res.body[0]).not.toHaveProperty('body');
  });

  it('cuts long bodies to a 240 character excerpt and leaves short ones alone', async () => {
    const { project } = await scenario();
    await prisma.post.create({
      data: { projectId: project.id, type: 'ANNOUNCEMENT', title: 'Long', body: 'a'.repeat(1000), createdAt: new Date('2026-02-01') },
    });
    await prisma.post.create({
      data: { projectId: project.id, type: 'ANNOUNCEMENT', title: 'Short', body: 'short body', createdAt: new Date('2026-01-01') },
    });

    const res = await anon().get('/api/feed');
    expect(res.body[0].excerpt.length).toBe(241); // 240 characters + the ellipsis
    expect(res.body[0].excerpt.endsWith('…')).toBe(true);
    expect(res.body[1].excerpt).toBe('short body');
  });

  it('scope=following requires login', async () => {
    const res = await anon().get('/api/feed?scope=following');
    expect(res.status).toBe(401);
  });

  it('scope=following only shows posts from projects you follow', async () => {
    const { project, fan1Api } = await scenario(); // fan1 follows my-game only
    const other = await makeUser('otherdev', 'DEV');
    const second = await makeProject(other.id, 'second-game');
    await prisma.post.create({
      data: { projectId: project.id, type: 'ANNOUNCEMENT', title: 'In followed', body: 'x' },
    });
    await prisma.post.create({
      data: { projectId: second.id, type: 'ANNOUNCEMENT', title: 'Not followed', body: 'x' },
    });

    const res = await fan1Api.get('/api/feed?scope=following');
    expect(res.status).toBe(200);
    expect(res.body.map((p: { title: string }) => p.title)).toEqual(['In followed']);
  });

  it('scope=following is empty when you follow nothing', async () => {
    const { project } = await scenario();
    await prisma.post.create({
      data: { projectId: project.id, type: 'ANNOUNCEMENT', title: 'Hello', body: 'x' },
    });
    const loner = await makeUser('loner');
    const api = await loginAs(loner.email);

    const res = await api.get('/api/feed?scope=following');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('rejects an invalid scope with 400', async () => {
    const res = await anon().get('/api/feed?scope=bogus');
    expect(res.status).toBe(400);
  });
});