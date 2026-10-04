import { Router, Request, Response } from 'express';
import { authenticateTenant } from '../middleware/auth';
import { PrismaClient } from '@prisma/client'; // Assuming database package linked

const router = Router();
const prisma = new PrismaClient();

// Apply your brand new tenant authentication middleware to protect this route
router.get('/campaigns', authenticateTenant, async (req: Request, res: Response) => {
  try {
    // Guaranteed to exist and be cryptographically verified thanks to the middleware
    const companyId = req.tenant!.companyId;

    // Multi-tenant database constraint isolation layer 
    const campaigns = await prisma.marketingCampaign.findMany({
      where: {
        companyId: companyId // Absolutely locked to this company's view!
      }
    });

    res.json({ success: true, data: campaigns });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error while fetching tenant data.' });
  }
});

export default router;
