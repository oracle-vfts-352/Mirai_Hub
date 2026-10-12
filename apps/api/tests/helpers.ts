import { beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { redis } from '../src/lib/redis';

// Wipes every table before each test. Refuses to run on any database except mirai_hub_test.
export async function resetDb() {
  const rows = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
  if (rows[0].db !== 'mirai_hub_test') {
    throw new Error(`Refusing to wipe database "${rows[0].db}"`);
  }
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Notification","Vote","Feedback","Post","Follow","DevicePasskey","Project","User" RESTART IDENTITY CASCADE',
  );
}

// Every test file imports this module, so these hooks apply to all of them.
beforeEach(resetDb);

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

export const anon = () => request(app);

export function makeUser(name: string, role: 'DEV' | 'CONSUMER' = 'CONSUMER') {
  return prisma.user.create({ data: { email: `${name}@test.com`, name, role } });
}

// Returns a supertest agent that keeps the session cookie (uses the dev login route)
export async function loginAs(email: string) {
  const agent = request.agent(app);
  await agent.post('/api/dev/login').send({ email }).expect(200);
  return agent;
}

export function makeProject(ownerId: string, slug = 'my-game') {
  return prisma.project.create({ data: { slug, name: 'My Game', ownerId } });
}

export function makeFeedback(projectId: string, authorId: string, title = 'Add fishing') {
  return prisma.feedback.create({ data: { projectId, authorId, title, body: 'Please add it' } });
}

// Standard cast: one owner (DEV) with one project, two fans who both follow it
export async function scenario() {
  const owner = await makeUser('owner', 'DEV');
  const fan1 = await makeUser('fan1');
  const fan2 = await makeUser('fan2');
  const project = await makeProject(owner.id);
  await prisma.follow.createMany({
    data: [
      { userId: fan1.id, projectId: project.id },
      { userId: fan2.id, projectId: project.id },
    ],
  });
  return {
    owner,
    fan1,
    fan2,
    project,
    ownerApi: await loginAs(owner.email),
    fan1Api: await loginAs(fan1.email),
    fan2Api: await loginAs(fan2.email),
  };
}