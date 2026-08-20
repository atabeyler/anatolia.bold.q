import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Shield, CheckCircle, XCircle, Menu as MenuIcon, Settings as SettingsIcon } from 'lucide-react';
import { api, setJWT } from '../services/api.js';
import { isNativeApp, nativeAuth } from '../services/nativeBridge.js';
import { isPasskeySupported, loginWithPasskey } from '../services/webauthn.js';
import EmergencyButton from '../components/EmergencyButton.jsx';
import { useLang } from '../services/langContext.jsx';
import { registerActions, unregisterActions } from '../services/voiceActionRegistry.js';
import { MenuPanel, SettingsPanel, InfoModal, GuideModal } from '../components/AppMenus.jsx';
import AppFooter from '../components/AppFooter.jsx';
import { Corner, GridBackground, OrbitalLogo, BootSequence, StatusBar } from './LoginPageDecor.jsx';
import HologramSphere from '../components/HologramSphere.jsx';

const STAGES = { IDLE: 'idle', AWAITING_APPROVAL: 'awaiting', APPROVED: 'approved', EXPIRED: 'expired' };

// Authorizes this install's device_id against the account (see
// desktop/auth/session.js / client/src/mobile/auth/session.js) right after
// an ordinary online login succeeds -- this is the "online authorization"
// step spec point 5 requires before offline login is allowed on this
// device. Also caches a bcrypt hash of the password just used (never the
// plaintext) so a later offline login on this same device can be verified
// locally. A no-op on the web build (isNativeApp is false there) and never
// blocks the login flow if it fails -- the user is still online and logged
// in either way, they just won't be able to log in offline on this device
// until it succeeds once.
function registerNativeSession(jwt, password) {
  if (!isNativeApp || !jwt) return;
  nativeAuth.establishOnlineSession(jwt, password).then((result) => {
    // sessionPersisted:false means the OS-level secure storage (Electron
    // safeStorage / Capacitor secure storage) wasn't available on this
    // device, so the session was deliberately kept in memory only rather
    // than ever written to disk unencrypted (see desktop/auth/secureStore.js).
    // Offline login on this device won't work until the app is relaunched
    // with secure storage available again -- surfaced here (not silently)
    // since the login screen itself is about to unmount.
    if (result && result.sessionPersisted === false) {
      console.warn('[ANATOLIA-Q] Secure session storage unavailable on this device -- offline login will not be available until the next successful online login.');
    }
  }).catch((err) => {
    console.warn('[ANATOLIA-Q] Device authorization failed:', err?.message || err);
  });
}

// ─── Holographic branding panel (left column on wide screens) ────────────
// "Holografik & Siber" login theme: a big rotating radar-globe hologram
// (the same HologramSphere used in AnalysisWizard.jsx's status column,
// not a page-specific duplicate) plus the wordmark and two status chips.
// Hidden on narrow viewports -- the login card alone is still the complete,
// fully functional flow there, this panel is purely additive branding.
function HoloBrandPanel() {
  const { t } = useLang();
  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, ease: 'easeOut' }}
      className="hidden lg:flex flex-col items-start max-w-md">
      <div className="flex items-center gap-2 mb-8">
        <div className="w-9 h-9 rounded-lg bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center">
          <span className="font-display text-gold text-sm">Q</span>
        </div>
        <div>
          <div className="font-display text-cyan-100 tracking-[0.2em] text-sm">ANATOLIA-Q</div>
          <div className="text-[9px] text-cyan-300/50 tracking-[0.2em] uppercase">{t('appSubtitle')}</div>
        </div>
      </div>

      <HologramSphere className="w-full max-w-[280px]" />

      <div className="flex items-center gap-5 mt-8 text-[10px] font-mono tracking-wider">
        <span className="flex items-center gap-1.5 text-emerald-400/80">
          <motion.span className="w-1.5 h-1.5 rounded-full bg-emerald-400" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.4, repeat: Infinity }} />
          {t('statusSystemActive')}
        </span>
        <span className="text-cyan-300/70 uppercase">{t('secureLabel')}</span>
      </div>
    </motion.div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────
