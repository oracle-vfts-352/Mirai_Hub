import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { ZodError } from 'zod';
import { config } from './lib/config';
import { AppError } from './lib/errors';
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import devRoutes from './routes/dev';
import feedbackRoutes from './routes/feedback';

const app = express();

// Behind nginx: lets Express see https and set secure cookies correctly
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: config.nodeEnv === 'production'
    ? [config.origin]
    : [config.origin, 'http://localhost:5173'], // 5173 = Vite dev server
  credentials: true,
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.use('/api', feedbackRoutes);

// ---------- Routes ----------
app.get('/api/health', (_req, res) => {
  res.json({ status: 'online' });
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);

// Dev-only login shortcut. Never enabled in production.
if (process.env.ENABLE_DEV_LOGIN === 'true' && config.nodeEnv !== 'production') {
  app.use('/api/dev', devRoutes);
}

// ---------- Error handler (must be LAST, only one) ----------
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.issues });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});