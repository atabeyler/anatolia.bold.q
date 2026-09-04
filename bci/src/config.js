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
  // M14: ANATOLIA-Q (or any other future gateway) trust boundary. Deliberately
  // a DIFFERENT secret from jwtSecret above -- a leak of one must never
  // compromise the other, and only a caller who knows this secret can mint a
  // gateway session at all (see routes/gateway.js).
  gatewaySecret: process.env.BCI_GATEWAY_SECRET || '',
  gatewayOrgSlug: process.env.BCI_GATEWAY_ORG_SLUG || 'anatolia-q',
  gatewaySessionTtlSeconds: Number(process.env.BCI_GATEWAY_SESSION_TTL_SECONDS) || 900,
  engineBins: {
    trivy: process.env.BCI_TRIVY_BIN || 'trivy',
    osvScanner: process.env.BCI_OSV_SCANNER_BIN || 'osv-scanner',
    semgrep: process.env.BCI_SEMGREP_BIN || 'semgrep',
    nuclei: process.env.BCI_NUCLEI_BIN || 'nuclei',
    naabu: process.env.BCI_NAABU_BIN || 'naabu',
  },
  // AI Decision Support (spec section 41-43): AI_DISABLED is the safe
  // default -- BCI's own security analysis never depends on it being
  // configured. EXTERNAL_AI requires an API key; LOCAL_AI/PRIVATE_AI are
  // reserved for a future on-prem/local-model provider, not implemented yet.
  aiMode: process.env.BCI_AI_MODE || 'AI_DISABLED',
  anthropicApiKey: process.env.BCI_ANTHROPIC_API_KEY || '',
  bootstrap: {
    orgName: process.env.BCI_BOOTSTRAP_ORG_NAME || '',
    adminEmail: process.env.BCI_BOOTSTRAP_ADMIN_EMAIL || '',
    adminPassword: process.env.BCI_BOOTSTRAP_ADMIN_PASSWORD || '',
  },
};

export const isProduction = config.nodeEnv === 'production';