export default function LoginPage({ onLogin }) {
  const { t, lang, setLang } = useLang();
  const [userCode, setUserCode] = useState(() => localStorage.getItem('aq_saved_code') || '');
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState(STAGES.IDLE);
  const [token, setToken] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [bootDone, setBootDone] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoPanel, setInfoPanel] = useState(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.09);
  // 'password' is the default and only mode a device that never supported
  // (or never registered) a passkey ever sees -- passkey is strictly an
  // additional option, never a replacement, per spec point 1.
  const [loginMode, setLoginMode] = useState('password');
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => { setPasskeySupported(isPasskeySupported()); }, []);

  useEffect(() => { return () => clearInterval(pollRef.current); }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('aq:context', { detail: { page: 'login' } }));
    registerActions('login-page', [
      {
        name: 'fill_username',
        description: 'Fill the user code / kullanıcı kodu field',
        params: { value: 'string — the user code digits or letters to enter' },
        handler: (p) => setUserCode((p?.value || '').toUpperCase()),
      },
      {
        name: 'fill_password',
        description: 'Fill the password / şifre field',
        params: { value: 'string — the password to enter, preserve exact case and punctuation' },
        handler: (p) => setPassword(p?.value || ''),
      },
      {
        name: 'login_with',
        description: 'Fill both user code and password then submit — use when user says their code and password together',
        params: { userCode: 'string — the user code', password: 'string — the password' },
        handler: (p) => {
          if (p?.userCode) setUserCode(p.userCode.toUpperCase());
          if (p?.password) setPassword(p.password);
          setTimeout(() => {
            const btn = document.querySelector('button[type="submit"]');
            if (btn && !btn.disabled) btn.click();
          }, 300);
        },
      },
      {
        name: 'submit_login',
        description: 'Submit / confirm the login form',
        params: {},
        handler: () => {
          const btn = document.querySelector('button[type="submit"]');
          if (btn && !btn.disabled) btn.click();
        },
      },
      {
        name: 'clear_login_form',
        description: 'Clear / reset all login form fields',
        params: {},
        handler: () => { setUserCode(''); setPassword(''); setError(''); },
      },
    ]);
    return () => unregisterActions('login-page');
  }, []);

  useEffect(() => {
    if (stage !== STAGES.AWAITING_APPROVAL || !token) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await api.checkApproval(token);
        if (r.status === 'approved') {
          clearInterval(pollRef.current);
          setJWT(r.jwt);
          registerNativeSession(r.jwt, password);
          setStage(STAGES.APPROVED);
          setTimeout(() => onLogin({ userCode: r.userCode, nickname: r.nickname, role: r.role, isAdmin: false }), 1500);
        } else if (r.status === 'expired' || r.status === 'not_found') {
          clearInterval(pollRef.current);
          setStage(STAGES.EXPIRED);
        }
      } catch (e) { console.error(e); }
    }, 2500);
    return () => clearInterval(pollRef.current);
  // password is intentionally read from this effect's closure rather than
  // listed as a dependency: the login form (and the password field with
  // it) is unmounted while AWAITING_APPROVAL is shown, so it can't change
  // during the poll -- adding it here would only restart the interval
  // pointlessly on unrelated re-renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, token, onLogin]);

  // Desktop-only: verifies the entered credentials locally (bcrypt hash
  // cached at the last successful online login, see desktop/auth/session.js)
  // instead of hitting the network — only succeeds for an account that has
  // actually authorized this exact device online before (spec point 5).
  const attemptOfflineLogin = async () => {
    const result = await nativeAuth.verifyOfflineLogin(userCode.trim(), password);
    if (!result?.ok) {
      setError(result?.error || 'Çevrimdışı giriş başarısız.');
      return;
    }
    setJWT(result.jwt);
    onLogin({ userCode: result.userCode, isAdmin: result.isAdmin });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    // Only the (non-sensitive) user code is remembered for next time --
    // the password itself is never written to localStorage.
    localStorage.setItem('aq_saved_code', userCode.trim());
    try {
      const r = await api.loginRequest(userCode.trim(), password);
      // Admin: gets JWT directly, no approval wait
      if (r.status === 'approved' && r.jwt) {
        setJWT(r.jwt);
        registerNativeSession(r.jwt, password);
        onLogin({ userCode: r.userCode, nickname: r.nickname, role: r.role, isAdmin: r.isAdmin });
        return;
      }
      setToken(r.token);
      setStage(STAGES.AWAITING_APPROVAL);
    } catch (err) {
      // Only a genuine network-level failure (fetch() itself rejecting,
      // surfaced as a TypeError -- e.g. "Failed to fetch") falls back to
      // offline verification, in case the connectivity monitor's cached
      // state was stale. A rejection the server actually sent back (wrong
      // password, blocked account, ...) is a real answer and must be shown
      // as-is, not masked by an unrelated offline-login error.
      if (isNativeApp && err instanceof TypeError) {
        await attemptOfflineLogin();
        return;
      }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Passkey login is a full alternative to handleLogin above, not a second
  // factor on top of it: the server only issues a session after verifying
  // the WebAuthn signature itself (see routes/webauthn.js's /login/verify),
  // so a successful ceremony here goes straight to onLogin(), same as the
  // admin fast-path in handleLogin. Never trusts anything from the browser
  // beyond the signed response -- the platform authenticator's biometric
  // check result itself never reaches this code or the server.
  const handlePasskeyLogin = async (e) => {
    e.preventDefault();
    setError('');
    setPasskeyLoading(true);
    localStorage.setItem('aq_saved_code', userCode.trim());
    try {
      const r = await loginWithPasskey(userCode.trim());
      setJWT(r.jwt);
      onLogin({ userCode: r.userCode, nickname: r.nickname, role: r.role, isAdmin: r.isAdmin });
    } catch (err) {
      // A user cancelling the OS biometric prompt (or having no matching
      // authenticator on this device) surfaces as a WebAuthnError from
      // @simplewebauthn/browser, not a server error -- show its message
      // rather than a raw "[object Object]"/undefined.
      setError(err?.message || t('passkeyLoginFailed'));
    } finally {
      setPasskeyLoading(false);
    }
  };

  const reset = () => { setStage(STAGES.IDLE); setToken(null); setError(''); setUserCode(''); setPassword(''); };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <GridBackground />

      {/* Corner brackets */}
      {['tl','tr','bl','br'].map(p => <Corner key={p} pos={p} />)}

      {/* Menu / Settings */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        <button onClick={() => setMenuOpen((v) => !v)} className="btn-depth header-control h-[28px] sm:h-[30px] px-2.5 py-2 rounded" title={t('menuTooltip')} aria-label={t('menuTooltip')}>
          <MenuIcon className="w-4 h-4" />
        </button>
        <button onClick={() => setSettingsOpen((v) => !v)} className="btn-depth header-control h-[28px] sm:h-[30px] px-2.5 py-2 rounded" title={t('settingsTooltip')} aria-label={t('settingsTooltip')}>
          <SettingsIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="relative z-10 w-full max-w-5xl grid grid-cols-1 lg:grid-cols-[1fr_auto] items-center gap-8 lg:gap-12">
        <HoloBrandPanel />

        {/* Main card */}
        <motion.div initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="relative w-full max-w-sm sm:max-w-md md:max-w-lg lg:max-w-md mx-auto">

        {/* Card frame */}
        <div className="relative rounded-sm border border-cyan-500/25 bg-[#010e1e]/90 backdrop-blur-xl p-6 sm:p-8"
          style={{ boxShadow: '0 0 60px rgba(0,150,200,0.08), 0 0 120px rgba(0,80,160,0.05), inset 0 0 60px rgba(0,100,160,0.03)' }}>

          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-gold/60" />
          <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-gold/60" />
          <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-gold/60" />
          <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-gold/60" />

          {/* Top strip */}
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between mb-5 text-xs font-mono tracking-wide sm:tracking-widest">
            <span className="text-cyan-300/85 uppercase">{t('projectCode')}: QTR-200120401018</span>
            <div className="flex items-center justify-between sm:contents">
              <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.8, repeat: Infinity }}
                className="text-emerald-400/80 uppercase">● {t('secureLabel')}</motion.span>
              <span className="text-cyan-300/85 uppercase">{t('classifiedShort')}</span>
            </div>
          </div>

          {/* Logo */}
          <OrbitalLogo />

          {/* Title */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
            className="text-center mb-5">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-display font-bold text-gold tracking-[0.35em] uppercase">
              ANATOLIA-Q
            </h1>
            <div className="h-px w-24 bg-gradient-to-r from-transparent via-gold/50 to-transparent mx-auto my-2" />
            <p className="text-xs sm:text-sm text-gold/70 tracking-[0.25em] uppercase">
              {t('appSubtitle')}
            </p>
          </motion.div>

          {/* Boot sequence / Form */}
          <AnimatePresence mode="wait">
            {stage === STAGES.IDLE && (
              <motion.div key="login-area" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {!bootDone && (
                  <BootSequence onDone={() => setBootDone(true)} lang={lang} />
                )}

                {loginMode === 'password' ? (
                  <motion.form onSubmit={handleLogin}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.9 }}
                    className="space-y-4">

                    <div className="text-xs font-mono text-cyan-300/85 tracking-widest uppercase mb-3">
                      &gt; {t('identityVerificationRequired')}
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs text-gold/80 tracking-widest uppercase font-mono">{t('userCode')}</label>
                      <div className="relative group">
                        <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400/40 group-focus-within:text-cyan-400 transition" />
                        <input type="text" value={userCode} onChange={e => setUserCode(e.target.value)}
                          placeholder="·  ·  ·  ·  ·  ·  ·" required autoFocus
                          className="w-full pl-10 pr-4 py-2.5 bg-[#020c18] border border-cyan-500/20 rounded-sm text-gold font-mono tracking-[0.2em] text-sm focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/20 transition placeholder-cyan-900/50" />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs text-gold/80 tracking-widest uppercase font-mono">{t('password')}</label>
                      <div className="relative group">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400/40 group-focus-within:text-cyan-400 transition" />
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                          className="w-full pl-10 pr-4 py-2.5 bg-[#020c18] border border-cyan-500/20 rounded-sm text-gold font-mono tracking-[0.2em] text-sm focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/20 transition" />
                      </div>
                    </div>

                    <AnimatePresence>
                      {error && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                          className="text-crimson text-sm bg-crimson/10 border border-crimson/30 rounded-sm p-2.5 font-mono">
                          ⚠ {error}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <motion.button type="submit" disabled={loading}
                      whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                      className="w-full py-3 sm:py-3.5 rounded-sm font-display tracking-[0.35em] uppercase text-sm relative overflow-hidden transition disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg, rgba(212,175,55,0.15) 0%, rgba(212,175,55,0.25) 100%)', border: '1px solid rgba(212,175,55,0.5)', color: '#d4af37', boxShadow: loading ? 'none' : '0 0 20px rgba(212,175,55,0.15)' }}>
                      {loading ? (
                        <span className="flex items-center justify-center gap-2">
                          <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                            className="inline-block w-4 h-4 border-2 border-gold/30 border-t-gold rounded-full" />
                          {t('processing')}
                        </span>
                      ) : t('loginBtn')}
                    </motion.button>

                    {passkeySupported && (
                      <button type="button" onClick={() => { setError(''); setLoginMode('passkey'); }}
                        className="w-full text-center text-xs font-mono text-cyan-300/70 hover:text-cyan-200 tracking-wider uppercase underline underline-offset-4">
                        {t('passkeyLoginToggle')}
                      </button>
                    )}
                  </motion.form>
                ) : (
                  <motion.form onSubmit={handlePasskeyLogin}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="space-y-4">

                    <div className="text-xs font-mono text-cyan-300/85 tracking-widest uppercase mb-3">
                      &gt; {t('passkeyVerificationRequired')}
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs text-gold/80 tracking-widest uppercase font-mono">{t('userCode')}</label>
                      <div className="relative group">
                        <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400/40 group-focus-within:text-cyan-400 transition" />
                        <input type="text" value={userCode} onChange={e => setUserCode(e.target.value)}
                          placeholder="·  ·  ·  ·  ·  ·  ·" required autoFocus
                          className="w-full pl-10 pr-4 py-2.5 bg-[#020c18] border border-cyan-500/20 rounded-sm text-gold font-mono tracking-[0.2em] text-sm focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/20 transition placeholder-cyan-900/50" />
                      </div>
                    </div>

                    <AnimatePresence>
                      {error && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                          className="text-crimson text-sm bg-crimson/10 border border-crimson/30 rounded-sm p-2.5 font-mono">
                          ⚠ {error}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <motion.button type="submit" disabled={passkeyLoading}
                      whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                      className="w-full py-3 sm:py-3.5 rounded-sm font-display tracking-[0.35em] uppercase text-sm relative overflow-hidden transition disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg, rgba(212,175,55,0.15) 0%, rgba(212,175,55,0.25) 100%)', border: '1px solid rgba(212,175,55,0.5)', color: '#d4af37', boxShadow: passkeyLoading ? 'none' : '0 0 20px rgba(212,175,55,0.15)' }}>
                      {passkeyLoading ? (
                        <span className="flex items-center justify-center gap-2">
                          <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                            className="inline-block w-4 h-4 border-2 border-gold/30 border-t-gold rounded-full" />
                          {t('processing')}
                        </span>
                      ) : t('passkeyLoginBtn')}
                    </motion.button>

                    <button type="button" onClick={() => { setError(''); setLoginMode('password'); }}
                      className="w-full text-center text-xs font-mono text-cyan-300/70 hover:text-cyan-200 tracking-wider uppercase underline underline-offset-4">
                      {t('passwordLoginToggle')}
                    </button>
                  </motion.form>
                )}
              </motion.div>
            )}

            {stage === STAGES.AWAITING_APPROVAL && (
              <motion.div key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="text-center py-6">
                {/* Radar animation */}
                <div className="relative w-24 h-24 mx-auto mb-5">
                  <div className="absolute inset-0 rounded-full border-2 border-cyan-500/20" />
                  <div className="absolute inset-2 rounded-full border border-cyan-500/15" />
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                    className="absolute inset-0 rounded-full"
                    style={{ background: 'conic-gradient(from 0deg, transparent 70%, rgba(0,212,255,0.5) 100%)' }} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <motion.div animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="w-3 h-3 rounded-full bg-cyan-400" />
                  </div>
                </div>
                <p className="font-display text-base text-gold tracking-widest uppercase mb-2">{t('awaitingApproval')}</p>
                <p className="text-xs font-mono text-cyan-300/85 tracking-wider mb-5">
                  &gt; {t('awaitingApprovalStatus')}
                </p>
                <button onClick={reset} className="text-sm text-crimson/80 hover:text-crimson font-mono underline">{t('cancel')}</button>
              </motion.div>
            )}

            {stage === STAGES.APPROVED && (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                className="text-center py-6">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', duration: 0.7 }}>
                  <CheckCircle className="w-16 h-16 text-emerald-400 mx-auto mb-4"
                    style={{ filter: 'drop-shadow(0 0 20px #22c55e)' }} />
                </motion.div>
                <p className="font-display text-xl text-gold tracking-widest mb-2">{t('approved')}</p>
                <p className="text-xs font-mono text-emerald-400/60">&gt; {t('connectingToSystem')}</p>
              </motion.div>
            )}

            {stage === STAGES.EXPIRED && (
              <motion.div key="expired" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="text-center py-6">
                <XCircle className="w-14 h-14 text-crimson mx-auto mb-4"
                  style={{ filter: 'drop-shadow(0 0 12px #c8102e)' }} />
                <p className="font-display text-lg text-crimson tracking-widest mb-2">{t('expired')}</p>
                <p className="text-sm text-gold/75 mb-5">{t('expiredNote')}</p>
                <motion.button onClick={reset} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  className="px-6 py-2 rounded-sm text-sm font-display tracking-widest text-gold border border-gold/40 hover:bg-gold/10 transition">
                  {t('retry')}
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom strip */}
          <div className="mt-5 pt-4 border-t border-cyan-500/10 flex items-center justify-between text-xs font-mono text-gold/60 tracking-wider">
            <span>ANATOLIA-Q v{__APP_VERSION__}</span>
            <span className="text-cyan-300/80">{t('classifiedShort')}</span>
          </div>
        </div>

        {/* Glow line under the card */}
        <div className="h-px w-full mt-0.5" style={{ background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.3), transparent)' }} />
        </motion.div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-20">
        <StatusBar />
        <AppFooter />
      </div>
      <EmergencyButton authenticated={false} />

      <AnimatePresence>
        {guideOpen && <GuideModal onClose={() => setGuideOpen(false)} t={t} lang={lang} />}
      </AnimatePresence>
      <AnimatePresence>
        {menuOpen && (
          <MenuPanel
            t={t}
            onClose={() => setMenuOpen(false)}
            onOpenGuide={() => { setGuideOpen(true); setMenuOpen(false); }}
            onOpenInfo={(panel) => { setInfoPanel(panel); setMenuOpen(false); }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {settingsOpen && (
          <SettingsPanel
            t={t}
            lang={lang}
            setLang={setLang}
            onClose={() => setSettingsOpen(false)}
            soundEnabled={soundEnabled}
            setSoundEnabled={setSoundEnabled}
            soundVolume={soundVolume}
            setSoundVolume={setSoundVolume}
            onOpenGuide={() => { setGuideOpen(true); setSettingsOpen(false); }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {infoPanel && <InfoModal panel={infoPanel} t={t} onClose={() => setInfoPanel(null)} />}
      </AnimatePresence>
    </div>
  );
}
