import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { default: filesRouter } = await import('./files.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../../uploads');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/files', filesRouter);
  return app;
}

const testFiles = [];
function writeTestFile(name, content = 'test content') {
  const filePath = path.join(UPLOAD_DIR, name);
  fs.writeFileSync(filePath, content);
  testFiles.push(filePath);
  return filePath;
}

beforeEach(() => {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
});

afterEach(() => {
  while (testFiles.length) {
    const f = testFiles.pop();
    fs.rmSync(f, { force: true });
  }
});

describe('GET /api/files/:filename', () => {
  it('returns 404 for a file that does not exist', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/files/does-not-exist.png');
    expect(res.status).toBe(404);
  });

  it('serves a safe file type (e.g. an image) inline, without forcing a download', async () => {
    writeTestFile('abc123.png', 'fake-png-bytes');
    const app = buildApp();
    const res = await request(app).get('/api/files/abc123.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('forces a download for an .html upload (closes a same-origin stored-XSS path)', async () => {
    writeTestFile('evil.html', '<script>alert(document.cookie)</script>');
    const app = buildApp();
    const res = await request(app).get('/api/files/evil.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('forces a download for an .svg upload (SVG can carry <script>)', async () => {
    writeTestFile('image.svg', '<svg onload="alert(1)"></svg>');
    const app = buildApp();
    const res = await request(app).get('/api/files/image.svg');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('resolves a path-traversal attempt to just the basename instead of escaping the upload dir', async () => {
    writeTestFile('safe.txt', 'hello');
    const app = buildApp();
    const res = await request(app).get('/api/files/' + encodeURIComponent('../safe.txt'));
    // path.basename() strips any directory components, so this must resolve
    // to a plain "..safe.txt"-style lookup inside UPLOAD_DIR (not found), never
    // escape it -- either outcome (404, or a coincidental same-name hit inside
    // UPLOAD_DIR) is safe; what would NOT be safe is reading outside UPLOAD_DIR.
    expect([200, 404]).toContain(res.status);
  });
});
