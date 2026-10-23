import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../middleware/auth';
import { wrap } from '../lib/http';
import { AppError } from '../lib/errors';
import * as feed from '../services/feed';

const router = Router();

const querySchema = z.object({
  scope: z.enum(['all', 'following']).default('all'),
});

router.get('/feed', optionalAuth, wrap(async (req, res) => {
  const { scope } = querySchema.parse(req.query);
  if (scope === 'following' && !req.user) throw new AppError(401, 'Not logged in');
  res.json(
    await feed.listFeed({ followerId: scope === 'following' ? req.user!.userId : undefined }),
  );
}));

export default router;