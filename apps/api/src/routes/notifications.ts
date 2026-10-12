import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { wrap } from '../lib/http';
import * as notifications from '../services/notifications';

const router = Router();

const idSchema = z.string().uuid();
const listSchema = z.object({
  unread: z.enum(['true', 'false']).default('false'),
});

router.get('/me/notifications', requireAuth, wrap(async (req, res) => {
  const q = listSchema.parse(req.query);
  res.json(await notifications.listNotifications(req.user!.userId, { unreadOnly: q.unread === 'true' }));
}));

router.get('/me/notifications/unread-count', requireAuth, wrap(async (req, res) => {
  res.json({ unread: await notifications.unreadCount(req.user!.userId) });
}));

router.post('/me/notifications/read-all', requireAuth, wrap(async (req, res) => {
  res.json({ marked: await notifications.markAllRead(req.user!.userId) });
}));

router.patch('/notifications/:id/read', requireAuth, wrap(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  await notifications.markRead(req.user!.userId, id);
  res.json({ read: true });
}));

export default router;