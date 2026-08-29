import fs from 'node:fs';

const VERSION = '3.2.6';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }
function replaceOnce(path, from, to, label = from.slice(0, 80)) {
  const src = read(path);
  const count = src.split(from).length - 1;
  if (count !== 1) throw new Error(`${path}: expected exactly one match for ${label}, found ${count}`);
  write(path, src.replace(from, to));
}
function replaceAllRequired(path, from, to, min = 1) {
  const src = read(path);
  const count = src.split(from).length - 1;
  if (count < min) throw new Error(`${path}: expected at least ${min} matches, found ${count}`);
  write(path, src.split(from).join(to));
}

// 1) Account-correlated encrypted pending-revoke tombstones.
for (const path of ['client/src/mobile/auth/session.js', 'desktop/auth/session.js']) {
  let src = read(path);
  const isMobile = path.startsWith('client/');
  const awaitKw = isMobile ? 'await ' : '';

  const oldHelpers = isMobile ? `  async function clearPendingRevokeTombstoneIfCurrent(targetDeviceId) {
    const current = await secureStore.load();
    // A fresh login may have replaced the tombstone while a best-effort
    // DELETE was in flight. Never clear a real newly-created session.
    if (current?.pendingServerRevoke?.deviceId === targetDeviceId && !current.userCode) {
      await secureStore.clear();
    }
  }

  async function tryPendingRevokeWithFreshJwt(jwt) {
    const pending = await pendingRevoke();
    if (!pending?.deviceId || !jwt) return;
    try {
      const res = await fetchImpl(\`${'${apiBaseUrl}'}/api/devices/${'${pending.deviceId}'}\`, {
        method: 'DELETE',
        headers: { Authorization: \`Bearer ${'${jwt}'}\` },
      });
      if (res.ok || res.status === 404) {
        await clearPendingRevokeTombstoneIfCurrent(pending.deviceId);
      }
    } catch {
      // Keep the encrypted tombstone. If device registration below also
      // fails, the next successful online login gets another chance.
    }
  }` : `  function clearPendingRevokeTombstoneIfCurrent(targetDeviceId) {
    const current = secureStore.load();
    // A fresh login may have replaced the tombstone while a best-effort
    // DELETE was in flight. Never clear a real newly-created session.
    if (current?.pendingServerRevoke?.deviceId === targetDeviceId && !current.userCode) {
      secureStore.clear();
    }
  }

  async function tryPendingRevokeWithFreshJwt(jwt) {
    const pending = pendingRevoke();
    if (!pending?.deviceId || !jwt) return;
    try {
      const res = await fetchImpl(\`${'${apiBaseUrl}'}/api/devices/${'${pending.deviceId}'}\`, {
        method: 'DELETE',
        headers: { Authorization: \`Bearer ${'${jwt}'}\` },
      });
      if (res.ok || res.status === 404) {
        clearPendingRevokeTombstoneIfCurrent(pending.deviceId);
      }
    } catch {
      // Keep the encrypted tombstone. If device registration below also
      // fails, the next successful online login gets another chance.
    }
  }`;

  const newHelpers = isMobile ? `  async function clearPendingRevokeTombstoneIfCurrent(targetDeviceId, targetUserCode) {
    const current = await secureStore.load();
    // A fresh login may have replaced the tombstone while a best-effort
    // DELETE was in flight. Clear only the exact encrypted revoke debt that
    // was attempted; never clear a newly-created session or another account's debt.
    if (current?.pendingServerRevoke?.deviceId === targetDeviceId
      && current?.pendingServerRevoke?.userCode === targetUserCode
      && !current.userCode) {
      await secureStore.clear();
    }
  }

  async function tryPendingRevokeWithFreshJwt(jwt, freshUserCode) {
    const pending = await pendingRevoke();
    // A fresh JWT is account-scoped. Never use account B's token to settle
    // account A's device revoke. Legacy deviceId-only tombstones are also
    // deliberately not guessed; successful registration below safely
    // reassigns this physical device's unique server row to the new account.
    if (!pending?.deviceId || !pending?.userCode || !jwt || pending.userCode !== freshUserCode) return;
    try {
      const res = await fetchImpl(\`${'${apiBaseUrl}'}/api/devices/${'${pending.deviceId}'}\`, {
        method: 'DELETE',
        headers: { Authorization: \`Bearer ${'${jwt}'}\` },
      });
      if (res.ok || res.status === 404) {
        await clearPendingRevokeTombstoneIfCurrent(pending.deviceId, pending.userCode);
      }
    } catch {
      // Keep the encrypted tombstone. If device registration below also
      // fails, the next successful matching-account online login gets another chance.
    }
  }` : `  function clearPendingRevokeTombstoneIfCurrent(targetDeviceId, targetUserCode) {
    const current = secureStore.load();
    // A fresh login may have replaced the tombstone while a best-effort
    // DELETE was in flight. Clear only the exact encrypted revoke debt that
    // was attempted; never clear a newly-created session or another account's debt.
    if (current?.pendingServerRevoke?.deviceId === targetDeviceId
      && current?.pendingServerRevoke?.userCode === targetUserCode
      && !current.userCode) {
      secureStore.clear();
    }
  }

  async function tryPendingRevokeWithFreshJwt(jwt, freshUserCode) {
    const pending = pendingRevoke();
    // A fresh JWT is account-scoped. Never use account B's token to settle
    // account A's device revoke. Legacy deviceId-only tombstones are also
    // deliberately not guessed; successful registration below safely
    // reassigns this physical device's unique server row to the new account.
    if (!pending?.deviceId || !pending?.userCode || !jwt || pending.userCode !== freshUserCode) return;
    try {
      const res = await fetchImpl(\`${'${apiBaseUrl}'}/api/devices/${'${pending.deviceId}'}\`, {
        method: 'DELETE',
        headers: { Authorization: \`Bearer ${'${jwt}'}\` },
      });
      if (res.ok || res.status === 404) {
        clearPendingRevokeTombstoneIfCurrent(pending.deviceId, pending.userCode);
      }
    } catch {
      // Keep the encrypted tombstone. If device registration below also
      // fails, the next successful matching-account online login gets another chance.
    }
  }`;

  if (!src.includes(oldHelpers)) throw new Error(`${path}: pending-revoke helper block not found`);
  src = src.replace(oldHelpers, newHelpers);
  if (!src.includes('await tryPendingRevokeWithFreshJwt(jwt);')) throw new Error(`${path}: establish pending revoke call not found`);
  src = src.replace('await tryPendingRevokeWithFreshJwt(jwt);', 'await tryPendingRevokeWithFreshJwt(jwt, payload.userCode);');

  const oldSave = `${awaitKw}secureStore.save({ signedOut: true, pendingServerRevoke: { deviceId } });`;
  const newSave = `${awaitKw}secureStore.save({ signedOut: true, pendingServerRevoke: { deviceId, userCode: cached.userCode } });`;
  if (!src.includes(oldSave)) throw new Error(`${path}: tombstone save not found`);
  src = src.replace(oldSave, newSave);

  const oldClear = isMobile
    ? 'if (res.ok || res.status === 404) await clearPendingRevokeTombstoneIfCurrent(deviceId);'
    : 'if (res.ok || res.status === 404) clearPendingRevokeTombstoneIfCurrent(deviceId);';
  const newClear = isMobile
    ? 'if (res.ok || res.status === 404) await clearPendingRevokeTombstoneIfCurrent(deviceId, cached.userCode);'
    : 'if (res.ok || res.status === 404) clearPendingRevokeTombstoneIfCurrent(deviceId, cached.userCode);';
  if (!src.includes(oldClear)) throw new Error(`${path}: immediate revoke clear not found`);
  src = src.replace(oldClear, newClear);

  src = src.replace(
    /Tombstone contains NO bearer token, password hash or user identity\./g,
    'Tombstone contains NO bearer token or password verifier. The userCode is only an encrypted account-correlation identifier used to prevent cross-account revocation.'
  );
  src = src.replace(
    /This tombstone deliberately contains NO JWT, password hash, userCode,\n\s*\/\/ nickname or role\.[\s\S]*?pending-revoke path\./,
    `This tombstone deliberately contains NO JWT, password hash, nickname or\n    // role. userCode is retained only inside the OS-keychain-encrypted store\n    // as an account-correlation identifier so another account's fresh JWT can\n    // never be used to settle this revoke debt.`
  );
  write(path, src);
}

