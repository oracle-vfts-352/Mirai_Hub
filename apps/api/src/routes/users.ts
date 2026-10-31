import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireVerified } from '../middleware/verified';
import { avatarUploadLimiter } from '../middleware/rateLimit';
import { wrap } from '../lib/http';
import { AppError } from '../lib/errors';
import * as users from '../services/users';
import * as avatars from '../services/avatars';

const router = Router();

const idSchema = z.string().uuid();

const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB, only on this route

// Unknown keys (role, email, ...) are dropped by zod, so they can never be edited here
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    bio: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.name !== undefined || d.bio !== undefined, { message: 'Nothing to update' });

// Files are kept in memory (then re-encoded and sent to object storage), never on disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
});

// Turns multer's errors into normal API errors
function acceptAvatar(req: Request, res: Response, next: NextFunction) {
  upload.single('avatar')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'Image is too large (max 2 MB)'));
      return next(new AppError(400, 'Invalid upload'));
    }
    next(err);
  });
}

// Public profile
router.get('/users/:id', wrap(async (req, res) => {
  res.json(await users.getPublicProfile(idSchema.parse(req.params.id)));
}));

// Edit your own profile
router.patch('/me', requireAuth, wrap(async (req, res) => {
  const data = updateSchema.parse(req.body);
  res.json(await users.updateMe(req.user!.userId, data));
}));

// Avatar: login first, then the per-user limit, then the upload is read
router.post('/me/avatar', requireAuth, requireVerified, avatarUploadLimiter, acceptAvatar, wrap(async (req, res) => {
  if (!req.file) throw new AppError(400, 'Attach an image in the "avatar" field');
  res.json(await avatars.setAvatar(req.user!.userId, req.file.buffer));
}));

router.delete('/me/avatar', requireAuth, wrap(async (req, res) => {
  res.json(await avatars.removeAvatar(req.user!.userId));
}));

export default router;