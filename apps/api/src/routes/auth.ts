import { Router, Request, Response, NextFunction } from 'express';
import {
  signup,
  getRegistrationOptions,
  verifyRegistration,
  getAuthenticationOptions,
  verifyAuthentication,
  me,
  logout,
} from '../controllers/auth_controller';
import { requireAuth, requireEnrollOrAuth } from '../middleware/auth';

const router = Router();

// Express 4 doesn't catch rejected promises, so wrap async handlers
const wrap = (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

router.post('/signup', wrap(signup));

router.post('/passkey/register-options', requireEnrollOrAuth, wrap(getRegistrationOptions));
router.post('/passkey/register-verify', requireEnrollOrAuth, wrap(verifyRegistration));

router.post('/passkey/login-options', wrap(getAuthenticationOptions));
router.post('/passkey/login-verify', wrap(verifyAuthentication));

router.get('/me', requireAuth, wrap(me));
router.post('/logout', wrap(logout));

export default router;