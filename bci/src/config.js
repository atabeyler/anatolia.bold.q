import 'dotenv/config';
import { validateEnv } from './lib/validateEnv.js';

validateEnv();

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 8081,
  databaseUrl: process.env.BCI_DATABASE_URL || 'postgres://bci:bci@localhost:5432/bci',
  databaseCaCert: process.env.BCI_DATABASE_CA_CERT || '',
  allowedOrigins: (process.env.BCI_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  logLevel: process.env.LOG_LEVEL || 'info',
  jwtSecret: process.env.BCI_JWT_SECRET || (process.env.NODE_ENV !== 'production' ? 'dev-only-insecure-secret' : ''),
  jwtTtlSeconds: Number(process.env.BCI_JWT_TTL_SECONDS) || 14400,
  bootstrap: {
    orgName: process.env.BCI_BOOTSTRAP_ORG_NAME || '',
    adminEmail: process.env.BCI_BOOTSTRAP_ADMIN_EMAIL || '',
    adminPassword: process.env.BCI_BOOTSTRAP_ADMIN_PASSWORD || '',
  },
};

export const isProduction = config.nodeEnv === 'production';
