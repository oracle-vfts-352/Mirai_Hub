import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { enqueueNotification } from '../src/lib/queue';
import { anon, scenario, makeFeedback, makeUser, loginAs } from './helpers';

describe('feedback creation', () => {
  it('requires login', async () => {
    const { project } = await scenario();
    const res = await anon().post(`/api/projects/${project.slug}/feedback`).send({ title: 'Idea', body: 'x' });
    expect(res.status).toBe(401);
  });

  it('a logged-in user can submit feedback, invalid input gets 400', async () => {
    const { project, fan1Api } = await scenario();
    const ok = await fan1Api.post(`/api/projects/${project.slug}/feedback`).send({ title: 'Add fishing', body: 'Please' });
    expect(ok.status).toBe(201);
    const bad = await fan1Api.post(`/api/projects/${project.slug}/feedback`).send({ title: 'x', body: '' });
    expect(bad.status).toBe(400);
  });
});

describe('votes', () => {
  it('one vote per user: voting twice counts once', async () => {
    const { fan1, project, fan1Api } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    await fan1Api.put(`/api/feedback/${fb.id}/vote`).expect(200);
    const res = await fan1Api.put(`/api/feedback/${fb.id}/vote`).expect(200);
    expect(res.body.voteCount).toBe(1);
  });

  it('votes from different users add up', async () => {
    const { fan1, project, fan1Api, fan2Api } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    await fan1Api.put(`/api/feedback/${fb.id}/vote`).expect(200);
    const res = await fan2Api.put(`/api/feedback/${fb.id}/vote`).expect(200);
    expect(res.body.voteCount).toBe(2);
  });

  it('removing a vote works and is repeatable', async () => {
    const { fan1, project, fan1Api } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    await fan1Api.put(`/api/feedback/${fb.id}/vote`).expect(200);
    await fan1Api.delete(`/api/feedback/${fb.id}/vote`).expect(200);
    const res = await fan1Api.delete(`/api/feedback/${fb.id}/vote`).expect(200);
    expect(res.body.voteCount).toBe(0);
  });

  it('hasVoted is per viewer', async () => {
    const { fan1, project, fan1Api, fan2Api } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    await fan1Api.put(`/api/feedback/${fb.id}/vote`).expect(200);

    const asVoter = await fan1Api.get(`/api/projects/${project.slug}/feedback`);
    const asOther = await fan2Api.get(`/api/projects/${project.slug}/feedback`);
    const asAnon = await anon().get(`/api/projects/${project.slug}/feedback`);
    expect(asVoter.body[0].hasVoted).toBe(true);
    expect(asVoter.body[0].voteCount).toBe(1);
    expect(asOther.body[0].hasVoted).toBe(false);
    expect(asAnon.body[0].hasVoted).toBe(false);
  });

  it('voting on unknown feedback returns 404', async () => {
    const { fan1Api } = await scenario();
    const res = await fan1Api.put(`/api/feedback/${randomUUID()}/vote`);
    expect(res.status).toBe(404);
  });

  it('a non-UUID id returns 400', async () => {
    const { fan1Api } = await scenario();
    const res = await fan1Api.put('/api/feedback/not-a-uuid/vote');
    expect(res.status).toBe(400);
  });

  it('voting requires login', async () => {
    const { fan1, project } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    const res = await anon().put(`/api/feedback/${fb.id}/vote`);
    expect(res.status).toBe(401);
  });
});

describe('status changes', () => {
  it('a consumer cannot change status', async () => {
    const { fan1, project, fan1Api } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    const res = await fan1Api.patch(`/api/feedback/${fb.id}/status`).send({ status: 'PLANNED' });
    expect(res.status).toBe(403);
    const after = await prisma.feedback.findUnique({ where: { id: fb.id } });
    expect(after?.status).toBe('OPEN');
    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it('a DEV who does not own the project cannot change status', async () => {
    const { fan1, project } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    const other = await makeUser('otherdev', 'DEV');
    const otherApi = await loginAs(other.email);
    const res = await otherApi.patch(`/api/feedback/${fb.id}/status`).send({ status: 'PLANNED' });
    expect(res.status).toBe(403);
  });

  it('the owner can change status, and exactly one notification job is queued', async () => {
    const { fan1, project, ownerApi } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    const res = await ownerApi.patch(`/api/feedback/${fb.id}/status`).send({ status: 'PLANNED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PLANNED');

    expect(enqueueNotification).toHaveBeenCalledTimes(1);
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'FEEDBACK_STATUS', projectId: project.id, refId: fb.id }),
    );
  });

  it('setting the same status again queues nothing', async () => {
    const { fan1, project, ownerApi } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    await ownerApi.patch(`/api/feedback/${fb.id}/status`).send({ status: 'PLANNED' }).expect(200);
    await ownerApi.patch(`/api/feedback/${fb.id}/status`).send({ status: 'PLANNED' }).expect(200);
    expect(enqueueNotification).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid status and a non-UUID id with 400', async () => {
    const { fan1, project, ownerApi } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    const badStatus = await ownerApi.patch(`/api/feedback/${fb.id}/status`).send({ status: 'NOPE' });
    expect(badStatus.status).toBe(400);
    const badId = await ownerApi.patch('/api/feedback/not-a-uuid/status').send({ status: 'PLANNED' });
    expect(badId.status).toBe(400);
  });
});