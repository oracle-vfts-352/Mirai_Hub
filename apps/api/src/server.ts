import express from 'express'; // 👈 Clean import now unlocked by esModuleInterop!
import cors from 'cors';
import cookieParser from 'cookie-parser'; // 🍪 Added for parsing HttpOnly security tokens
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { authenticateTenant } from './middleware/auth'; // 🛡️ Your multi-tenant guard
import authRoutes from './routes/auth'; // 🔑 Your passkey route manager
import customerRoutes from './routes/customers'; // 🔒 Your local encryption customer route manager
import { campaignQueue } from './queues/campaign_queue'; // 🐂 1. Import your BullMQ queue instance
import { startCampaignWorker } from './workers/campaign_worker'; // 🐂 2. Import your background queue worker

dotenv.config();

const app = express(); // 👈 This factory call will now work flawlessly!
const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;

// ==================== SECURITY HEADERS & DEFENSES ====================

// Standard CORS setup so our local web dev and Electron container can safely run fetch actions
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true // 🔒 Required to allow secure HttpOnly cookies to pass back and forth
}));

// Express built-in parser to read JSON request streams securely
app.use(express.json());

// Mount cookie parser middleware before routing engines fire up
app.use(cookieParser());

// ==================== AUTHENTICATION PATHWAYS ====================

// Mount your new biometric asymmetric registration and verification pathways
app.use('/api/auth', authRoutes);

// ==================== OPERATIONAL ENDPOINTS ====================

// Mount your brand new local AES-256 encrypted customer lead ingest pipelines 🔒
app.use('/api', customerRoutes);

// Root Check-in Route
app.get('/api/health', (req: express.Request, res: express.Response) => {
  res.json({ status: "online", system: "Mirai Hub Core Engine" });
});

// Multi-Tenant Campaign Fetching Endpoint
// 🛡️ Added authenticateTenant middleware to intercept and verify the session cookie!
app.get('/api/campaigns', authenticateTenant, async (req: express.Request, res: express.Response) => {
  try {
    // Cryptographically verified company context injected cleanly by your token middleware
    const activeCompanyId = req.tenant!.companyId; 

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

// Multi-Tenant Campaign Creation Endpoint Upgraded with Async BullMQ 🐂
// 🛡️ Added authenticateTenant middleware to securely isolate payload mutations!
app.post('/api/campaigns', authenticateTenant, async (req: express.Request, res: express.Response) => {
  try {
    const { title, type, bodyContent, targetingTags } = req.body;
    
    // Cryptographically verified company context injected cleanly by your token middleware
    const activeCompanyId = req.tenant!.companyId;

    // 1. Insert the new campaign row straight into PostgreSQL safely
    const newCampaign = await prisma.marketingCampaign.create({
      data: {
        title,
        type,
        status: 'queued', // Swapped status from 'draft' to 'queued' since it goes to the engine instantly!
        bodyContent,
        targetingTags,
        companyId: activeCompanyId // Binds this campaign data strictly to this tenant space
      }
    });

    // 🐂 2. DROP THE HEAVY TASK INTO THE BACKGROUND REDIS QUEUE!
    // This allows the server to finish the network request immediately without freezing the UI.
    await campaignQueue.add(`blast:${newCampaign.id}`, {
      campaignId: newCampaign.id,
      title: newCampaign.title,
      type: newCampaign.type,
      content: newCampaign.bodyContent,
      companyId: activeCompanyId
    });

    // Return the response immediately to give the user a snappy, lightning-fast UI experience
    res.status(201).json({
      success: true,
      message: "Campaign queued successfully into background distribution networks.",
      campaignId: newCampaign.id
    });
  } catch (error) {
    console.error("Database mutation exception:", error);
    res.status(400).json({ error: "Data payload layout validation failed" });
  }
});

// ==================== ENGINE STARTUP ====================

app.listen(PORT, () => {
  console.log(`🚀 Mirai Hub Core Engine listening securely on: http://localhost:${PORT}`);
});
