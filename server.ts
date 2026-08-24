import './server/env';

import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { setupSocketIO } from './server/socket';
import apiRoutes from './server/routes';
import { initDatabase } from './server/db';
import { PORT, IS_PRODUCTION, isOriginAllowed, logConfigSummary, TRUST_PROXY_HOPS } from './server/env';

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  logConfigSummary();

  // Fails fast (process.exit) in production if the database is unreachable.
  await initDatabase();

  // Behind Render's proxy chain (Cloudflare + Render internal). Must resolve
  // req.ip to the REAL client, otherwise rate limiting keys on a shared proxy
  // address. See TRUST_PROXY_HOPS in server/env.ts.
  app.set('trust proxy', TRUST_PROXY_HOPS);

  // Security headers.
  app.use(
    helmet({
      // The SPA and its assets are same-origin; CSP is configured below.
      contentSecurityPolicy: IS_PRODUCTION
        ? {
            directives: {
              defaultSrc: ["'self'"],
              // Vite injects inline styles; Tailwind emits a stylesheet.
              styleSrc: ["'self'", "'unsafe-inline'"],
              scriptSrc: ["'self'"],
              imgSrc: ["'self'", 'data:', 'blob:'],
              // API + WebSocket.
              connectSrc: ["'self'", 'ws:', 'wss:', 'https:'],
              // Remote peer audio arrives as a blob-backed MediaStream.
              mediaSrc: ["'self'", 'blob:', 'mediastream:'],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      // Allows the Vercel frontend to load any assets served from here.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // CORS: only explicitly configured origins. Never reflects arbitrary values.
  app.use(
    cors({
      origin: (origin, cb) =>
        isOriginAllowed(origin) ? cb(null, true) : cb(new Error('Not allowed by CORS')),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Bounded request bodies — no unlimited payloads.
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: true, limit: '64kb' }));

  // Global safety net on top of the per-route limiters in routes.ts.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests. Please slow down.' },
    })
  );

  app.use('/api', apiRoutes);

  // Socket.IO multiplayer (authenticated in setupSocketIO).
  setupSocketIO(server);

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Only the built frontend is exposed. The compiled server lives in
    // build/ (see package.json) and is NOT inside this directory, so server
    // source and sourcemaps can never be downloaded over HTTP.
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, { index: false }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Error handler — never leaks stack traces to clients.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.message === 'Not allowed by CORS') {
      return res.status(403).json({ error: 'Origin not allowed.' });
    }
    console.error('[Bhabhi Server] Unhandled error:', err?.message);
    res.status(500).json({ error: 'Internal server error.' });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Bhabhi Server] Listening on 0.0.0.0:${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`);
  });

  const shutdown = (signal: string) => {
    console.log(`[Bhabhi Server] ${signal} received, shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch(err => {
  console.error('[Bhabhi Server] Fatal startup error:', err);
  process.exit(1);
});
