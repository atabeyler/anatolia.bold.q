import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import os from 'node:os';

import { MODEL_SPEC } from './modelSpec.js';
import { checkDeviceCapability } from './deviceCapability.js';

// Real Local Model Manager for the desktop app: install-check, streamed
// download with checksum verification, remove, and a device-capability
// gate. No network access happens unless install()/download is explicitly
// called by the user (spec point 9/privacy) -- isModelInstalled()/
// checkCapability() only ever touch the local filesystem and os.* stats.
//
// `modelsDir` is always caller-supplied (desktop/main.js passes
// path.join(app.getPath('userData'), 'models')) so this module never
// imports Electron and stays unit-testable with a plain tmp dir.
export function createModelManager({ modelsDir, spec = MODEL_SPEC, fetchImpl } = {}) {
  if (!modelsDir) throw new Error('modelManager requires modelsDir');

  const modelPath = path.join(modelsDir, spec.filename);
  const tmpPath = `${modelPath}.download`;

  function isModelInstalled() {
    return fs.existsSync(modelPath);
  }

  async function sha256File(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  async function verifyChecksum(filePath = modelPath) {
    if (!fs.existsSync(filePath)) return { ok: false, reason: 'missing' };
    const actual = await sha256File(filePath);
    return { ok: actual === spec.sha256, actual, expected: spec.sha256 };
  }

  // Follows redirects itself (Node's https doesn't) -- Hugging Face's
  // resolve/ URLs 302 to a signed CDN URL. Streams straight to a .download
  // temp file so a crash/interrupt mid-download never leaves a file at the
  // real modelPath that isModelInstalled() would wrongly treat as ready.
  function httpGetFollowingRedirects(url, onResponse, redirectsLeft = 5) {
    const getFn = fetchImpl || https.get;
    getFn(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        httpGetFollowingRedirects(res.headers.location, onResponse, redirectsLeft - 1);
        return;
      }
      onResponse(res);
    }).on('error', (err) => onResponse(null, err));
  }

  async function downloadModel({ onProgress } = {}) {
    await fsPromises.mkdir(modelsDir, { recursive: true });

    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmpPath);
      let received = 0;
      // Always attached, from creation, so an early-return path
      // (out.destroy() below) never leaves the stream's own internal
      // 'error' event with zero listeners -- an unhandled 'error' on a
      // stream crashes the process in Node, which a failed/aborted
      // download must never do.
      out.on('error', () => {});

      httpGetFollowingRedirects(spec.url, (res, err) => {
        if (err) { out.destroy(); reject(err); return; }
        if (res.statusCode !== 200) {
          out.destroy();
          reject(new Error(`Model indirilemedi (HTTP ${res.statusCode})`));
          return;
        }
        const total = Number(res.headers['content-length']) || spec.sizeBytes || 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          onProgress?.({ received, total });
        });
        res.pipe(out);
        out.on('finish', resolve);
        res.on('error', reject);
      });
    }).catch(async (err) => {
      // Clean up a partial/empty .download file on any failure (network
      // error, non-200, ...) so it never lingers and gets mistaken for a
      // real in-progress download by a later isModelInstalled() check.
      await fsPromises.rm(tmpPath, { force: true });
      throw err;
    });

    const check = await verifyChecksum(tmpPath);
    if (!check.ok) {
      await fsPromises.rm(tmpPath, { force: true });
      throw new Error(`Model bütünlük kontrolü başarısız (checksum uyuşmadı): beklenen ${check.expected}, alınan ${check.actual}`);
    }

    await fsPromises.rename(tmpPath, modelPath);
    return { ok: true, path: modelPath, sha256: check.actual };
  }

  async function removeModel() {
    await fsPromises.rm(modelPath, { force: true });
    await fsPromises.rm(tmpPath, { force: true });
    return { ok: true };
  }

  function checkCapability() {
    return checkDeviceCapability(spec, { osModule: os, modelsDir });
  }

  // Combines "is the file actually there" with "can this device safely run
  // it" -- registry.js's local-llm provider gates isAvailable() on this,
  // so a device with a downloaded-but-oversized model, or a capable device
  // with no model yet, both correctly fall through to offline-extractive
  // instead of attempting to load. Synchronous to match every other
  // provider's isAvailable() contract in registry.js.
  function isAvailable() {
    if (!isModelInstalled()) return false;
    return checkCapability().capable;
  }

  return {
    spec,
    modelPath,
    isModelInstalled,
    verifyChecksum,
    downloadModel,
    removeModel,
    checkCapability,
    isAvailable,
  };
}