// 2) Tests lock same-account retry and different-account safety.
for (const path of ['client/src/mobile/auth/session.test.js', 'desktop/auth/session.test.js']) {
  replaceAllRequired(
    path,
    '{ signedOut: true, pendingServerRevoke: { deviceId: DEVICE } }',
    "{ signedOut: true, pendingServerRevoke: { deviceId: DEVICE, userCode: 'BOLD-001' } }",
    2
  );
  let src = read(path);
  const anchor = "  it('uses the next fresh online JWT to settle a pending revoke before re-registering the device', async () => {";
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error(`${path}: same-account pending revoke test not found`);
  const nextTest = src.indexOf("\n  it('", start + anchor.length);
  const insertAt = nextTest >= 0 ? nextTest : src.indexOf('\n});', start);
  if (insertAt < 0) throw new Error(`${path}: pending revoke test insertion point not found`);
  const isMobile = path.startsWith('client/');
  const crossTest = isMobile ? `

  it('never uses a different account JWT to settle an older account pending revoke', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    });
    const { manager, secureStore } = await buildManager({ fetchImpl });
    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }), 'PasswordA');
    await manager.forgetDevice({ allowNetwork: false });
    fetchImpl.mockClear();
    calls.length = 0;

    const userBJwt = fakeJwt({ userCode: 'BOLD-002', exp: Math.floor(Date.now() / 1000) + 3600 });
    await manager.establishOnlineSession(userBJwt, 'PasswordB');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.test/api/devices/register');
    expect(calls[0].options.headers.Authorization).toBe(\`Bearer ${'${userBJwt}'}\`);
    expect((await secureStore.load()).userCode).toBe('BOLD-002');
    expect((await secureStore.load()).pendingServerRevoke).toBeUndefined();
  });` : `

  it('never uses a different account JWT to settle an older account pending revoke', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    });
    const { manager, secureStore } = buildManager({ fetchImpl });
    await manager.establishOnlineSession(fakeJwt({ userCode: 'BOLD-001' }), 'PasswordA');
    manager.forgetDevice({ allowNetwork: false });
    fetchImpl.mockClear();
    calls.length = 0;

    const userBJwt = fakeJwt({ userCode: 'BOLD-002', exp: Math.floor(Date.now() / 1000) + 3600 });
    await manager.establishOnlineSession(userBJwt, 'PasswordB');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.test/api/devices/register');
    expect(calls[0].options.headers.Authorization).toBe(\`Bearer ${'${userBJwt}'}\`);
    expect(secureStore.load().userCode).toBe('BOLD-002');
    expect(secureStore.load().pendingServerRevoke).toBeUndefined();
  });`;
  src = src.slice(0, insertAt) + crossTest + src.slice(insertAt);
  write(path, src);
}

