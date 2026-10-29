import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { enqueueNotification, publishNotification } from '../src/lib/queue';
import { relayOnce, purgePublished } from '../src/lib/outbox';
import { scenario, makeFeedback } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

function jobFor(key: string) {
  return {
    type: 'NEW_POST' as const,
    projectId: randomUUID(),
    refId: randomUUID(),
    dedupeKey: key,
  };
}

describe('outbox: written together with the action', () => {
  it('new feedback writes one unpublished NEW_FEEDBACK row', async () => {
    const { project, fan1Api } = await scenario();
    const res = await fan1Api
      .post(`/api/projects/${project.slug}/feedback`)
      .send({ title: 'Add fishing', body: 'Please' });
    expect(res.status).toBe(201);

    const rows = await prisma.outboxEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'NEW_FEEDBACK',
      refId: res.body.id,
      dedupeKey: `feedback-${res.body.id}`,
      publishedAt: null,
    });
  });

  it('a status change writes a row, a repeated identical status does not', async () => {
    const { ownerApi, project, fan1 } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);

    await ownerApi.patch(`/api/feedback/${fb.id}/status`).send({ status: 'PLANNED' }).expect(200);
    expect(await prisma.outboxEvent.count({ where: { type: 'FEEDBACK_STATUS' } })).toBe(1);

    await ownerApi.patch(`/api/feedback/${fb.id}/status`).send({ status: 'PLANNED' }).expect(200);
    expect(await prisma.outboxEvent.count({ where: { type: 'FEEDBACK_STATUS' } })).toBe(1);
  });

  it('delete + rewrite of a reply succeeds and still leaves a single reply event', async () => {
    const { ownerApi, project, fan1 } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);

    await ownerApi.put(`/api/feedback/${fb.id}/reply`).send({ text: 'First' }).expect(200);
    await ownerApi.delete(`/api/feedback/${fb.id}/reply`).expect(200);
    await ownerApi.put(`/api/feedback/${fb.id}/reply`).send({ text: 'Second' }).expect(200);

    expect(await prisma.outboxEvent.count({ where: { type: 'FEEDBACK_REPLY' } })).toBe(1);
  });

  it('rolls back with the transaction: no action, no outbox row', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueueNotification(jobFor('post-rollback'), tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.outboxEvent.count()).toBe(0);
  });
});

describe('outbox: relay', () => {
  it('publishes unpublished rows in order and marks them published', async () => {
    await enqueueNotification(jobFor('post-a'));
    await enqueueNotification(jobFor('post-b'));

    expect(await relayOnce()).toBe(2);
    expect(publishNotification).toHaveBeenCalledTimes(2);
    expect(vi.mocked(publishNotification).mock.calls.map((c) => c[0].dedupeKey)).toEqual([
      'post-a',
      'post-b',
    ]);
    expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);

    // nothing left to do
    expect(await relayOnce()).toBe(0);
  });

  it('when publishing fails, the failed row stays unpublished and earlier ones are still marked', async () => {
    await enqueueNotification(jobFor('post-a'));
    await enqueueNotification(jobFor('post-b'));
    vi.mocked(publishNotification)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('redis down'));

    await expect(relayOnce()).rejects.toThrow('redis down');

    const a = await prisma.outboxEvent.findUnique({ where: { dedupeKey: 'post-a' } });
    const b = await prisma.outboxEvent.findUnique({ where: { dedupeKey: 'post-b' } });
    expect(a?.publishedAt).not.toBeNull();
    expect(b?.publishedAt).toBeNull();

    // the next run picks up the failed one
    expect(await relayOnce()).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
  });

  it('purges only published rows older than 7 days', async () => {
    const row = (key: string, publishedAt: Date | null) => ({
      ...jobFor(key),
      publishedAt,
    });
    await prisma.outboxEvent.createMany({
      data: [
        row('old-published', new Date(Date.now() - 8 * DAY)),
        row('recent-published', new Date(Date.now() - 1 * DAY)),
        row('unpublished', null),
      ],
    });

    expect(await purgePublished()).toBe(1);
    const left = await prisma.outboxEvent.findMany({ select: { dedupeKey: true } });
    expect(left.map((r) => r.dedupeKey).sort()).toEqual(['recent-published', 'unpublished']);
  });
});