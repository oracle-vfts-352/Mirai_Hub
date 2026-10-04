import { Request, Response } from 'express';
import { 
  generateRegistrationOptions, 
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse 
} from '@simplewebauthn/server';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.connect().catch(console.error);

const rpName = 'Mirai Hub Platform';
const rpID = process.env.RP_ID || 'localhost'; 
const origin = process.env.ORIGIN || 'http://localhost:3000';

/**
 * 1. GENERATE REGISTRATION OPTIONS
 */
export const getRegistrationOptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { companyId, companyEmail } = req.body; 

    const existingPasskeys = await prisma.devicePasskey.findMany({
      where: { companyId }
    });

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new Uint8Array(Buffer.from(companyId, 'utf-8')), 
      userName: companyEmail,
      userDisplayName: companyEmail.split('@')[0],
      attestationType: 'none',
      excludeCredentials: existingPasskeys.map(pk => ({
        id: pk.credentialId, 
        type: 'public-key',
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
      },
    });

    await redisClient.setEx(`registration_challenge:${companyId}`, 300, options.challenge);

    res.json(options);
  } catch (error) {
    console.error('Passkey registration layout options failure:', error);
    res.status(500).json({ error: 'Failed to construct hardware asset tokens.' });
  }
};

/**
 * 2. VERIFY REGISTRATION RESPONSE
 */
export const verifyRegistration = async (req: Request, res: Response): Promise<void> => {
  try {
    const { companyId, credentialResponse } = req.body;

    const expectedChallenge = await redisClient.get(`registration_challenge:${companyId}`);
    if (!expectedChallenge) {
      res.status(400).json({ error: 'Verification transaction context has timed out.' });
      return;
    }

    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response: credentialResponse,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });
    } catch (verifError: any) {
      res.status(400).json({ error: `Cryptographic processing failed: ${verifError.message}` });
      return;
    }

    const { verified, registrationInfo } = verification;

    // 🌟 FIXED ERROR #2: Destructuring from 'registrationInfo.credential' per latest standard layout
    if (verified && registrationInfo?.credential) {
      const { id, publicKey, counter } = registrationInfo.credential;

      await redisClient.del(`registration_challenge:${companyId}`);

      await prisma.devicePasskey.create({
        data: {
          companyId,
          credentialId: Buffer.from(id).toString('base64url'),
          publicKey: Buffer.from(publicKey).toString('base64url'),
          counter: counter,
        },
      });

      res.json({ success: true, message: 'Asymmetric hardware matrix paired successfully!' });
    } else {
      res.status(400).json({ error: 'Device public key verification signatures rejected.' });
    }
  } catch (error) {
    console.error('Passkey creation pipeline failure:', error);
    res.status(500).json({ error: 'Database update failed during passkey persistence.' });
  }
};

/**
 * 3. GENERATE AUTHENTICATION OPTIONS (LOGIN INITIALIZATION)
 */
export const getAuthenticationOptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { companyId } = req.body;

    const existingPasskeys = await prisma.devicePasskey.findMany({
      where: { companyId }
    });

    if (existingPasskeys.length === 0) {
      res.status(400).json({ error: 'No validated passkeys linked with this profile node.' });
      return;
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: existingPasskeys.map(pk => ({
        id: pk.credentialId, 
        type: 'public-key',
      })),
      userVerification: 'preferred',
    });

    await redisClient.setEx(`auth_challenge:${companyId}`, 300, options.challenge);

    res.json(options);
  } catch (error) {
    console.error('Authentication matrix request failure:', error);
    res.status(500).json({ error: 'Authentication challenge creation process aborted.' });
  }
};

/**
 * 4. VERIFY AUTHENTICATION RESPONSE (LOGIN TRANSACTION SETTLED)
 */
export const verifyAuthentication = async (req: Request, res: Response): Promise<void> => {
  try {
    const { companyId, credentialResponse } = req.body;

    const expectedChallenge = await redisClient.get(`auth_challenge:${companyId}`);
    if (!expectedChallenge) {
      res.status(400).json({ error: 'Login verification validation parameters expired.' });
      return;
    }

    const passkey = await prisma.devicePasskey.findUnique({
      where: { credentialId: credentialResponse.id }
    });

    if (!passkey || passkey.companyId !== companyId) {
      res.status(400).json({ error: 'Hardware token assignment tracking missing.' });
      return;
    }

    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response: credentialResponse,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          // 🌟 FIXED ERROR #1 & #3: Using expected base64url or string mapping targets directly
          id: passkey.credentialId, 
          publicKey: Buffer.from(passkey.publicKey, 'base64url'), 
          counter: passkey.counter,
        },
      });
    } catch (verifError: any) {
      res.status(400).json({ error: `Signature verification failed: ${verifError.message}` });
      return;
    }

    const { verified, authenticationInfo } = verification;

    if (verified && authenticationInfo) {
      await redisClient.del(`auth_challenge:${companyId}`);

      await prisma.devicePasskey.update({
        where: { credentialId: passkey.credentialId },
        data: { counter: authenticationInfo.newCounter }
      });

      const secret = process.env.JWT_SECRET || 'fallback_development_secret_key';
      
      const token = jwt.sign(
        { userId: companyId, companyId: companyId, role: 'admin' },
        secret,
        { expiresIn: '7d' }
      );

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.json({ success: true, message: 'Authentication verified. Tenant space isolated.' });
    } else {
      res.status(400).json({ error: 'Biometric authorization check failure.' });
    }
  } catch (error) {
    console.error('Session establishment routine broken:', error);
    res.status(500).json({ error: 'System pipeline error during cookie generation handles.' });
  }
};