// 3) Remove dead Android localStorage revoke transport/flush path.
{
  const path = 'client/src/services/mobileBridge.js';
  let src = read(path);
  src = src.replace(/\n\/\/ forgetDevice\(\) while manually offline[\s\S]*?const PENDING_DEVICE_REVOKE_KEY = 'anatolia_pending_device_revoke';\n/, '\n');
  const oldForget = `  // While manually offline, session.js's own forgetDevice() skips its DELETE
  // call and hands back the revoke it still owes the server -- stash that so
  // the Auto-mode listener below can flush it once connectivity is trusted
  // again, instead of it being silently dropped.
  forgetDevice: guard(async () => {
    const result = await (await getSessionManager()).forgetDevice({ allowNetwork: !isAppModeOffline() });
    if (result?.pendingServerRevoke) {
      try {
        localStorage.setItem(PENDING_DEVICE_REVOKE_KEY, JSON.stringify(result.pendingServerRevoke));
      } catch {}
    }
    return result;
  }),`;
  const newForget = `  // Pending server revocation is owned entirely by the encrypted session
  // manager. Renderer localStorage never receives a bearer token or revoke debt.
  forgetDevice: guard(async () =>
    (await getSessionManager()).forgetDevice({ allowNetwork: !isAppModeOffline() })
  ),`;
  if (!src.includes(oldForget)) throw new Error(`${path}: legacy forgetDevice bridge block not found`);
  src = src.replace(oldForget, newForget);
  const flushStart = src.indexOf('// Best-effort delivery of a device revoke that forgetDevice() couldn\'t send');
  const bootStart = src.indexOf('// Bootstraps as soon as this module loads', flushStart);
  if (flushStart < 0 || bootStart < 0) throw new Error(`${path}: legacy flush block not found`);
  src = src.slice(0, flushStart) + src.slice(bootStart);
  if (!src.includes('    flushPendingDeviceRevoke();')) throw new Error(`${path}: legacy Auto-mode flush call not found`);
  src = src.replace('    flushPendingDeviceRevoke();\n', '');
  src = src.replace(
    /, plus a\n  \/\/ best-effort flush of any device revoke forgetDevice\(\) couldn't deliver\n  \/\/ while offline\./,
    '. The encrypted session manager, not this mode listener, owns any pending device revoke.'
  );
  write(path, src);
}

