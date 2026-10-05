import { Request, Response, NextFunction } from 'express';

// Express 4 doesn't catch rejected promises, so wrap async handlers
export const wrap =
  (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
