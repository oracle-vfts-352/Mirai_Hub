import { Request, Response } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { config } from '../lib/config';
import { signToken, TokenPayload } from '../middleware/auth';
import { mediaUrl } from '../lib/storage';
import { sendVerificationEmail } from '../services/emailVerification';

const RP_NAME = 'Mirai Hub';
const isProd = config.nodeEnv === 'production';

const cookieBase = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
};

export function setSessionCookie(res: Response, userId: string, role: 'CONSUMER' | 'DEV') {
  const token = signToken({ userId, role, purpose: 'session' }, '7d');
  res.cookie('auth_token', token, { ...cookieBase, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

// ---------- SIGNUP ----------
const signupSchema = z.object({
  email: z.string().email().max(254).transform((e) => e.toLowerCase().trim()),
  name: z.string().min(1).max(80).trim(),
  role: z.enum(['CONSUMER', 'DEV']).default('DEV'),
});

export const signup = async (req: Request, res: Response): Promise<void> => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid email or name' });
    return;
  }
  const { email, name, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Same response either way would be ideal; kept explicit for now
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const user = await prisma.user.create({ data: { email, name, role } });

    // A signup starts a fresh identity: drop any old session so the passkey is registered for THIS account
  res.clearCookie('auth_token');
  const token = signToken({ userId: user.id, role: user.role, purpose: 'enroll' }, '10m');
  res.cookie('enroll_token', token, { ...cookieBase, maxAge: 10 * 60 * 1000 });
  
  res.status(201).json({ success: true });
};

// ---------- PASSKEY REGISTRATION ----------
export const getRegistrationOptions = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.user as TokenPayload; // from cookie, never from body

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const existing = await prisma.devicePasskey.findMany({ where: { userId } });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: config.rpId,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: 'none',
    excludeCredentials: existing.map((pk) => ({ id: pk.credentialId })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
  });

  await redis.set(`reg_challenge:${userId}`, options.challenge, 'EX', 300);
  res.json(options);
};

export const verifyRegistration = async (req: Request, res: Response): Promise<void> => {
  const { userId, role } = req.user as TokenPayload;
  const { credentialResponse } = req.body;

  const expectedChallenge = await redis.getdel(`reg_challenge:${userId}`);
  if (!expectedChallenge) {
    res.status(400).json({ error: 'Registration expired, start again' });
    return;
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: credentialResponse,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
    });

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({ error: 'Passkey verification failed' });
      return;
    }

    const { credential } = verification.registrationInfo;
    const isFirstPasskey = (await prisma.devicePasskey.count({ where: { userId } })) === 0;
    await prisma.devicePasskey.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
      },
    });

    // The first passkey completes the account: send the verification mail. Best effort, it never
    // blocks signup (the user can ask for another one with "resend").
    if (isFirstPasskey) {
      sendVerificationEmail(userId).catch((err) =>
        console.error('Verification mail failed:', err instanceof Error ? err.message : err),
      );
    }

    // Registering the first passkey logs the user in
    res.clearCookie('enroll_token');
    setSessionCookie(res, userId, role);
    res.json({ success: true });
  } catch (err) {
    console.error('Registration verify error:', err);
    res.status(400).json({ error: 'Passkey verification failed' });
  }
};

// ---------- PASSKEY LOGIN (usernameless) ----------
export const getAuthenticationOptions = async (_req: Request, res: Response): Promise<void> => {
  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    userVerification: 'preferred',
  });

  // No user is known yet, so key the challenge by a random id the client sends back
  const challengeId = crypto.randomUUID();
  await redis.set(`auth_challenge:${challengeId}`, options.challenge, 'EX', 300);
  res.cookie('challenge_id', challengeId, { ...cookieBase, maxAge: 5 * 60 * 1000 });

  res.json(options);
};

export const verifyAuthentication = async (req: Request, res: Response): Promise<void> => {
  const { credentialResponse } = req.body;
  const challengeId = req.cookies?.challenge_id;

  if (!challengeId || !credentialResponse?.id) {
    res.status(400).json({ error: 'Login expired, try again' });
    return;
  }

  const expectedChallenge = await redis.getdel(`auth_challenge:${challengeId}`);
  res.clearCookie('challenge_id');
  if (!expectedChallenge) {
    res.status(400).json({ error: 'Login expired, try again' });
    return;
  }

  const passkey = await prisma.devicePasskey.findUnique({
    where: { credentialId: credentialResponse.id },
    include: { user: true },
  });
  if (!passkey) {
    res.status(400).json({ error: 'Login failed' });
    return;
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: credentialResponse,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')),
        counter: passkey.counter,
      },
    });

    if (!verification.verified) {
      res.status(400).json({ error: 'Login failed' });
      return;
    }

    await prisma.devicePasskey.update({
      where: { credentialId: passkey.credentialId },
      data: { counter: verification.authenticationInfo.newCounter },
    });

    setSessionCookie(res, passkey.user.id, passkey.user.role);
    res.json({ success: true });
  } catch (err) {
    console.error('Login verify error:', err);
    res.status(400).json({ error: 'Login failed' });
  }
};

// ---------- SESSION ----------
export const me = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.user as TokenPayload;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, avatarKey: true, emailVerifiedAt: true },
  });
  if (!user) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }
  const { avatarKey, emailVerifiedAt, ...rest } = user;
  res.json({ ...rest, avatarUrl: mediaUrl(avatarKey), emailVerified: emailVerifiedAt !== null });
};

export const logout = (_req: Request, res: Response): void => {
  res.clearCookie('auth_token');
  res.clearCookie('enroll_token');
  res.json({ success: true });
};
