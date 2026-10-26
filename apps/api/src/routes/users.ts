import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { wrap } from '../lib/http';
import * as users from '../services/users';

const router = Router();

const idSchema = z.string().uuid();

// Unknown keys (role, email, ...) are dropped by zod, so they can never be edited here
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    bio: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.name !== undefined || d.bio !== undefined, { message: 'Nothing to update' });

// Public profile
router.get('/users/:id', wrap(async (req, res) => {
  res.json(await users.getPublicProfile(idSchema.parse(req.params.id)));
}));

// Edit your own profile
router.patch('/me', requireAuth, wrap(async (req, res) => {
  const data = updateSchema.parse(req.body);
  res.json(await users.updateMe(req.user!.userId, data));
}));

export default router;