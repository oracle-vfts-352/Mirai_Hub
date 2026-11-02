import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { sendMail } from '../src/lib/mail';
import { sendVerificationEmail } from '../src/services/emailVerification';
import { anon, makeUser } from './helpers';

const REQUEST = '/api/auth/email-login/request';
const VERIFY = '/api/auth/email-login/verify';

function lastToken(): string {
  const calls = vi.mocked(sendMail).mock.calls;
  const match = calls[calls.length - 1][0].text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('no token in the mail');
  return match[1];
}

// Asks for a link and waits for the background mail; returns the token from it.
async function linkFor(email: string, mailsSoFar = 0) {
  expect((await anon().post(REQUEST).send({ email })).status).toBe(200);
  await vi.waitFor(() => expect(sendMail).toHaveBeenCalledTimes(mailsSoFar + 1));
  return lastToken();
}

const settle = () => new Promise((r) => setTimeout(r, 200)); // for "no mail was sent" checks

describe('email-link sign-in: requesting a link', () => {
  it('mails a link to a verified account (any letter case), answering success', async () => {
    await makeUser('fan1');
    const res = await anon().post(REQUEST).send({ email: 'FAN1@test.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    await vi.waitFor(() => expect(sendMail).toHaveBeenCalledTimes(1));
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'fan1@test.com', subject: expect.stringContaining('sign-in') }),
    );
  });

  it('answers the same and sends nothing for an unknown address', async () => {
    const res = await anon().post(REQUEST).send({ email: 'nobody@test.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    await settle();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('answers the same and sends nothing for an account with an unverified email', async () => {
    await makeUser('newbie', 'CONSUMER', false);
    const res = await anon().post(REQUEST).send({ email: 'newbie@test.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    await settle();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rejects a body without a valid email (400)', async () => {
    expect((await anon().post(REQUEST).send({})).status).toBe(400);
    expect((await anon().post(REQUEST).send({ email: 'not-an-email' })).status).toBe(400);
  });

  it('a new request makes the older link stop working', async () => {
    await makeUser('fan1');
    const oldToken = await linkFor('fan1@test.com');
    const newToken = await linkFor('fan1@test.com', 1);
    expect(newToken).not.toBe(oldToken);

    expect((await anon().post(VERIFY).send({ token: oldToken })).status).toBe(400);
    expect((await anon().post(VERIFY).send({ token: newToken })).status).toBe(200);
  });
});

describe('email-link sign-in: using a link', () => {
  it('signs the user in (the session cookie works) and the link works only once', async () => {
    await makeUser('fan1');
    const token = await linkFor('fan1@test.com');

    const agent = request.agent(app);
    const res = await agent.post(VERIFY).send({ token });
    expect(res.status).toBe(200);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('fan1@test.com');

    expect((await anon().post(VERIFY).send({ token })).status).toBe(400);
  });

  it('an expired link is rejected', async () => {
    await makeUser('fan1');
    const token = await linkFor('fan1@test.com');
    await prisma.emailToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await anon().post(VERIFY).send({ token })).status).toBe(400);
  });

  it('an unknown token or a bad body gets 400', async () => {
    expect((await anon().post(VERIFY).send({ token: 'x'.repeat(43) })).status).toBe(400);
    expect((await anon().post(VERIFY).send({})).status).toBe(400);
  });

  it('a sign-in token cannot verify an email, and a verification token cannot sign in', async () => {
    await makeUser('fan1');
    const loginToken = await linkFor('fan1@test.com');
    expect((await anon().post('/api/auth/verify-email').send({ token: loginToken })).status).toBe(400);

    const unverified = await makeUser('newbie', 'CONSUMER', false);
    await sendVerificationEmail(unverified.id);
    const verifyToken = lastToken();
    expect((await anon().post(VERIFY).send({ token: verifyToken })).status).toBe(400);
  });

  it('a link stops working if the account is no longer verified', async () => {
    const user = await makeUser('fan1');
    const token = await linkFor('fan1@test.com');
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    expect((await anon().post(VERIFY).send({ token })).status).toBe(400);
  });
});