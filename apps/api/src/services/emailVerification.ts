import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/errors';
import { config } from '../lib/config';
import { sendMail } from '../lib/mail';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // links stay valid for 24 hours

// Only the hash is stored, so a database leak gives nobody a working link.
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

// Creates a fresh token (older unused ones stop working) and mails the link.
// Throws if the mail cannot be sent: callers decide what that means.
export async function sendVerificationEmail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, emailVerifiedAt: true },
  });
  if (!user) throw new AppError(404, 'User not found');
  if (user.emailVerifiedAt) return { alreadyVerified: true };

  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.$transaction([
    prisma.emailToken.deleteMany({ where: { userId, purpose: 'VERIFY_EMAIL', usedAt: null } }),
    prisma.emailToken.create({
      data: {
        userId,
        purpose: 'VERIFY_EMAIL',
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    }),
  ]);

  const link = `${config.origin}/verify-email?token=${token}`;
  await sendMail({
    to: user.email,
    subject: 'Verify your email for Mirai Hub',
    text:
      `Hi ${user.name},\n\n` +
      `Confirm your email address by opening this link (valid for 24 hours):\n\n${link}\n\n` +
      `If you did not sign up for Mirai Hub, you can ignore this email.\n`,
  });
  return { alreadyVerified: false };
}

// Single use: the first request wins, a second one (or an expired or unknown token) gets the same 400.
export async function verifyEmail(token: string) {
  const invalid = () => new AppError(400, 'This link is invalid or has expired');

  const row = await prisma.emailToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!row || row.purpose !== 'VERIFY_EMAIL' || row.usedAt || row.expiresAt < new Date()) {
    throw invalid();
  }

  await prisma.$transaction(async (tx) => {
    const used = await tx.emailToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count === 0) throw invalid(); // someone else just used it
    await tx.user.updateMany({
      where: { id: row.userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
  });
}