// 4) Documentation and in-app guide wording.
replaceOnce(
  'README.md',
  'If Offline Mode (below) is on, `forgetDevice()` skips that server call and queues a pending-revoke marker that is flushed automatically the next time the app switches back to Otomatik.',
  'If Offline Mode (below) is on, `forgetDevice()` removes local authorization immediately and keeps an account-correlated revoke tombstone only inside the OS-protected encrypted store. Returning to Otomatik alone never sends an old credential: the next successful online login to the same account uses its fresh JWT to settle the server-side revoke before re-registering. A different account never has its JWT used for the old account\'s revoke; registering that same physical device safely reassigns the server row to the newly authenticated account.'
);
replaceOnce(
  'desktop/README.md',
  '`forgetDevice({ allowNetwork: false })` skips that DELETE call and instead\nqueues a pending-revoke marker that `appMode.js` flushes automatically the\nnext time the app switches back to Otomatik.',
  '`forgetDevice({ allowNetwork: false })` skips that DELETE call and instead\nkeeps an account-correlated pending-revoke tombstone only in the OS-keychain-\nencrypted secure store. Returning to Otomatik alone never sends an old bearer\ntoken; the next successful online login to the same account uses its fresh JWT\nto settle the revoke before re-registering. A different account never has its\nJWT used for the older account\'s revoke.'
);
replaceOnce(
  'desktop/README.md',
  'and flushes any\n`forgetDevice({ allowNetwork: false })` device-revoke that was queued while\noffline (`appMode.js`\'s `pendingRevoke` file) -- no new sync/socket\nmechanism was invented, the existing ones are just centrally started and\nstopped from one place instead of being gated ad hoc at their call sites.',
  '-- no new sync/socket mechanism was invented, the existing ones are just\ncentrally started and stopped from one place instead of being gated ad hoc at\ntheir call sites. Pending device revocation is deliberately not an app-mode\nresponsibility: `auth/session.js` owns its encrypted tombstone and retries it\nonly after a successful matching-account online login supplies a fresh JWT.'
);
replaceOnce(
  'desktop/README.md',
  '`localAI/offlineExtractive.js` is a real, fully offline backend — keyword\nsearch with Turkish relative-date parsing ("geçen ayki raporlarımı bul"),\nextractive summarization, and bag-of-words comparison — running directly\nagainst the local SQLite `analyses` table, no model download and no network\ncall. It deliberately does **not** try to replace cloud AI: generating a new\nanalysis (LLM + optionally the quantum kernel) stays cloud-only via the\nexisting `/api/analysis` endpoints, exactly as it works on the web today.\n`localAI/provider.js` never throws past its boundary — a broken/unavailable\nbackend degrades to a reported capability flag, not a crash.',
  'Desktop Local AI supports real on-device generation through `node-llama-cpp`\nwith pinned GGUF tiers: Qwen2.5-1.5B-Instruct (MID) by default and\nQwen2.5-7B-Instruct (HIGH) on machines with sufficient RAM. Models are not\nbundled; Settings → Local AI downloads and verifies the selected tier once,\nafter which new analyses can be generated with no network connection and are\nsaved to the local SQLite history as `Q LOCAL LLM (OFFLINE)`.\n`localAI/offlineExtractive.js` remains the zero-download fallback for local\nsearch/summarize/compare and archived-report matching when no generative model\nis installed or generation fails. `localAI/provider.js` keeps failures behind\nits provider boundary so an unavailable model degrades cleanly instead of\ncrashing the application.'
);
replaceOnce(
  'mobile/README.md',
  'only a non-sensitive `{ deviceId }` tombstone is kept inside\nthe Android Keystore-backed secure store. The next successful online login\'s\nfresh JWT settles that server-side revoke before the device is registered\nagain.',
  'only an account-correlated `{ deviceId, userCode }` tombstone is kept inside\nthe Android Keystore-backed secure store — never a bearer token or password\nverifier. The next successful online login to that same account uses its fresh\nJWT to settle the server-side revoke before the device is registered again; a\ndifferent account\'s JWT is never used for the older account\'s revoke.'
);
replaceOnce(
  'API.md',
  'only a non-sensitive device-id tombstone remains in the platform encrypted secure store. The server-side revoke is then attempted with the next successful online login\'s fresh JWT before the same device is registered again.',
  'only an account-correlated `{ deviceId, userCode }` tombstone remains in the platform encrypted secure store; it contains no bearer token or password verifier. The server-side revoke is attempted only when the next successful online login belongs to that same account, using its fresh JWT before re-registration. A different account\'s JWT is never used to settle the older account\'s revoke.'
);

