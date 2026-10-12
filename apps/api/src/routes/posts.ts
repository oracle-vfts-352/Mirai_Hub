import { Router } from 'express';
import { z } from 'zod';
import { PostType } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { wrap } from '../lib/http';
import * as posts from '../services/posts';

const router = Router();

const slugSchema = z.string().trim().min(1).max(60);
const idSchema = z.string().uuid();

const createSchema = z.object({
  type: z.nativeEnum(PostType),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(1).max(10000),
});

// Same rules as create, but every field optional; at least one must be present.
const updateSchema = createSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

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

router.patch('/posts/:id', requireAuth, wrap(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const data = updateSchema.parse(req.body);
  res.json(await posts.updatePost(req.user!.userId, id, data));
}));

router.delete('/posts/:id', requireAuth, wrap(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  await posts.deletePost(req.user!.userId, id);
  res.json({ deleted: true });
}));

export default router;