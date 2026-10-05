import { Router } from 'express';
import { z } from 'zod';
import { FeedbackStatus } from '@prisma/client';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { wrap } from '../lib/http';
import * as projects from '../services/projects';
import * as follows from '../services/follows';
import * as feedback from '../services/feedback';

const router = Router();

const slugSchema = z.string().trim().min(1).max(60);
const idSchema = z.string().uuid();

const createSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(1).max(5000),
});

const listSchema = z.object({
  status: z.nativeEnum(FeedbackStatus).optional(),
  sort: z.enum(['votes', 'new']).default('votes'),
});

const statusSchema = z.object({ status: z.nativeEnum(FeedbackStatus) });

// ---- Follows ----
router.put('/projects/:slug/follow', requireAuth, wrap(async (req, res) => {
  const projectId = await projects.projectIdFromSlug(slugSchema.parse(req.params.slug));
  await follows.follow(req.user!.userId, projectId);
  res.json({ following: true });
}));

router.delete('/projects/:slug/follow', requireAuth, wrap(async (req, res) => {
  const projectId = await projects.projectIdFromSlug(slugSchema.parse(req.params.slug));
  await follows.unfollow(req.user!.userId, projectId);
  res.json({ following: false });
}));

router.get('/me/follows', requireAuth, wrap(async (req, res) => {
  res.json(await follows.listFollowed(req.user!.userId));
}));

// ---- Feedback ----
router.post('/projects/:slug/feedback', requireAuth, wrap(async (req, res) => {
  const projectId = await projects.projectIdFromSlug(slugSchema.parse(req.params.slug));
  const data = createSchema.parse(req.body);
  res.status(201).json(await feedback.createFeedback(req.user!.userId, projectId, data));
}));

router.get('/projects/:slug/feedback', optionalAuth, wrap(async (req, res) => {
  const projectId = await projects.projectIdFromSlug(slugSchema.parse(req.params.slug));
  const q = listSchema.parse(req.query);
  res.json(await feedback.listFeedback(projectId, { ...q, viewerId: req.user?.userId }));
}));

// ---- Votes (idempotent: PUT adds, DELETE removes) ----
router.put('/feedback/:id/vote', requireAuth, wrap(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  res.json({ voteCount: await feedback.addVote(req.user!.userId, id) });
}));

router.delete('/feedback/:id/vote', requireAuth, wrap(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  res.json({ voteCount: await feedback.removeVote(req.user!.userId, id) });
}));

// ---- Status (owner only, enforced in the service) ----
router.patch('/feedback/:id/status', requireAuth, wrap(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const { status } = statusSchema.parse(req.body);
  res.json(await feedback.setStatus(req.user!.userId, id, status));
}));

export default router;