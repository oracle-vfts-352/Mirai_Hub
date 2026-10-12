import { Router } from 'express';
import { z } from 'zod';
import { PostType } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { wrap } from '../lib/http';
import * as posts from '../services/posts';

const router = Router();

const slugSchema = z.string().trim().min(1).max(60);

const createSchema = z.object({
  type: z.nativeEnum(PostType),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(1).max(10000),
});

const listSchema = z.object({
  type: z.nativeEnum(PostType).optional(),
});

router.post('/projects/:slug/posts', requireAuth, wrap(async (req, res) => {
  const slug = slugSchema.parse(req.params.slug);
  const data = createSchema.parse(req.body);
  res.status(201).json(await posts.createPost(req.user!.userId, slug, data));
}));

router.get('/projects/:slug/posts', wrap(async (req, res) => {
  const slug = slugSchema.parse(req.params.slug);
  const q = listSchema.parse(req.query);
  res.json(await posts.listPosts(slug, q));
}));

export default router;