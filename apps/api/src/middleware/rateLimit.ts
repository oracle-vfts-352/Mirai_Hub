import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Request } from 'express';
import { redis } from '../lib/redis';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// One store per limiter, each with its own key prefix, so counters never mix.
// Counters live in Redis: they survive API restarts and are shared by every API container.
function store(name: string) {
  return new RedisStore({
    prefix: `rl:${name}:`,
    sendCommand: (command: string, ...args: string[]) =>
      redis.call(command, ...args) as Promise<any>,
  });
}

// Shared options. passOnStoreError: if Redis hiccups, let the request through (fail open)
// instead of turning every request into a 500.
const base = {
  standardHeaders: 'draft-7' as const, // sends RateLimit / RateLimit-Policy headers
  legacyHeaders: false,
  passOnStoreError: true,
};

function limiter(name: string, windowMs: number, limit: number, skip?: (req: Request) => boolean) {
  return rateLimit({
    ...base,
    windowMs,
    limit,
    store: store(name),
    message: { error: 'Too many requests, please try again later' },
    // lets automated tests (NODE_ENV=test) run without hitting limits
    skip: (req) => process.env.NODE_ENV === 'test' || (skip ? skip(req) : false),
  });
}

// Per USER (not per IP). Must run after requireAuth, because the key comes from req.user.
function userLimiter(name: string, limit: number, what: string) {
  return rateLimit({
    ...base,
    windowMs: 60 * 60_000,
    limit,
    store: store(name),
    message: { error: `Too many ${what} uploads, please try again later` },
    keyGenerator: (req) => req.user!.userId,
    skip: () => process.env.NODE_ENV === 'test',
  });
}

// Everything under /api, per IP. Generous: protects against floods, not normal use.
export const globalLimiter = limiter('global', 60_000, 300, (req) => req.path === '/health');

// All writes (POST/PUT/PATCH/DELETE) except auth, which has its own limits below.
export const writeLimiter = limiter(
  'write',
  60_000,
  60,
  (req) => SAFE_METHODS.includes(req.method) || req.path.startsWith('/auth'),
);

// Account creation: slow down mass signups.
export const signupLimiter = limiter('signup', 60 * 60_000, 10);

// Passkey register/login steps (each attempt uses 2 requests: options + verify).
export const passkeyLimiter = limiter('passkey', 15 * 60_000, 30);

// Feedback creation is the spammable one: tighter than the general write limit.
export const feedbackCreateLimiter = limiter('feedback', 10 * 60_000, 10);

// Avatar uploads: 5 per hour per user. Counts only uploads, not removals.
export const avatarUploadLimiter = userLimiter('avatar', 5, 'avatar');

// Cover uploads: 20 per hour per user (owners only; a post can be re-uploaded a few times).
export const coverUploadLimiter = userLimiter('cover', 20, 'cover');

// Logo uploads: 10 per hour per user.
export const logoUploadLimiter = userLimiter('logo', 10, 'logo');