import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { anon, scenario, makeFeedback, makeUser, loginAs } from './helpers';

describe('owner reply on feedback', () => {
  it('requires login', async () => {
    const { fan1, project } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    const res = await anon().put(`/api/feedback/${fb.id}/reply`).send({ text: 'Thanks' });
    expect(res.status).toBe(401);
  });

  it('a consumer cannot reply, even to their own feedback', async () => {
    const { fan1, project, fan1Api } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    const res = await fan1Api.put(`/api/feedback/${fb.id}/reply`).send({ text: 'Thanks' });
    expect(res.status).toBe(403);
    const after = await prisma.feedback.findUnique({ where: { id: fb.id } });
    expect(after?.ownerReply).toBeNull();
  });

  it('a DEV who does not own the project cannot reply or delete a reply', async () => {
    const { fan1, project, ownerApi } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    await ownerApi.put(`/api/feedback/${fb.id}/reply`).send({ text: 'Official' }).expect(200);

    const other = await makeUser('otherdev', 'DEV');
    const otherApi = await loginAs(other.email);
    await otherApi.put(`/api/feedback/${fb.id}/reply`).send({ text: 'Hijack' }).expect(403);
    await otherApi.delete(`/api/feedback/${fb.id}/reply`).expect(403);

    const after = await prisma.feedback.findUnique({ where: { id: fb.id } });
    expect(after?.ownerReply).toBe('Official');
  });

  it('the owner can reply and the feedback list returns it', async () => {
    const { fan1, project, ownerApi } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    const res = await ownerApi.put(`/api/feedback/${fb.id}/reply`).send({ text: '  We will look into it  ' });
    expect(res.status).toBe(200);
    expect(res.body.ownerReply).toBe('We will look into it'); // trimmed
    expect(res.body.ownerReplyAt).not.toBeNull();

    const list = await anon().get(`/api/projects/${project.slug}/feedback`);
    expect(list.body[0].ownerReply).toBe('We will look into it');
    expect(list.body[0].ownerReplyAt).not.toBeNull();
  });

  it('editing overwrites the previous reply', async () => {
    const { fan1, project, ownerApi } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    await ownerApi.put(`/api/feedback/${fb.id}/reply`).send({ text: 'First' }).expect(200);
    const res = await ownerApi.put(`/api/feedback/${fb.id}/reply`).send({ text: 'Second' }).expect(200);
    expect(res.body.ownerReply).toBe('Second');
    const count = await prisma.feedback.count({ where: { projectId: project.id } });
    expect(count).toBe(1);
  });

  it('deleting clears the reply and is repeatable', async () => {
    const { fan1, project, ownerApi } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    await ownerApi.put(`/api/feedback/${fb.id}/reply`).send({ text: 'Soon' }).expect(200);
    const res = await ownerApi.delete(`/api/feedback/${fb.id}/reply`).expect(200);
    expect(res.body.ownerReply).toBeNull();
    expect(res.body.ownerReplyAt).toBeNull();
    await ownerApi.delete(`/api/feedback/${fb.id}/reply`).expect(200);
  });

  it('enforces the length limit and rejects empty text', async () => {
    const { fan1, project, ownerApi } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    await ownerApi.put(`/api/feedback/${fb.id}/reply`).send({ text: 'a'.repeat(2000) }).expect(200);
    await ownerApi.put(`/api/feedback/${fb.id}/reply`).send({ text: 'a'.repeat(2001) }).expect(400);
    await ownerApi.put(`/api/feedback/${fb.id}/reply`).send({ text: '   ' }).expect(400);
    await ownerApi.put(`/api/feedback/${fb.id}/reply`).send({}).expect(400);
  });

  it('unknown feedback returns 404', async () => {
    const { ownerApi } = await scenario();
    await ownerApi.put(`/api/feedback/${randomUUID()}/reply`).send({ text: 'Hi' }).expect(404);
    await ownerApi.delete(`/api/feedback/${randomUUID()}/reply`).expect(404);
  });

  it('a non-UUID id returns 400', async () => {
    const { ownerApi } = await scenario();
    await ownerApi.put('/api/feedback/not-a-uuid/reply').send({ text: 'Hi' }).expect(400);
    await ownerApi.delete('/api/feedback/not-a-uuid/reply').expect(400);
  });

  it('feedback without a reply has null fields', async () => {
    const { fan1, project } = await scenario();
    await makeFeedback(project.id, fan1.id);
    const list = await anon().get(`/api/projects/${project.slug}/feedback`);
    expect(list.body[0].ownerReply).toBeNull();
    expect(list.body[0].ownerReplyAt).toBeNull();
  });
});