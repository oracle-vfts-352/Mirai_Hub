import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../src/app';
import { config } from '../src/lib/config';
import { redis } from '../src/lib/redis';
import { prisma } from '../src/lib/prisma';
import { sendMail } from '../src/lib/mail';
import { signToken } from '../src/middleware/auth';
import { revokeToken } from '../src/lib/revocation';
import { anon, makeUser, makeProject } from './helpers';

// A real session token (from the dev login), so it can be replayed by hand
async function devToken(email: string): Promise<string> {
  const res = await request(app).post('/api/dev/login').send({ email });
  expect(res.status).toBe(200);
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('auth_token='))!;
  return cookie.split(';')[0].slice('auth_token='.length);
}
const withToken = (t: string) => `auth_token=${t}`;
const me = (t: string) => anon().get('/api/auth/me').set('Cookie', withToken(t));

describe('token revocation: single token (Redis denylist)', () => {
  it('logout puts the token on the denylist: replaying it gives 401', async () => {
    const user = await makeUser('fan1');
    const token = await devToken(user.email);
    expect((await me(token)).status).toBe(200);

    const out = await anon().post('/api/auth/logout').set('Cookie', withToken(token));
    expect(out.status).toBe(200);
    expect((await me(token)).status).toBe(401);
  });

  it('logout without any cookie still succeeds', async () => {
    expect((await anon().post('/api/auth/logout')).status).toBe(200);
  });

  it('logout also revokes the enroll cookie', async () => {
    const user = await makeUser('newbie', 'CONSUMER', false);
    const enroll = signToken({ userId: user.id, role: 'CONSUMER', purpose: 'enroll', tv: 0 }, '10m');
    const options = () =>
      anon().post('/api/auth/passkey/register-options').set('Cookie', `enroll_token=${enroll}`);

    expect((await options()).status).toBe(200);
    expect(
      (await anon().post('/api/auth/logout').set('Cookie', `enroll_token=${enroll}`)).status,
    ).toBe(200);
    expect((await options()).status).toBe(401);
  });

  it('stores a revoked jti with a TTL of the remaining token lifetime', async () => {
    const token = signToken({ userId: randomUUID(), role: 'CONSUMER', purpose: 'session', tv: 0 }, '1h');
    const payload = jwt.decode(token) as { jti: string; exp: number };
    await revokeToken(payload);
    const ttl = await redis.ttl(`revoked:${payload.jti}`);
    expect(ttl).toBeGreaterThan(3500);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it('does not store a token that has already expired', async () => {
    await revokeToken({ jti: 'expired-jti-test', exp: Math.floor(Date.now() / 1000) - 10 });
    expect(await redis.exists('revoked:expired-jti-test')).toBe(0);
  });
});

describe('token revocation: required claims', () => {
  it('rejects a session token without a jti', async () => {
    const user = await makeUser('fan1');
    const token = jwt.sign(
      { userId: user.id, role: 'CONSUMER', purpose: 'session', tv: 0 },
      config.jwtSecret,
      { expiresIn: '1h' },
    );
    expect((await me(token)).status).toBe(401);
  });

  it('rejects a session token without a tokenVersion', async () => {
    const user = await makeUser('fan1');
    const token = jwt.sign(
      { userId: user.id, role: 'CONSUMER', purpose: 'session' },
      config.jwtSecret,
      { expiresIn: '1h', jwtid: randomUUID() },
    );
    expect((await me(token)).status).toBe(401);
  });

  it('rejects a token whose tokenVersion is older than the user’s', async () => {
    const user = await makeUser('fan1');
    const old = signToken({ userId: user.id, role: 'CONSUMER', purpose: 'session', tv: 0 }, '7d');
    expect((await me(old)).status).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: 1 } });
    expect((await me(old)).status).toBe(401);

    const fresh = signToken({ userId: user.id, role: 'CONSUMER', purpose: 'session', tv: 1 }, '7d');
    expect((await me(fresh)).status).toBe(200);
  });
});

describe('sign out on all devices (tokenVersion)', () => {
  it('needs a login', async () => {
    expect((await anon().post('/api/auth/sessions/revoke-all')).status).toBe(401);
  });

  it('ends every session, and a new email-link sign-in works afterwards', async () => {
    const user = await makeUser('fan1');
    const a = await devToken(user.email);
    const b = await devToken(user.email);
    expect((await me(a)).status).toBe(200);
    expect((await me(b)).status).toBe(200);

    const res = await anon().post('/api/auth/sessions/revoke-all').set('Cookie', withToken(a));
    expect(res.status).toBe(200);
    expect((await me(a)).status).toBe(401);
    expect((await me(b)).status).toBe(401);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.tokenVersion).toBe(1);

    // a new sign-in gets a token with the NEW version
    await anon().post('/api/auth/email-login/request').send({ email: user.email }).expect(200);
    await vi.waitFor(() => expect(sendMail).toHaveBeenCalledTimes(1));
    const calls = vi.mocked(sendMail).mock.calls;
    const loginToken = calls[calls.length - 1][0].text.match(/token=([A-Za-z0-9_-]+)/)![1];
    const agent = request.agent(app);
    expect((await agent.post('/api/auth/email-login/verify').send({ token: loginToken })).status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });
});

describe('fail closed when the revocation check is unavailable', () => {
  it('answers 503 on a protected route (and works again afterwards)', async () => {
    const user = await makeUser('fan1');
    const token = await devToken(user.email);

    const spy = vi.spyOn(redis, 'exists').mockRejectedValueOnce(new Error('redis down'));
    expect((await me(token)).status).toBe(503);
    spy.mockRestore();

    expect((await me(token)).status).toBe(200);
  });

  it('treats the visitor as anonymous on a public page instead of failing', async () => {
    const owner = await makeUser('owner', 'DEV');
    const project = await makeProject(owner.id);
    const token = await devToken(owner.email);

    const spy = vi.spyOn(redis, 'exists').mockRejectedValueOnce(new Error('redis down'));
    const res = await anon().get(`/api/projects/${project.slug}/feedback`).set('Cookie', withToken(token));
    expect(res.status).toBe(200);
    spy.mockRestore();
  });
});