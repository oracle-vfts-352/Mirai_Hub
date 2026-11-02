import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { config } from '../lib/config';
import { sendMail } from '../lib/mail';

const LOGIN_TTL_MS = 15 * 60 * 1000; // sign-in links are short-lived: 15 minutes

// Only the hash is stored, so a database leak gives nobody a working link.
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

// Mails a sign-in link, but ONLY for an existing account with a verified email.
// Silent otherwise: the caller answers the same either way, so nobody can probe for accounts.
export async function requestLoginEmail(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, emailVerifiedAt: true },
  });
  if (!user || !user.emailVerifiedAt) return;

  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.$transaction([
    prisma.emailToken.deleteMany({ where: { userId: user.id, purpose: 'LOGIN', usedAt: null } }),
    prisma.emailToken.create({
      data: {
        userId: user.id,
        purpose: 'LOGIN',
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + LOGIN_TTL_MS),
      },
    }),
  ]);

  const link = `${config.origin}/email-login?token=${token}`;
  await sendMail({
    to: user.email,
    subject: 'Your Mirai Hub sign-in link',
    text:
      `Hi ${user.name},\n\n` +
      `Use this link to sign in (valid for 15 minutes, works once):\n\n${link}\n\n` +
      `If you did not ask for it, you can ignore this email: nobody can sign in without the link.\n`,
  });
}

// Single use. Unknown, used, expired, wrong kind of token, or an account that is no longer verified:
// all give the same 400.
export async function consumeLoginToken(token: string) {
  const invalid = () => new AppError(400, 'This link is invalid or has expired');

  const row = await prisma.emailToken.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: { select: { id: true, role: true, emailVerifiedAt: true } } },
  });
  if (
    !row ||
    row.purpose !== 'LOGIN' ||
    row.usedAt ||
    row.expiresAt < new Date() ||
    !row.user.emailVerifiedAt
  ) {
    throw invalid();
  }

  const used = await prisma.emailToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (used.count === 0) throw invalid(); // someone else just used it

  return { id: row.user.id, role: row.user.role };
}