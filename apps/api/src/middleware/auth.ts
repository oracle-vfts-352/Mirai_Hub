import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// 1. Define the structure of your secure JWT payload
export interface TokenPayload {
  userId: string;
  companyId: string;
  role: string;
}

// 2. Extend Express Request type globally to cleanly store tenant context
declare global {
  namespace Express {
    interface Request {
      tenant?: TokenPayload;
    }
  }
}

export const authenticateTenant = (req: Request, res: Response, next: NextFunction): void => {
  // Upgraded from Bearer headers to Production-Grade Secure Cookies 🍪
  const token = req.cookies?.auth_token;
  
  if (!token) {
    res.status(401).json({ error: 'Access Denied: Secure session token missing.' });
    return;
  }

  try {
    // Verify signature using a server environment secret
    const secret = process.env.JWT_SECRET || 'fallback_development_secret_key';
    const decoded = jwt.verify(token, secret) as TokenPayload;

    // Strict validation check to ensure tenant parameter structure exists
    if (!decoded.companyId || !decoded.userId) {
      res.status(403).json({ error: 'Access Denied: Invalid tenant payload structure.' });
      return;
    }

    // Attach verified tenant metadata directly to request context
    req.tenant = decoded;
    
    // Pass control to the next middleware or route controller safely
    next();
  } catch (error) {
    res.status(403).json({ error: 'Access Denied: Expired or tampered authentication token.' });
    return;
  }
};
