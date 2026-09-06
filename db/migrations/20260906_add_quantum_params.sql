-- Migration: add quantum_params and audit table for feature toggles (dos, fuzz, intrusive)
-- Run with your migration tool (psql/knex/db-migrate)

CREATE TABLE IF NOT EXISTS quantum_params (
  feature TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMP WITH TIME ZONE NULL,
  updated_by TEXT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  reason TEXT NULL
);

CREATE TABLE IF NOT EXISTS quantum_param_audit (
  id BIGSERIAL PRIMARY KEY,
  feature TEXT NOT NULL,
  old_enabled BOOLEAN NOT NULL,
  new_enabled BOOLEAN NOT NULL,
  changed_by TEXT,
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NULL,
  reason TEXT NULL
);
