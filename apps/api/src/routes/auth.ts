import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  signup,
  getRegistrationOptions,
  verifyRegistration,
  getAuthenticationOptions,
  verifyAuthentication,
  me,
  logout,
  revokeAllSessions,
  setSessionCookie,
} from '../controllers/auth_controller';
import { requireAuth, requireEnrollOrAuth } from '../middleware/auth';
import {
  emailSendLimiter,
  emailVerifyLimiter,
  emailLoginIpLimiter,
  emailLoginAddressLimiter,
  revokeAllLimiter,
} from '../middleware/rateLimit';
import { sendVerificationEmail, verifyEmail } from '../services/emailVerification';
import { requestLoginEmail, consumeLoginToken } from '../services/emailLogin';
import { AppError } from '../lib/errors';

const router = Router();

// Express 4 doesn't catch rejected promises, so wrap async handlers
const wrap = (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

const tokenSchema = z.object({ token: z.string().min(20).max(200) });
const emailSchema = z.object({
  email: z.string().email().max(254).transform((e) => e.toLowerCase().trim()),
});

router.post('/signup', wrap(signup));

router.post('/passkey/register-options', requireEnrollOrAuth, wrap(getRegistrationOptions));
router.post('/passkey/register-verify', requireEnrollOrAuth, wrap(verifyRegistration));

router.post('/passkey/login-options', wrap(getAuthenticationOptions));
router.post('/passkey/login-verify', wrap(verifyAuthentication));

// "Resend": a new mail, older unused links stop working. Needs a login (and is limited per user).
router.post(
  '/verify-email/send',
  requireAuth,
  emailSendLimiter,
  wrap(async (req, res) => {
    try {
      const result = await sendVerificationEmail(req.user!.userId);
      res.json({ success: true, alreadyVerified: result.alreadyVerified });
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.error('Verification mail failed:', err instanceof Error ? err.message : err);
      throw new AppError(503, 'Could not send the email, please try again later');
    }
  }),
);

// The page behind the emailed link POSTs the token here. No login needed (the link may be
// opened on another device). POST, not GET, so mail scanners that prefetch links cannot use it up.
router.post(
  '/verify-email',
  emailVerifyLimiter,
  wrap(async (req, res) => {
    const { token } = tokenSchema.parse(req.body);
    await verifyEmail(token);
    res.json({ success: true });
  }),
);

// Email-link sign-in (fallback and recovery for accounts with a verified email).
// ALWAYS the same answer, whether or not the address has an account, and the answer does not wait
// for the mail: response and timing reveal nothing. Failures are only logged.
router.post(
  '/email-login/request',
  emailLoginIpLimiter,
  emailLoginAddressLimiter,
  wrap(async (req, res) => {
    const { email } = emailSchema.parse(req.body);
    requestLoginEmail(email).catch((err) =>
      console.error('Sign-in mail failed:', err instanceof Error ? err.message : err),
    );
    res.json({ success: true });
  }),
);

// The page behind the sign-in link POSTs the token here (POST so mail scanners cannot use it up).
router.post(
  '/email-login/verify',
  emailVerifyLimiter,
  wrap(async (req, res) => {
    const { token } = tokenSchema.parse(req.body);
    const user = await consumeLoginToken(token);
    res.clearCookie('enroll_token');
    setSessionCookie(res, user.id, user.role, user.tokenVersion);
    res.json({ success: true });
  }),
);

router.get('/me', requireAuth, wrap(me));
router.post('/logout', wrap(logout));

// Sign out on ALL devices (raises the user's tokenVersion).
router.post('/sessions/revoke-all', requireAuth, revokeAllLimiter, wrap(revokeAllSessions));

export default router;