import { describe, it, expect, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { sendMail } from '../src/lib/mail';
import { sendVerificationEmail } from '../src/services/emailVerification';
import { anon, makeUser, loginAs } from './helpers';

// The token inside the most recent mail's link.
function lastToken(): string {
  const calls = vi.mocked(sendMail).mock.calls;
  const text = calls[calls.length - 1][0].text;
  const match = text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('no token in the mail');
  return match[1];
}

describe('email verification', () => {
  it('mails a link and stores only the hash of the token', async () => {
    const user = await makeUser('fan1', 'CONSUMER', false);
    await sendVerificationEmail(user.id);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'fan1@test.com', subject: expect.stringContaining('Verify') }),
    );
    const token = lastToken();
    const rows = await prisma.emailToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toHaveLength(64);
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].purpose).toBe('VERIFY_EMAIL');
  });

  it('opening the link verifies the account, once only', async () => {
    const user = await makeUser('fan1', 'CONSUMER', false);
    await sendVerificationEmail(user.id);
    const token = lastToken();

    const first = await anon().post('/api/auth/verify-email').send({ token });
    expect(first.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.emailVerifiedAt).not.toBeNull();

    const second = await anon().post('/api/auth/verify-email').send({ token });
    expect(second.status).toBe(400);
  });

  it('an expired link is rejected and verifies nothing', async () => {
    const user = await makeUser('fan1', 'CONSUMER', false);
    await sendVerificationEmail(user.id);
    const token = lastToken();
    await prisma.emailToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await anon().post('/api/auth/verify-email').send({ token });
    expect(res.status).toBe(400);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.emailVerifiedAt).toBeNull();
  });

  it('an unknown token or a bad body gets 400', async () => {
    const unknown = await anon().post('/api/auth/verify-email').send({ token: 'x'.repeat(43) });
    expect(unknown.status).toBe(400);
    expect((await anon().post('/api/auth/verify-email').send({})).status).toBe(400);
    expect((await anon().post('/api/auth/verify-email').send({ token: 'short' })).status).toBe(400);
  });

  it('a new mail makes the older link stop working', async () => {
    const user = await makeUser('fan1', 'CONSUMER', false);
    await sendVerificationEmail(user.id);
    const oldToken = lastToken();
    await sendVerificationEmail(user.id);
    const newToken = lastToken();
    expect(newToken).not.toBe(oldToken);

    expect((await anon().post('/api/auth/verify-email').send({ token: oldToken })).status).toBe(400);
    expect((await anon().post('/api/auth/verify-email').send({ token: newToken })).status).toBe(200);
  });

  it('the resend route needs a login', async () => {
    expect((await anon().post('/api/auth/verify-email/send')).status).toBe(401);
  });

  it('the resend route mails an unverified user, and does nothing for a verified one', async () => {
    const user = await makeUser('fan1', 'CONSUMER', false);
    const api = await loginAs(user.email);

    const res = await api.post('/api/auth/verify-email/send');
    expect(res.status).toBe(200);
    expect(res.body.alreadyVerified).toBe(false);
    expect(sendMail).toHaveBeenCalledTimes(1);

    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    const again = await api.post('/api/auth/verify-email/send');
    expect(again.status).toBe(200);
    expect(again.body.alreadyVerified).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1); // no second mail
  });

  it('the resend route answers 503 when the mail cannot be sent', async () => {
    const user = await makeUser('fan1', 'CONSUMER', false);
    const api = await loginAs(user.email);
    vi.mocked(sendMail).mockRejectedValueOnce(new Error('smtp down'));

    const res = await api.post('/api/auth/verify-email/send');
    expect(res.status).toBe(503);
  });

  it('/auth/me reports whether the email is verified', async () => {
    const user = await makeUser('fan1', 'CONSUMER', false);
    const api = await loginAs(user.email);
    expect((await api.get('/api/auth/me')).body.emailVerified).toBe(false);

    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    expect((await api.get('/api/auth/me')).body.emailVerified).toBe(true);
  });
});