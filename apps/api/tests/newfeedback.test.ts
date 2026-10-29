import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { enqueueNotification } from '../src/lib/queue';
import { fanOut } from '../src/services/notifications';
import { scenario, makeFeedback } from './helpers';

describe('new feedback notifications: queueing', () => {
  it('submitting feedback queues exactly one NEW_FEEDBACK job', async () => {
    const { project, fan1Api } = await scenario();
    const res = await fan1Api
      .post(`/api/projects/${project.slug}/feedback`)
      .send({ title: 'Add fishing', body: 'Please' });
    expect(res.status).toBe(201);

    expect(enqueueNotification).toHaveBeenCalledTimes(1);
    expect(enqueueNotification).toHaveBeenCalledWith(
     {
       type: 'NEW_FEEDBACK',
       projectId: project.id,
       refId: res.body.id,
       dedupeKey: `feedback-${res.body.id}`,
     },
     expect.anything(),
   );
  });

  it('the owner cannot submit feedback, and nothing is queued', async () => {
    const { project, ownerApi } = await scenario();
    const res = await ownerApi
      .post(`/api/projects/${project.slug}/feedback`)
      .send({ title: 'My idea', body: 'Hello' });
    expect(res.status).toBe(403);
    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it('invalid feedback is rejected (400) and nothing is queued', async () => {
    const { project, fan1Api } = await scenario();
    const res = await fan1Api.post(`/api/projects/${project.slug}/feedback`).send({ title: 'x', body: '' });
    expect(res.status).toBe(400);
    expect(enqueueNotification).not.toHaveBeenCalled();
  });
});

describe('new feedback notifications: fan-out', () => {
  async function setup() {
    const ctx = await scenario(); // owner, fan1 and fan2 (both follow the project)
    const fb = await makeFeedback(ctx.project.id, ctx.fan1.id);
    const job = {
      type: 'NEW_FEEDBACK' as const,
      projectId: ctx.project.id,
      refId: fb.id,
      dedupeKey: `feedback-${fb.id}`,
    };
    return { ...ctx, fb, job };
  }

  it('notifies only the project owner: not the author, not the other followers', async () => {
    const { owner, job } = await setup();
    expect(await fanOut(job)).toBe(1);
    const rows = await prisma.notification.findMany({ select: { userId: true, type: true } });
    expect(rows).toEqual([{ userId: owner.id, type: 'NEW_FEEDBACK' }]);
  });

  it('is idempotent: running the same job twice creates no duplicates', async () => {
    const { job } = await setup();
    expect(await fanOut(job)).toBe(1);
    expect(await fanOut(job)).toBe(0);
    expect(await prisma.notification.count()).toBe(1);
  });

  it("shows up in the owner's list with the feedback title and no status, and counts as unread", async () => {
    const { ownerApi, fan1Api, job } = await setup();
    await fanOut(job);

    const list = await ownerApi.get('/api/me/notifications');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].type).toBe('NEW_FEEDBACK');
    expect(list.body[0].title).toBe('Add fishing');
    expect(list.body[0].status).toBeNull();
    expect(list.body[0].read).toBe(false);
    expect((await ownerApi.get('/api/me/notifications/unread-count')).body.unread).toBe(1);

    // the author gets nothing
    expect((await fan1Api.get('/api/me/notifications/unread-count')).body.unread).toBe(0);
  });

  it('creates nothing when the feedback no longer exists or the project is unknown', async () => {
    const { project, job } = await setup();
    await prisma.feedback.delete({ where: { id: job.refId } });
    expect(await fanOut(job)).toBe(0);
    expect(await fanOut({ ...job, projectId: randomUUID() })).toBe(0);
    expect(project.id).toBe(job.projectId);
    expect(await prisma.notification.count()).toBe(0);
  });
});