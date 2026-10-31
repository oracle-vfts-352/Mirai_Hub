import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

// Must run after requireAuth. Blocks accounts whose email is not verified yet.
export const requireVerified = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { emailVerifiedAt: true },
    });
    if (!user) {
      res.status(401).json({ error: 'Not logged in' });
      return;
    }
    if (!user.emailVerifiedAt) {
      res.status(403).json({
        error: 'Please verify your email first. We sent you a link, you can resend it from the banner at the top.',
        code: 'EMAIL_NOT_VERIFIED',
      });
      return;
    }
    next();
  } catch (err) {
    next(err); // Express 4 does not catch rejected promises
  }
};