import { Router, Request, Response } from 'express';
import { authenticateTenant } from '../middleware/auth';
import { CryptoUtils } from '../utils/crypto';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

/**
 * SECURE ACCOUNT CLIENT INGESTION ROUTE
 * Encrypts data strings locally on your server before sending it over to PostgreSQL!
 */
router.post('/customers', authenticateTenant, async (req: Request, res: Response) => {
  try {
    const { name, email, tags } = req.body;
    const companyId = req.tenant!.companyId; // Multi-tenant context injection

    if (!name || !email) {
      res.status(400).json({ error: 'Name and email parameters are mandatory.' });
      return;
    }

    // 🔒 SCRAMBLE DATA LOCALLY: Turn raw strings into cryptographically secure blocks
    const secureName = CryptoUtils.encrypt(name);
    const secureEmail = CryptoUtils.encrypt(email);

    // Save to the database using your real schema columns!
    const customerRecord = await prisma.encryptedCustomer.create({
      data: {
        companyId,
        secureName,
        secureEmail,
        tags: tags || []
      }
    });

    // Strip out the encrypted strings for the return success response payload so the UI doesn't stutter
    res.status(201).json({
      success: true,
      customerId: customerRecord.id,
      message: 'Customer dataset encrypted and persisted safely.'
    });
  } catch (error) {
    console.error('Customer registration failure:', error);
    res.status(500).json({ error: 'Internal system fault handling data mutations.' });
  }
});

export default router;
