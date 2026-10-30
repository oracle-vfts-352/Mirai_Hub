import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { fanOut } from '../src/services/notifications';
import { scenario, makeFeedback, makeProject } from './helpers';

function newPost(projectId: string) {
  return prisma.post.create({
    data: { projectId, type: 'ANNOUNCEMENT', title: 'Hello', body: 'First update.' },
  });
}

describe('follower fan-out: the referenced item must still exist', () => {
  it('NEW_POST for an existing post notifies both followers', async () => {
    const { project } = await scenario();
    const post = await newPost(project.id);
    const job = {
      type: 'NEW_POST' as const,
      projectId: project.id,
      refId: post.id,
      dedupeKey: `post-${post.id}`,
    };
    expect(await fanOut(job)).toBe(2);
    expect(await prisma.notification.count()).toBe(2);
  });

  it('NEW_POST for a post deleted before the job ran creates nothing', async () => {
    const { project } = await scenario();
    const post = await newPost(project.id);
    const job = {
      type: 'NEW_POST' as const,
      projectId: project.id,
      refId: post.id,
      dedupeKey: `post-${post.id}`,
    };
    await prisma.post.delete({ where: { id: post.id } });
    expect(await fanOut(job)).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('FEEDBACK_STATUS for an existing feedback item notifies both followers', async () => {
    const { project, fan1 } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    const job = {
      type: 'FEEDBACK_STATUS' as const,
      projectId: project.id,
      refId: fb.id,
      dedupeKey: `status-${fb.id}-PLANNED-1`,
    };
    expect(await fanOut(job)).toBe(2);
    expect(await prisma.notification.count()).toBe(2);
  });

  it('FEEDBACK_STATUS for feedback deleted before the job ran creates nothing', async () => {
    const { project, fan1 } = await scenario();
    const fb = await makeFeedback(project.id, fan1.id);
    const job = {
      type: 'FEEDBACK_STATUS' as const,
      projectId: project.id,
      refId: fb.id,
      dedupeKey: `status-${fb.id}-PLANNED-1`,
    };
    await prisma.feedback.delete({ where: { id: fb.id } });
    expect(await fanOut(job)).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('a post that belongs to another project creates nothing', async () => {
    const { owner, project } = await scenario();
    const other = await makeProject(owner.id, 'other-game');
    const post = await newPost(other.id);
    const job = {
      type: 'NEW_POST' as const,
      projectId: project.id, // mismatched on purpose
      refId: post.id,
      dedupeKey: `post-${post.id}`,
    };
    expect(await fanOut(job)).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });
});