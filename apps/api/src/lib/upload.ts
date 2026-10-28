import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { AppError } from './errors';

// Reads ONE image from the multipart field `field` into memory (never to disk)
// and turns multer's errors into normal API errors.
export function acceptImage(field: string, maxBytes: number): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
  });
  const mb = Math.round(maxBytes / (1024 * 1024));

  return (req: Request, res: Response, next: NextFunction) => {
    upload.single(field)(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, `Image is too large (max ${mb} MB)`));
        return next(new AppError(400, 'Invalid upload'));
      }
      next(err);
    });
  };
}