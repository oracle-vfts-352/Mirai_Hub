import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { enqueueNotification } from '../src/lib/queue';
import { fanOut } from '../src/services/notifications';
import { scenario, makeFeedback, makeUser } from './helpers';

describe('reply notifications: queueing', () => {
  it('the first reply queues exactly one FEEDBACK_REPLY job', async () => {
    const { fan1, project, ownerApi } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    await ownerApi.put(`/api/feedback/${fb.id}/reply`).send({ text: 'Thanks' }).expect(200);

    expect(enqueueNotification).toHaveBeenCalledTimes(1);
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'FEEDBACK_REPLY',
        projectId: project.id,
        refId: fb.id,
        dedupeKey: `reply-${fb.id}`,
      }),
    );
  });

  it('editing the reply queues nothing more', async () => {
    const { fan1, project, ownerApi } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    await ownerApi.put(`/api/feedback/${fb.id}/reply`).send({ text: 'First' }).expect(200);
    await ownerApi.put(`/api/feedback/${fb.id}/reply`).send({ text: 'Edited' }).expect(200);
    expect(enqueueNotification).toHaveBeenCalledTimes(1);
  });

  it('a consumer cannot reply and nothing is queued', async () => {
    const { fan1, project, fan1Api } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    await fan1Api.put(`/api/feedback/${fb.id}/reply`).send({ text: 'Nope' }).expect(403);
    expect(enqueueNotification).not.toHaveBeenCalled();
  });
});

describe('reply notifications: fan-out', () => {
  // fan1 wrote the feedback (and voted), fan2 voted, the owner voted (old data),
  // fan3 follows the project but did not vote, stranger has nothing to do with it.
  async function setup() {
    const ctx = await scenario();
    const fan3 = await makeUser('fan3');
    await makeUser('stranger');
    await prisma.follow.create({ data: { userId: fan3.id, projectId: ctx.project.id } });
    const fb = await makeFeedback(ctx.project.id, ctx.fan1.id);
    await prisma.vote.createMany({
      data: [
        { userId: ctx.fan1.id, feedbackId: fb.id },
        { userId: ctx.fan2.id, feedbackId: fb.id },
        { userId: ctx.owner.id, feedbackId: fb.id },
      ],
    });
    const job = {
      type: 'FEEDBACK_REPLY' as const,
      projectId: ctx.project.id,
      refId: fb.id,
      dedupeKey: `reply-${fb.id}`,
    };
    return { ...ctx, fan3, fb, job };
  }

  it('notifies the author and the voters, never the owner or non-voters', async () => {
    const { fan1, fan2, job } = await setup();
    const created = await fanOut(job);

    expect(created).toBe(2); // the author who also voted counts once
    const rows = await prisma.notification.findMany({ select: { userId: true } });
    expect(rows.map((r) => r.userId).sort()).toEqual([fan1.id, fan2.id].sort());
  });

  it('is idempotent: running the same job twice creates no duplicates', async () => {
    const { job } = await setup();
    expect(await fanOut(job)).toBe(2);
    expect(await fanOut(job)).toBe(0);
    expect(await prisma.notification.count()).toBe(2);
  });

  it("shows up in the author's list with the feedback title and no status", async () => {
    const { fan1Api, job } = await setup();
    await fanOut(job);
    const list = await fan1Api.get('/api/me/notifications');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].type).toBe('FEEDBACK_REPLY');
    expect(list.body[0].title).toBe('Add fishing');
    expect(list.body[0].status).toBeNull();
  });
});