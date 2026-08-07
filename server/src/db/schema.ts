/**
 * Drizzle schema — mirrors the existing table structure (the
 * CREATE TABLE IF NOT EXISTS statements in server/src/services/database.js)
 * one-to-one. database.js remains the source of truth for the schema; this
 * file generates no migrations, it only provides a typed query layer.
 * approval_tokens is NOT here — kept out of scope along with auth.js.
 */
import { pgTable, serial, varchar, text, boolean, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';

export const analyses = pgTable('analyses', {
  id: serial('id').primaryKey(),
  userCode: varchar('user_code', { length: 50 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  aiProvider: varchar('ai_provider', { length: 20 }),
  // Populated only for BDDK/BTK reports that ran the quantum kernel fraud
  // detector, so the fraud-trend view can aggregate without re-parsing
  // markdown -- see routes/analysis.js and routes/analysis.js's
  // /fraud-trend endpoint.
  fraudTransactionCount: integer('fraud_transaction_count'),
  fraudFlaggedCount: integer('fraud_flagged_count'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  fromUser: varchar('from_user', { length: 50 }).notNull(),
  toUser: varchar('to_user', { length: 50 }),
  message: text('message').notNull(),
  messageType: varchar('message_type', { length: 20 }).default('chat'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const emergencyLogs = pgTable('emergency_logs', {
  id: serial('id').primaryKey(),
  userCode: varchar('user_code', { length: 50 }),
  message: text('message').notNull(),
  target: varchar('target', { length: 50 }).notNull(),
  region: varchar('region', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const authUsers = pgTable('auth_users', {
  id: serial('id').primaryKey(),
  userCode: varchar('user_code', { length: 50 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  nickname: varchar('nickname', { length: 100 }),
  email: varchar('email', { length: 255 }),
  isAdmin: boolean('is_admin').default(false),
  blocked: boolean('blocked').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userProfiles = pgTable('user_profiles', {
  id: serial('id').primaryKey(),
  userCode: varchar('user_code', { length: 50 }).notNull().unique(),
  displayName: varchar('display_name', { length: 100 }),
  rank: varchar('rank', { length: 100 }),
  unit: varchar('unit', { length: 200 }),
  preferredPersona: varchar('preferred_persona', { length: 50 }).default('general'),
  preferredLang: varchar('preferred_lang', { length: 5 }).default('tr'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: serial('id').primaryKey(),
  userCode: varchar('user_code', { length: 50 }).notNull(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const conversationMemory = pgTable('conversation_memory', {
  id: serial('id').primaryKey(),
  userCode: varchar('user_code', { length: 50 }).notNull(),
  sessionTitle: varchar('session_title', { length: 300 }),
  personaId: varchar('persona_id', { length: 50 }),
  summary: text('summary'),
  keyFacts: text('key_facts'),
  fullHistory: jsonb('full_history'),
  archived: boolean('archived').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
