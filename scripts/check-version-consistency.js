#!/usr/bin/env node
// Release version authority is the three package.json files. Their versions
// must match exactly because root package.json names the desktop/Android
// artifact, client/package.json is embedded into the Vite build, and
// server/package.json identifies the deployed backend. package-lock.json's
// root `version` field is only package metadata (npm ci validates the actual
// dependency graph/integrity separately), so a connector/API commit that
// changes no dependencies must not block a release solely because that
// informational field still shows the previous app version. The normal
// developer path (`scripts/bump-version.js`) continues updating those lock
// headers and the README badge when hooks run locally.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const packageTargets = [
  'package.json',
  'client/package.json',
  'server/package.json',
];

const versions = packageTargets.map((p) => JSON.parse(readFileSync(path.join(root, p), 'utf-8')).version);
const canonical = versions[0];
const mismatched = packageTargets
  .map((file, i) => ({ file, version: versions[i] }))
  .filter((entry) => entry.version !== canonical);

if (!canonical || mismatched.length) {
  console.error('Version mismatch across release package.json files:');
  packageTargets.forEach((file, i) => console.error(`  ${file}: ${versions[i]}`));
  console.error('\nKeep root/client/server package.json on the same version before releasing.');
  process.exit(1);
}

const lockTargets = [
  'package-lock.json',
  'client/package-lock.json',
  'server/package-lock.json',
];
const staleLockHeaders = [];
for (const file of lockTargets) {
  try {
    const lock = JSON.parse(readFileSync(path.join(root, file), 'utf-8'));
    const version = lock.packages?.['']?.version ?? lock.version;
    if (version && version !== canonical) staleLockHeaders.push(`${file}:${version}`);
  } catch (err) {
    console.error(`Invalid ${file}: ${err.message}`);
    process.exit(1);
  }
}

if (staleLockHeaders.length) {
  console.warn(`Lockfile package-version metadata is stale (${staleLockHeaders.join(', ')}); dependency integrity is still enforced by npm ci. Run scripts/bump-version.js on the next normal version bump to refresh these headers.`);
}

console.log(`Version consistency OK: ${canonical} (package.json, client/package.json, server/package.json)`);
