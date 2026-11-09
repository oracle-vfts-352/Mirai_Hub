import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { config } from '../lib/config';
import { prisma } from '../lib/prisma';
import { isRevoked } from '../lib/revocation';

export type RoleName = 'CONSUMER' | 'DEV';
type Purpose = 'session' | 'enroll';

export interface TokenPayload {
  userId: string;
  role: RoleName;
  purpose: Purpose;
  tv: number; // the user's tokenVersion when the token was issued
  jti: string; // unique id of this token (for the Redis denylist)
  exp?: number;
  iat?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

type TokenInput = { userId: string; role: RoleName; purpose: Purpose; tv?: number };

// Every token gets its own jti. A caller that passes no tv gets 0 (a token with an OLD version is
// rejected, so forgetting it can only lock someone out, never let someone in).
export function signToken(payload: TokenInput, expiresIn: string): string {
  const { tv = 0, ...rest } = payload;
  return jwt.sign({ ...rest, tv }, config.jwtSecret, {
    expiresIn,
    jwtid: randomUUID(),
  } as jwt.SignOptions);
}

type Checked = { ok: true; payload: TokenPayload } | { ok: false; status: number; error: string };

// Signature + expiry, then the two revocation checks. Never throws.
// Redis or the database unavailable => 503 (fail CLOSED, no token is trusted unchecked).
async function checkToken(token: string, allowed: Purpose[]): Promise<Checked> {
  let decoded: TokenPayload;
  try {
    decoded = jwt.verify(token, config.jwtSecret) as TokenPayload;
  } catch {
    return { ok: false, status: 401, error: 'Session expired' };
  }
  // Tokens from before the revocation feature have no jti / tv: reject them
  if (
    !allowed.includes(decoded.purpose) ||
    typeof decoded.jti !== 'string' ||
    typeof decoded.tv !== 'number'
  ) {
    return { ok: false, status: 401, error: 'Not logged in' };
  }
  try {
    const [revoked, user] = await Promise.all([
      isRevoked(decoded.jti),
      prisma.user.findUnique({ where: { id: decoded.userId }, select: { tokenVersion: true } }),
    ]);
    if (revoked || !user || user.tokenVersion !== decoded.tv) {
      return { ok: false, status: 401, error: 'Session expired' };
    }
  } catch (err) {
    console.error('Token check failed:', err instanceof Error ? err.message : err);
    return { ok: false, status: 503, error: 'Service temporarily unavailable, please try again' };
  }
  return { ok: true, payload: decoded };
}

// Requires a full login session
export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = req.cookies?.auth_token;
  if (!token) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }
  const result = await checkToken(token, ['session']);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  req.user = result.payload;
  next();
};

// Allows either a full session OR the short-lived enrollment cookie from signup
export const requireEnrollOrAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = req.cookies?.auth_token ?? req.cookies?.enroll_token;
  if (!token) {
    res.status(401).json({ error: 'Not authorized' });
    return;
  }
  const result = await checkToken(token, ['session', 'enroll']);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  req.user = result.payload;
  next();
};

export const requireRole = (role: RoleName) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (req.user?.role !== role) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };

// Public pages: anything that is not a verified, unrevoked session means "anonymous"
// (which is also the safe choice when Redis cannot be checked).
export const optionalAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const token = req.cookies?.auth_token;
  if (token) {
    const result = await checkToken(token, ['session']);
    if (result.ok) req.user = result.payload;
  }
  next();
};