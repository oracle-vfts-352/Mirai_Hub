import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { anon, scenario, makeUser, makeProject, makeFeedback } from './helpers';

function makePost(projectId: string, title = 'v0.2 is out') {
  return prisma.post.create({ data: { projectId, type: 'CHANGELOG', title, body: 'x' } });
}

describe('feedback linked to a post', () => {
  it('accepts a post of the same project and returns it in the list', async () => {
    const { project, fan1Api } = await scenario();
    const post = await makePost(project.id);
    const res = await fan1Api
      .post(`/api/projects/${project.slug}/feedback`)
      .send({ title: 'About v0.2', body: 'Nice', postId: post.id });
    expect(res.status).toBe(201);
    expect(res.body.postId).toBe(post.id);

    const list = await anon().get(`/api/projects/${project.slug}/feedback`);
    expect(list.body[0].post).toEqual({ id: post.id, title: 'v0.2 is out' });
  });

  it('feedback without a link has post null', async () => {
    const { project, fan1Api } = await scenario();
    await fan1Api.post(`/api/projects/${project.slug}/feedback`).send({ title: 'Plain idea', body: 'x' }).expect(201);
    const list = await anon().get(`/api/projects/${project.slug}/feedback`);
    expect(list.body[0].postId).toBeNull();
    expect(list.body[0].post).toBeNull();
  });

  it('rejects a post from another project (400) and stores nothing', async () => {
    const { project, fan1Api } = await scenario();
    const otherOwner = await makeUser('otherdev', 'DEV');
    const otherProject = await makeProject(otherOwner.id, 'other-game');
    const foreignPost = await makePost(otherProject.id, 'Foreign');
    const res = await fan1Api
      .post(`/api/projects/${project.slug}/feedback`)
      .send({ title: 'Sneaky', body: 'x', postId: foreignPost.id });
    expect(res.status).toBe(400);
    expect(await prisma.feedback.count()).toBe(0);
  });

  it('rejects an unknown post id (400) and a non-UUID (400)', async () => {
    const { project, fan1Api } = await scenario();
    await fan1Api
      .post(`/api/projects/${project.slug}/feedback`)
      .send({ title: 'Ghost', body: 'x', postId: randomUUID() })
      .expect(400);
    await fan1Api
      .post(`/api/projects/${project.slug}/feedback`)
      .send({ title: 'Bad', body: 'x', postId: 'nope' })
      .expect(400);
  });

  it('deleting the post keeps the feedback and clears the link', async () => {
    const { project, fan1, ownerApi } = await scenario();
    const post = await makePost(project.id);
    const fb = await prisma.feedback.create({
      data: { projectId: project.id, authorId: fan1.id, title: 'About it', body: 'x', postId: post.id },
    });
    await ownerApi.delete(`/api/posts/${post.id}`).expect(200);

    const after = await prisma.feedback.findUnique({ where: { id: fb.id } });
    expect(after).not.toBeNull();
    expect(after?.postId).toBeNull();
    const list = await anon().get(`/api/projects/${project.slug}/feedback`);
    expect(list.body[0].post).toBeNull();
  });

  it('?postId= filters the list', async () => {
    const { project, fan1 } = await scenario();
    const post = await makePost(project.id);
    await makeFeedback(project.id, fan1.id, 'Unlinked');
    await prisma.feedback.create({
      data: { projectId: project.id, authorId: fan1.id, title: 'Linked', body: 'x', postId: post.id },
    });

    const all = await anon().get(`/api/projects/${project.slug}/feedback`);
    expect(all.body).toHaveLength(2);
    const filtered = await anon().get(`/api/projects/${project.slug}/feedback?postId=${post.id}`);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].title).toBe('Linked');
    const bad = await anon().get(`/api/projects/${project.slug}/feedback?postId=nope`);
    expect(bad.status).toBe(400);
  });
});