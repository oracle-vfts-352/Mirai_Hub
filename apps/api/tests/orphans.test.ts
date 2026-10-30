import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupOrphans } from '../src/services/orphans';
import { makeUser, makeProject, makeFeedback } from './helpers';

const HOUR = 60 * 60 * 1000;

function userAged(name: string, ageMs: number, role: 'DEV' | 'CONSUMER' = 'CONSUMER') {
  return prisma.user.create({
    data: { email: `${name}@test.com`, name, role, createdAt: new Date(Date.now() - ageMs) },
  });
}

const exists = async (id: string) => (await prisma.user.findUnique({ where: { id } })) !== null;

describe('orphan cleanup', () => {
  it('deletes an old account with no passkey and nothing else', async () => {
    const orphan = await userAged('orphan', 2 * HOUR);
    expect(await cleanupOrphans()).toBe(1);
    expect(await exists(orphan.id)).toBe(false);
  });

  it('keeps a recent account (the passkey step may still be in progress)', async () => {
    const fresh = await userAged('fresh', 30 * 60 * 1000);
    expect(await cleanupOrphans()).toBe(0);
    expect(await exists(fresh.id)).toBe(true);
  });

  it('keeps an old account that has a passkey', async () => {
    const user = await userAged('haskey', 2 * HOUR);
    await prisma.devicePasskey.create({
      data: { userId: user.id, credentialId: 'cred-1', publicKey: 'pk', counter: 0 },
    });
    expect(await cleanupOrphans()).toBe(0);
    expect(await exists(user.id)).toBe(true);
  });

  it('keeps an old passkey-less account that owns a project', async () => {
    const owner = await userAged('olddev', 2 * HOUR, 'DEV');
    await makeProject(owner.id);
    expect(await cleanupOrphans()).toBe(0);
    expect(await exists(owner.id)).toBe(true);
  });

  it('keeps an old passkey-less account that left feedback or follows a project', async () => {
    const owner = await makeUser('owner', 'DEV');
    const project = await makeProject(owner.id);
    const writer = await userAged('writer', 2 * HOUR);
    const follower = await userAged('follower', 2 * HOUR);
    await makeFeedback(project.id, writer.id);
    await prisma.follow.create({ data: { userId: follower.id, projectId: project.id } });

    expect(await cleanupOrphans()).toBe(0);
    expect(await exists(writer.id)).toBe(true);
    expect(await exists(follower.id)).toBe(true);
  });

  it('deletes only the orphans when several accounts exist', async () => {
    const orphan1 = await userAged('o1', 3 * HOUR);
    const orphan2 = await userAged('o2', 2 * HOUR);
    const keeper = await userAged('keeper', 2 * HOUR);
    await prisma.devicePasskey.create({
      data: { userId: keeper.id, credentialId: 'cred-2', publicKey: 'pk', counter: 0 },
    });

    expect(await cleanupOrphans()).toBe(2);
    expect(await exists(orphan1.id)).toBe(false);
    expect(await exists(orphan2.id)).toBe(false);
    expect(await exists(keeper.id)).toBe(true);
  });
});