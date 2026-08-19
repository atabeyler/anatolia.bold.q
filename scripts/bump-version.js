#!/usr/bin/env node
// Bumps the patch version in root/client/server package.json files together,
// keeps the corresponding package-lock.json headers aligned, and updates the
// README version badge to the same release.
// Run automatically by .husky/pre-commit before every commit; the updated
// files are then staged into that same commit.
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const jsonTargets = [
  'package.json',
  'client/package.json',
  'server/package.json',
].map((p) => path.join(root, p));

const lockTargets = [
  'package-lock.json',
  'client/package-lock.json',
  'server/package-lock.json',
].map((p) => path.join(root, p));

const rootPkg = JSON.parse(readFileSync(jsonTargets[0], 'utf-8'));
const [major, minor, patch] = rootPkg.version.split('.').map(Number);
const nextVersion = `${major}.${minor}.${patch + 1}`;

for (const file of jsonTargets) {
  const pkg = JSON.parse(readFileSync(file, 'utf-8'));
  pkg.version = nextVersion;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}

for (const file of lockTargets) {
  const lock = JSON.parse(readFileSync(file, 'utf-8'));
  lock.version = nextVersion;
  if (lock.packages?.['']) lock.packages[''].version = nextVersion;
  writeFileSync(file, JSON.stringify(lock, null, 2) + '\n');
}

const readmePath = path.join(root, 'README.md');
if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, 'utf-8');
  const updated = readme.replace(
    /version-\d+\.\d+\.\d+-blue/,
    `version-${nextVersion}-blue`
  );
  writeFileSync(readmePath, updated);
}

console.log(`Version bumped: ${rootPkg.version} -> ${nextVersion}`);
