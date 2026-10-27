import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { scenario, makeFeedback, makeUser, loginAs } from './helpers';

describe('owner cannot give feedback or vote on their own project', () => {
  it('the owner gets 403 when creating feedback, and nothing is stored', async () => {
    const { project, ownerApi } = await scenario();
    const res = await ownerApi
      .post(`/api/projects/${project.slug}/feedback`)
      .send({ title: 'My idea', body: 'Hello' });
    expect(res.status).toBe(403);
    expect(await prisma.feedback.count()).toBe(0);
  });

  it('the owner gets 403 when voting, and no vote is stored', async () => {
    const { fan1, project, ownerApi } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    const res = await ownerApi.put(`/api/feedback/${fb.id}/vote`);
    expect(res.status).toBe(403);
    expect(await prisma.vote.count()).toBe(0);
  });

  it('removing an old owner vote is still allowed', async () => {
    const { fan1, owner, project, ownerApi } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    await prisma.vote.create({ data: { userId: owner.id, feedbackId: fb.id } });
    const res = await ownerApi.delete(`/api/feedback/${fb.id}/vote`);
    expect(res.status).toBe(200);
    expect(res.body.voteCount).toBe(0);
  });

  it('consumers can still create feedback and vote', async () => {
    const { project, fan1Api, fan2Api } = await scenario();
    const created = await fan1Api
      .post(`/api/projects/${project.slug}/feedback`)
      .send({ title: 'Add fishing', body: 'Please' });
    expect(created.status).toBe(201);
    const voted = await fan2Api.put(`/api/feedback/${created.body.id}/vote`);
    expect(voted.status).toBe(200);
    expect(voted.body.voteCount).toBe(1);
  });

  it('another DEV (not the owner) can still create feedback and vote', async () => {
    const { project, fan1 } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    const other = await makeUser('otherdev', 'DEV');
    const otherApi = await loginAs(other.email);
    const created = await otherApi
      .post(`/api/projects/${project.slug}/feedback`)
      .send({ title: 'From a dev', body: 'Hi' });
    expect(created.status).toBe(201);
    const voted = await otherApi.put(`/api/feedback/${fb.id}/vote`);
    expect(voted.status).toBe(200);
  });

  it('voting on unknown feedback is still 404', async () => {
    const { fan1Api } = await scenario();
    const res = await fan1Api.put(`/api/feedback/${randomUUID()}/vote`);
    expect(res.status).toBe(404);
  });
});