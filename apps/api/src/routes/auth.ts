import { Router } from 'express';
import { 
  getRegistrationOptions, 
  verifyRegistration,
  getAuthenticationOptions,
  verifyAuthentication 
} from '../controllers/auth_controller'; // 👈 Fixed file name format string alignment

const router = Router();

// ==================== CREDENTIAL REGISTRATION (ENROLLMENT) ====================
// Routes used to complete WebAuthn asymmetric key enrollment
router.post('/passkey/register-options', getRegistrationOptions);
router.post('/passkey/register-verify', verifyRegistration);

// ==================== SESSION AUTHENTICATION (LOGIN) ====================
// Routes used to verify hardware challenges and grant secure HttpOnly cookies 🍪
router.post('/passkey/login-options', getAuthenticationOptions);
router.post('/passkey/login-verify', verifyAuthentication);

export default router;
