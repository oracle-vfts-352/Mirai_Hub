import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { signToken } from '../middleware/auth';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email ?? '').toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(404).json({ error: 'No such user' });
      return;
    }
    const token = signToken({ userId: user.id, role: user.role, purpose: 'session' }, '7d');
    res.cookie('auth_token', token, { httpOnly: true, sameSite: 'lax' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;