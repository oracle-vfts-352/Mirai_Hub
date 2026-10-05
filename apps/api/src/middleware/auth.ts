import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../lib/config';

export type RoleName = 'CONSUMER' | 'DEV';

export interface TokenPayload {
  userId: string;
  role: RoleName;
  purpose: 'session' | 'enroll';
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function signToken(payload: TokenPayload, expiresIn: string): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn } as jwt.SignOptions);
}

// Requires a full login session
export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.cookies?.auth_token;
  if (!token) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as TokenPayload;
    if (decoded.purpose !== 'session') {
      res.status(401).json({ error: 'Not logged in' });
      return;
    }
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
};

// Allows either a full session OR the short-lived enrollment cookie from signup
export const requireEnrollOrAuth = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.cookies?.auth_token ?? req.cookies?.enroll_token;
  if (!token) {
    res.status(401).json({ error: 'Not authorized' });
    return;
  }
  try {
    req.user = jwt.verify(token, config.jwtSecret) as TokenPayload;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
};

export const requireRole = (role: RoleName) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (req.user?.role !== role) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };

  export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const token = req.cookies?.auth_token;
  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as TokenPayload;
      if (decoded.purpose === 'session') req.user = decoded;
    } catch {
      // invalid token: treat as logged out
    }
  }
  next();
};