const guideReplacement = {
  tr: 'Çevrimdışı Mod açıkken Bu Cihazı Unut kullanılırsa yerel çevrimdışı giriş yetkisi hemen kaldırılır; sunucu kaydı, aynı hesapla yapılan bir sonraki başarılı çevrim içi girişte taze oturum belirteciyle güvenli şekilde uzlaştırılır. Otomatik moda dönmek tek başına eski bir kimlik bilgisi göndermez.',
  en: 'If Forget This Device is used while Offline Mode is active, local offline-login authorization is removed immediately; the server record is safely reconciled with a fresh session token on the next successful online login to the same account. Returning to Auto mode alone never sends an old credential.',
  de: 'Wenn „Dieses Gerät vergessen“ im Offline-Modus verwendet wird, wird die lokale Offline-Anmeldeberechtigung sofort entfernt; der Servereintrag wird bei der nächsten erfolgreichen Online-Anmeldung desselben Kontos sicher mit einem frischen Sitzungstoken abgeglichen. Die Rückkehr zum Automatikmodus allein sendet niemals alte Anmeldedaten.',
  fr: 'Si « Oublier cet appareil » est utilisé en mode hors ligne, l’autorisation de connexion hors ligne locale est supprimée immédiatement ; l’enregistrement serveur est réconcilié en toute sécurité avec un jeton de session frais lors de la prochaine connexion en ligne réussie au même compte. Le simple retour au mode Automatique n’envoie jamais un ancien identifiant.',
  ar: 'إذا استُخدم «نسيان هذا الجهاز» أثناء وضع عدم الاتصال، تُزال صلاحية تسجيل الدخول المحلي دون اتصال فورًا؛ وتتم تسوية سجل الخادم بأمان باستخدام رمز جلسة جديد عند أول تسجيل دخول ناجح عبر الإنترنت إلى الحساب نفسه. الرجوع إلى الوضع التلقائي وحده لا يرسل أي بيانات اعتماد قديمة.'
};
for (const [lang, replacement] of Object.entries(guideReplacement)) {
  const path = `client/src/locales/${lang}/common.json`;
  const data = JSON.parse(read(path));
  const module = data.guideModules?.find((entry) => String(entry?.[0] || '').trim().startsWith('11)'));
  if (!module || typeof module[1] !== 'string') throw new Error(`${path}: guide module 11 not found`);
  const parts = module[1].split('|');
  if (parts.length < 6) throw new Error(`${path}: guide module 11 has unexpected shape (${parts.length})`);
  parts[5] = replacement;
  module[1] = parts.join('|');
  write(path, JSON.stringify(data, null, 2) + '\n');
}

