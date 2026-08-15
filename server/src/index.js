import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import pinoHttp from 'pino-http';
import { fileURLToPath } from 'url';
import { logger } from './lib/logger.js';
import { attachSentryErrorHandler } from './lib/sentry.js';
import { initDatabase, initMemoryTables } from './services/database.js';
import { ensureDecisionTables, purgeExpiredDecisionRecords } from './services/decisionIntelligence.js';
import { initSocketHandlers } from './services/socket.js';
import { requestMetricsMiddleware } from './lib/requestMetrics.js';
import { analysisTraceMiddleware } from './middleware/analysisTrace.js';
import authRoutes from './routes/auth.js';
import analysisRoutes from './routes/analysis.js';
import emergencyRoutes from './routes/emergency.js';
import historyRoutes from './routes/history.js';
import voiceRoutes from './routes/voice.js';
import memoryRoutes from './routes/memory.js';
import filesRoutes from './routes/files.js';
import weatherRoutes from './routes/weather.js';
import platformRoutes from './routes/platform.js';
import syncRoutes from './routes/sync.js';
import deviceRoutes from './routes/devices.js';
import versionRoutes from './routes/version.js';
import { startMorningBriefScheduler } from './services/morningBrief.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The desktop (Electron) and mobile (Capacitor) apps load the SPA from a
// local origin that is never the deployed backend origin, so their API/
// socket calls are cross-origin even though they're the same app -- see
// desktop/main.js's STATIC_SERVER_PORT and client/src/services/api.js's
// baseFor(). These fixed origins must always be allowlisted, in addition to
// APP_URL, regardless of environment.
const NATIVE_APP_ORIGINS = [
  'http://127.0.0.1:57813', // Electron desktop static server (desktop/main.js)
  'capacitor://localhost',  // Capacitor Android WebView
  'https://localhost',      // Capacitor Android WebView (some configs)
  'http://localhost',       // Capacitor Android WebView (cleartext, some configs)
];

// In production, restrict cross-origin access to the app's own deployed
// origin (APP_URL) plus the native app origins above, instead of reflecting
// any origin. Locally (no APP_URL / non-production) all origins are still
// allowed for developer convenience.
const allowedOrigins = process.env.APP_URL ? [process.env.APP_URL, ...NATIVE_APP_ORIGINS] : true;

const app = express();
// The deployment platform's reverse proxy terminates TLS upstream and
// forwards plain HTTP internally -- without this, req.protocol always reads
// back 'http' regardless of what the client actually connected over, which
// leaked into routes/version.js's self-referential download URLs as an
// insecure http:// address (the client apps then failed to open/fetch it).
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(cors({ origin: allowedOrigins }));
// CSP is left disabled: the client is a Vite SPA served from this same
// server (see the static-file block below) and hasn't been audited for a
// restrictive script/style CSP -- enabling it blind risks breaking the app.
// The other baseline headers (X-Frame-Options, X-Content-Type-Options, HSTS,
// etc.) are still valuable on their own.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(pinoHttp({
  logger,
  // Authorization headers (raw JWTs) must never land in log output.
  redact: ['req.headers.authorization', 'res.headers["set-cookie"]'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestMetricsMiddleware);

// Lightweight liveness endpoint kept for external uptime monitors.
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', uptime: process.uptime(), timestamp: Date.now() });
});

// API routes
app.use('/api/auth', authRoutes);
// Observe generation responses and persist provenance/evidence/decision trace
// without changing the established analysis route implementation or UX.
app.use('/api/analysis', analysisTraceMiddleware, analysisRoutes);
app.use('/api/emergency', emergencyRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/voice',
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' }),
  voiceRoutes
);
app.use('/api/memory', memoryRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/platform', platformRoutes);
// Versioned alias for new institutional/platform integrations. Existing API
// paths remain stable for current clients while new consumers can target v1.
app.use('/api/v1/platform', platformRoutes);
// Desktop/multi-device offline sync -- see routes/sync.js and desktop/sync/.
app.use('/api/sync', syncRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/version', versionRoutes);

// Socket.IO handlers
initSocketHandlers(io);
app.set('io', io);

// After all routes — forwards uncaught errors to Sentry (no-op if SENTRY_DSN is unset)
attachSentryErrorHandler(app);

// Production: serve React build
if (process.env.NODE_ENV === 'production') {
  const clientBuildPath = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 10000;

// The HTTP port is opened immediately, independent of DB startup, so a slow
// or unreachable database never delays (or fails) the platform's readiness
// probe -- DB-backed routes already guard on isDbConfigured()/getDb() being
// null and degrade gracefully until initDatabase() below resolves.
server.listen(PORT, () => {
  logger.info({ port: PORT }, 'ANATOLIA-Q server running');
});

initDatabase()
  .then(() => initMemoryTables())
  .then(() => ensureDecisionTables())
  .then(() => {
    startMorningBriefScheduler();
    purgeExpiredDecisionRecords().catch((err) => logger.warn({ err }, 'Decision retention sweep failed'));
    const retentionTimer = setInterval(() => {
      purgeExpiredDecisionRecords().catch((err) => logger.warn({ err }, 'Decision retention sweep failed'));
    }, 6 * 60 * 60 * 1000);
    retentionTimer.unref();
    logger.info('Database ready');
  })
  .catch(err => {
    logger.error({ err }, 'Database initialization failed — continuing without DB');
  });
