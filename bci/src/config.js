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
};

export const isProduction = config.nodeEnv === 'production';
