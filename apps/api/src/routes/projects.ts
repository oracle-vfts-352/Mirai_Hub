import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { requireVerified } from '../middleware/verified';
import { logoUploadLimiter } from '../middleware/rateLimit';
import { wrap } from '../lib/http';
import { AppError } from '../lib/errors';
import { acceptImage } from '../lib/upload';
import * as projects from '../services/projects';

const router = Router();

const RESERVED = ['mine', 'new', 'admin', 'api'];
const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB, only on the logo route

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
const slugSchema = z.string().trim().min(1).max(60);
const listSchema = z.object({ sort: z.enum(['new', 'followers']).default('new') });

// Public browse list
router.get('/', wrap(async (req, res) => {
  const { sort } = listSchema.parse(req.query);
  res.json(await projects.listProjects(sort));
}));

// Create (DEV only)
router.post('/', requireAuth, requireRole('DEV'), requireVerified, wrap(async (req, res) => {
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
  res.json(await projects.getBySlug(slugSchema.parse(req.params.slug)));
}));

// Update (owner only, enforced in the service)
router.patch('/:id', requireAuth, wrap(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const data = updateSchema.parse(req.body);
  res.json(await projects.updateProject(req.user!.userId, id, data));
}));

// Logo (owner only, enforced in the service): login, per-user limit, then the file is read
router.post('/:id/logo', requireAuth, logoUploadLimiter, acceptImage('logo', LOGO_MAX_BYTES), wrap(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  if (!req.file) throw new AppError(400, 'Attach an image in the "logo" field');
  res.json(await projects.setLogo(req.user!.userId, id, req.file.buffer));
}));

router.delete('/:id/logo', requireAuth, wrap(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  res.json(await projects.removeLogo(req.user!.userId, id));
}));

export default router;