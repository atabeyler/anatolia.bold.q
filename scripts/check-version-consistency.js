#!/usr/bin/env node
// Fails (non-zero exit) if package.json/client/package.json/server/package.json
// disagree on version. scripts/bump-version.js keeps these three files in
// sync on every commit, but this script is the enforcement point release
// workflows (desktop-release.yml, android-release.yml) run before building,
// so a hand-edited or merge-conflicted version file can't silently ship a
// release under the wrong version number.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const targets = ['package.json', 'client/package.json', 'server/package.json'];
const versions = targets.map((p) => JSON.parse(readFileSync(path.join(root, p), 'utf-8')).version);

const mismatched = targets
  .map((file, i) => ({ file, version: versions[i] }))
  .filter((entry) => entry.version !== versions[0]);

if (mismatched.length) {
  console.error('Version mismatch across package.json files:');
  targets.forEach((file, i) => console.error(`  ${file}: ${versions[i]}`));
  console.error('\nRun `node scripts/bump-version.js` or fix these by hand so all three match, then retry.');
  process.exit(1);
}

console.log(`Version consistency OK: ${versions[0]} (package.json, client/package.json, server/package.json)`);
