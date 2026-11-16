import path from 'path';
import fs from 'fs';
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
import postsRoutes from './routes/posts';
import notificationsRoutes from './routes/notifications';
import feedRoutes from './routes/feed';
import usersRoutes from './routes/users';
import {
  globalLimiter,
  writeLimiter,
  signupLimiter,
  passkeyLimiter,
  feedbackCreateLimiter,
} from './middleware/rateLimit';

export const app = express();

// Behind nginx: lets Express see https and set secure cookies correctly
app.set('trust proxy', 1);

// Images live on another host (R2's public URL); the default CSP only allows 'self' and data:
const mediaOrigin = process.env.MEDIA_PUBLIC_URL ? new URL(process.env.MEDIA_PUBLIC_URL).origin : null;
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", 'data:', ...(mediaOrigin ? [mediaOrigin] : [])],
      },
    },
  }),
);

app.use(cors({
  origin: config.nodeEnv === 'production'
    ? [config.origin]
    : [config.origin, 'http://localhost:5173'], // 5173 = Vite dev server
  credentials: true,
}));

// ---------- Rate limits (before body parsing and routes) ----------
app.use('/api', globalLimiter);
app.use('/api', writeLimiter);
app.post('/api/auth/signup', signupLimiter);
app.use('/api/auth/passkey', passkeyLimiter);
app.post('/api/projects/:slug/feedback', feedbackCreateLimiter);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

//app.use('/api', feedbackRoutes);

// ---------- Routes ----------
app.get('/api/health', (_req, res) => {
  res.json({ status: 'online' });
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);

app.use('/api', postsRoutes);

app.use('/api', notificationsRoutes);

app.use('/api', feedRoutes);

app.use('/api', feedbackRoutes)

app.use('/api', usersRoutes);

// Dev-only login shortcut. Never enabled in production.
if (process.env.ENABLE_DEV_LOGIN === 'true' && config.nodeEnv !== 'production') {
  app.use('/api/dev', devRoutes);
}

// Demo deployment: the API also serves the built web app (one origin, like nginx does locally)
const webDist = process.env.WEB_DIST ?? path.resolve(__dirname, '../../web/dist');
if (process.env.SERVE_WEB === 'true' && fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1y', setHeaders: (res, file) => {
    if (file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
  } }));
  // SPA fallback for everything that is not an API call
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(webDist, 'index.html'));
  });
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