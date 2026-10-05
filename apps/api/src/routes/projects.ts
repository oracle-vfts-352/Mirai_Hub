import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { wrap } from '../lib/http';
import * as projects from '../services/projects';

const router = Router();

const RESERVED = ['mine', 'new', 'admin', 'api'];

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'Use 3-40 letters, numbers or dashes')
    .refine((s) => !RESERVED.includes(s), 'That slug is reserved'),
  tagline: z.string().trim().max(160).optional(),
  vision: z.string().trim().max(5000).optional(),
});

const updateSchema = createSchema.pick({ name: true, tagline: true, vision: true }).partial();
const idSchema = z.string().uuid();

// Create (DEV only)
router.post('/', requireAuth, requireRole('DEV'), wrap(async (req, res) => {
  const data = createSchema.parse(req.body);
  const project = await projects.createProject(req.user!.userId, data);
  res.status(201).json(project);
}));

// My projects (must come before '/:slug')
router.get('/mine', requireAuth, wrap(async (req, res) => {
  res.json(await projects.listMine(req.user!.userId));
}));

// Public project page
router.get('/:slug', wrap(async (req, res) => {
  res.json(await projects.getBySlug(req.params.slug));
}));

// Update (owner only, enforced in the service)
router.patch('/:id', requireAuth, wrap(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const data = updateSchema.parse(req.body);
  res.json(await projects.updateProject(req.user!.userId, id, data));
}));

export default router;