// 5) Strict release metadata consistency: packages, locks and README badge.
write('scripts/check-version-consistency.js', `#!/usr/bin/env node
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const readJson = (p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));

const packageTargets = ['package.json', 'client/package.json', 'server/package.json'];
const versions = packageTargets.map((p) => readJson(p).version);
const canonical = versions[0];
if (!canonical || versions.some((v) => v !== canonical)) {
  console.error('Version mismatch across release package.json files:');
  packageTargets.forEach((file, i) => console.error(\`  \${file}: \${versions[i]}\`));
  process.exit(1);
}

const lockTargets = ['package-lock.json', 'client/package-lock.json', 'server/package-lock.json'];
const lockErrors = [];
for (const file of lockTargets) {
  const lock = readJson(file);
  const top = lock.version;
  const rootPackage = lock.packages?.['']?.version;
  if (top !== canonical) lockErrors.push(\`\${file} top-level=\${top ?? 'missing'}\`);
  if (rootPackage !== canonical) lockErrors.push(\`\${file} packages[\"\"].version=\${rootPackage ?? 'missing'}\`);
}
if (lockErrors.length) {
  console.error('Lockfile application-version metadata must match the release version:');
  lockErrors.forEach((line) => console.error(\`  \${line}\`));
  process.exit(1);
}

const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
const badge = readme.match(/img\\.shields\\.io\\/badge\\/version-([0-9]+\\.[0-9]+\\.[0-9]+)-blue/);
if (!badge || badge[1] !== canonical) {
  console.error(\`README version badge mismatch: expected \${canonical}, found \${badge?.[1] ?? 'missing'}\`);
  process.exit(1);
}

console.log(\`Version consistency OK: \${canonical} across packages, lockfiles and README badge\`);
`);

// 6) This commit's required version bump, including lock metadata and badge.
for (const path of ['package.json', 'client/package.json', 'server/package.json']) {
  const data = JSON.parse(read(path));
  data.version = VERSION;
  write(path, JSON.stringify(data, null, 2) + '\n');
}
for (const path of ['package-lock.json', 'client/package-lock.json', 'server/package-lock.json']) {
  const data = JSON.parse(read(path));
  data.version = VERSION;
  if (!data.packages?.['']) throw new Error(`${path}: packages[\"\"] missing`);
  data.packages[''].version = VERSION;
  write(path, JSON.stringify(data, null, 2) + '\n');
}
replaceOnce('README.md', 'version-3.2.5-blue', `version-${VERSION}-blue`, 'README version badge');

console.log(`Prepared ANATOLIA-Q ${VERSION} debt-closure changes.`);
