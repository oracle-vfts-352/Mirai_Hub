import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

function limiter(windowMs: number, limit: number, skip?: (req: Request) => boolean) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7', // sends RateLimit / RateLimit-Policy headers
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
    // lets automated tests (NODE_ENV=test) run without hitting limits
    skip: (req) => process.env.NODE_ENV === 'test' || (skip ? skip(req) : false),
  });
}

// Everything under /api, per IP. Generous: protects against floods, not normal use.
export const globalLimiter = limiter(60_000, 300, (req) => req.path === '/health');

// All writes (POST/PUT/PATCH/DELETE) except auth, which has its own limits below.
export const writeLimiter = limiter(
  60_000,
  60,
  (req) => SAFE_METHODS.includes(req.method) || req.path.startsWith('/auth'),
);

// Account creation: slow down mass signups.
export const signupLimiter = limiter(60 * 60_000, 10);

// Passkey register/login steps (each attempt uses 2 requests: options + verify).
export const passkeyLimiter = limiter(15 * 60_000, 30);

// Feedback creation is the spammable one: tighter than the general write limit.
export const feedbackCreateLimiter = limiter(10 * 60_000, 10);

// Avatar uploads: per USER (not per IP), 5 per hour. Counts only uploads, not removals.
// Must run after requireAuth, because the key comes from req.user.
export const avatarUploadLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many avatar uploads, please try again later' },
  keyGenerator: (req) => req.user!.userId,
  skip: () => process.env.NODE_ENV === 'test',
});