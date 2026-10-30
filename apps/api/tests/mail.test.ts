import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn(async () => ({}));
  return { sendMailMock, createTransportMock: vi.fn(() => ({ sendMail: sendMailMock })) };
});
vi.mock('nodemailer', () => ({ default: { createTransport: createTransportMock } }));

const KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE'];

// The global setup mocks lib/mail, so load the REAL module (fresh each time: it caches its transport).
// Importing config runs dotenv, which may add SMTP_* values from apps/api/.env, so the test's own
// values are set AFTER the import (config reads them lazily, at call time).
async function realMail(env: Record<string, string> = {}) {
  vi.resetModules();
  const mod = await vi.importActual<typeof import('../src/lib/mail')>('../src/lib/mail');
  KEYS.forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
  return mod;
}

beforeEach(() => {
  sendMailMock.mockClear();
  createTransportMock.mockClear();
});
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe('mail module', () => {
  it('sends with the configured sender and no auth for a local catcher', async () => {
    const { sendMail } = await realMail({
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      SMTP_FROM: 'Mirai Hub <noreply@mirai-hub.local>',
    });

    await sendMail({ to: 'a@test.com', subject: 'Hello', text: 'Hi there' });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost', port: 1025, secure: false, auth: undefined }),
    );
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'Mirai Hub <noreply@mirai-hub.local>',
      to: 'a@test.com',
      subject: 'Hello',
      text: 'Hi there',
    });
  });

  it('uses auth only when both user and password are set', async () => {
    const { sendMail } = await realMail({
      SMTP_HOST: 'smtp.example.com',
      SMTP_FROM: 'noreply@example.com',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      SMTP_SECURE: 'true',
    });

    await sendMail({ to: 'a@test.com', subject: 'x', text: 'y' });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, auth: { user: 'user', pass: 'pass' } }),
    );
  });

  it('fails clearly when SMTP_HOST is missing', async () => {
    const { sendMail } = await realMail({ SMTP_FROM: 'noreply@example.com' });
    await expect(sendMail({ to: 'a@test.com', subject: 'x', text: 'y' })).rejects.toThrow(
      'SMTP_HOST is required',
    );
  });
});