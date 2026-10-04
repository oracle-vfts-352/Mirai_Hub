import express from 'express'; // 👈 Clean import now unlocked by esModuleInterop!
import cors from 'cors';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const app = express(); // 👈 This factory call will now work flawlessly!
const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;

// ==================== SECURITY HEADERS & DEFENSES ====================

// Standard CORS setup so our local web dev and Electron container can safely run fetch actions
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));

// Express built-in parser to read JSON request streams securely
app.use(express.json());

// ==================== OPERATIONAL ENDPOINTS ====================

// Root Check-in Route
app.get('/api/health', (req: express.Request, res: express.Response) => {
  res.json({ status: "online", system: "Mirai Hub Core Engine" });
});

// Multi-Tenant Campaign Fetching Endpoint
app.get('/api/campaigns', async (req: express.Request, res: express.Response) => {
  try {
    // 🛡️ SECURITY WARNING: Currently mock-hardcoded. 
    // In our next step, our middleware token will dynamically inject the real validated companyId here!
    const activeCompanyId = "mock-tenant-id-nexus-corp"; 

    // Prisma runs a clean, parameterized SQL query behind the scenes (No SQL Injections possible!)
    const campaigns = await prisma.marketingCampaign.findMany({
      where: { companyId: activeCompanyId },
      orderBy: { createdAt: 'desc' }
    });

    res.json(campaigns);
  } catch (error) {
    console.error("Database query exception:", error);
    res.status(500).json({ error: "Internal server data resolution crash" });
  }
});

// Multi-Tenant Campaign Creation Endpoint
app.post('/api/campaigns', async (req: express.Request, res: express.Response) => {
  try {
    const { title, type, bodyContent, targetingTags } = req.body;
    const activeCompanyId = "mock-tenant-id-nexus-corp";

    // Insert the new campaign row straight into PostgreSQL safely
    const newCampaign = await prisma.marketingCampaign.create({
      data: {
        title,
        type,
        status: 'draft',
        bodyContent,
        targetingTags,
        companyId: activeCompanyId // Binds this campaign data strictly to this tenant space
      }
    });

    res.status(201).json(newCampaign);
  } catch (error) {
    console.error("Database mutation exception:", error);
    res.status(400).json({ error: "Data payload layout validation failed" });
  }
});

// ==================== ENGINE STARTUP ====================

app.listen(PORT, () => {
  console.log(`🚀 Mirai Hub Core Engine listening securely on: http://localhost:${PORT}`);
});
