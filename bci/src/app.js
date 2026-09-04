import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config, isProduction } from './config.js';
import { logger } from './logger.js';
import { requestId } from './middleware/requestId.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { scopesRouter } from './routes/scopes.js';
import { auditRouter } from './routes/audit.js';
import { assetsRouter } from './routes/assets.js';
import { scansRouter } from './routes/scans.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    })
  );
  app.use(helmet());

  // Fail closed in production: an unset allowlist means no browser origin is
  // trusted, mirroring ANATOLIA-Q's CORS posture. Server-to-server callers
  // (e.g. the ANATOLIA-Q backend) are not subject to this browser check.
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (!isProduction) return callback(null, true);
        if (config.allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '2mb' }));

  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/scopes', scopesRouter);
  app.use('/api/v1/audit', auditRouter);
  app.use('/api/v1/assets', assetsRouter);
  app.use('/api/v1/scans', scansRouter);

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', requestId: req.id });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    req.log?.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'internal_error', requestId: req.id });
  });

  return app;
}
