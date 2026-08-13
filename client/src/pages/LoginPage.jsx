import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Shield, CheckCircle, XCircle, Wifi, Cpu, Activity, Menu as MenuIcon, Settings as SettingsIcon } from 'lucide-react';
import { api, setJWT } from '../services/api.js';
import { isDesktop, desktopAuth, desktopConnectivity } from '../services/desktopBridge.js';
import EmergencyButton from '../components/EmergencyButton.jsx';
import { useLang } from '../services/langContext.jsx';
import { localeFor } from '../services/i18n.js';
import { registerActions, unregisterActions } from '../services/voiceActionRegistry.js';
import { MenuPanel, SettingsPanel, InfoModal, GuideModal } from '../components/AppMenus.jsx';
import AppFooter from '../components/AppFooter.jsx';

const STAGES = { IDLE: 'idle', AWAITING_APPROVAL: 'awaiting', APPROVED: 'approved', EXPIRED: 'expired' };

// Authorizes this desktop install's device_id against the account (see
// desktop/auth/session.js) right after an ordinary online login succeeds --
// this is the "online authorization" step spec point 5 requires before
// offline login is allowed on this machine. Also caches a bcrypt hash of
// the password just used (never the plaintext) so a later offline login on
// this same device can be verified locally. A no-op on the web build
// (isDesktop is false there) and never blocks the login flow if it fails --
// the user is still online and logged in either way, they just won't be
// able to log in offline on this device until it succeeds once.
function registerDesktopSession(jwt, password) {
  if (!isDesktop || !jwt) return;
  desktopAuth.establishOnlineSession(jwt, password).catch((err) => {
    console.warn('[ANATOLIA-Q Desktop] Device authorization failed:', err?.message || err);
  });
}

// ─── Boot sequence lines ─────────────────────────────────────────────────
const BOOT_LINES_BY_LANG = {
  en: [
    { text: 'QUANTUM PROCESSING UNIT..............', result: '[ ACTIVE ]', delay: 0 },
    { text: 'ENCRYPTION PROTOCOL (AES-256)........', result: '[ LOADED ]', delay: 320 },
    { text: 'SATELLITE LINK GEO-3.................', result: '[ STRONG ]', delay: 620 },
    { text: 'IDENTITY VERIFICATION MODULE.........', result: '[ READY ]',  delay: 900 },
  ],
  tr: [
    { text: 'KUANTUM İŞLEM BİRİMİ.................', result: '[ AKTİF ]', delay: 0 },
    { text: 'ŞİFRELEME PROTOKOLü (AES-256)......', result: '[ YÜKLÜ ]', delay: 320 },
    { text: 'UYDU BAĞLANTISI GEO-3...............', result: '[ GÜÇLÜ ]', delay: 620 },
    { text: 'KİMLİK DOĞRULAMA MODÜLü.............', result: '[ HAZIR ]', delay: 900 },
  ],
  de: [
    { text: 'QUANTENVERARBEITUNGSEINHEIT..........', result: '[ AKTIV ]', delay: 0 },
    { text: 'VERSCHLÜSSELUNGSPROTOKOLL (AES-256)..', result: '[ GELADEN ]', delay: 320 },
    { text: 'SATELLITENVERBINDUNG GEO-3...........', result: '[ STARK ]', delay: 620 },
    { text: 'IDENTITÄTSPRÜFUNGSMODUL..............', result: '[ BEREIT ]', delay: 900 },
  ],
  fr: [
    { text: 'UNITÉ DE TRAITEMENT QUANTIQUE........', result: '[ ACTIF ]', delay: 0 },
    { text: 'PROTOCOLE DE CHIFFREMENT (AES-256)...', result: '[ CHARGÉ ]', delay: 320 },
    { text: 'LIAISON SATELLITE GEO-3..............', result: '[ FORTE ]', delay: 620 },
    { text: 'MODULE DE VÉRIFICATION D\'IDENTITÉ....', result: '[ PRÊT ]', delay: 900 },
  ],
  ar: [
    { text: 'وحدة المعالجة الكمية.................', result: '[ نشط ]', delay: 0 },
    { text: 'بروتوكول التشفير (AES-256)...........', result: '[ محمّل ]', delay: 320 },
    { text: 'الرابط الساتلي GEO-3..................', result: '[ قوي ]', delay: 620 },
    { text: 'وحدة التحقق من الهوية.................', result: '[ جاهز ]', delay: 900 },
  ],
};
const getBootLines = (lang) => BOOT_LINES_BY_LANG[lang] || BOOT_LINES_BY_LANG.tr;

// ─── Corner bracket ──────────────────────────────────────────────────────
function Corner({ pos }) {
  const cls = {
    tl: 'top-3 left-3 border-t-2 border-l-2 origin-top-left',
    tr: 'top-3 right-3 border-t-2 border-r-2 origin-top-right',
    bl: 'bottom-3 left-3 border-b-2 border-l-2 origin-bottom-left',
    br: 'bottom-3 right-3 border-b-2 border-r-2 origin-bottom-right',
  }[pos];
  return (
    <motion.div
      initial={{ scale: 0 }} animate={{ scale: 1 }}
      transition={{ duration: 0.4, delay: 0.1, ease: 'easeOut' }}
      className={`fixed z-20 w-8 h-8 sm:w-14 sm:h-14 border-cyan-400/50 pointer-events-none ${cls}`}
    />
  );
}

// ─── Animated grid background ────────────────────────────────────────────
function GridBackground() {
  return (
    <>
      {/* Deep space color */}
      <div className="fixed inset-0 bg-[#010812]" />
      {/* Grid lines */}
      <div className="fixed inset-0" style={{
        backgroundImage: `
          linear-gradient(rgba(0,212,255,0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,212,255,0.04) 1px, transparent 1px)
        `,
        backgroundSize: '48px 48px',
      }} />
      {/* Center glow */}
      <div className="fixed inset-0" style={{
        background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(0,100,180,0.08) 0%, transparent 70%)',
      }} />
      {/* Scan line */}
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)',
      }} />
      {/* Stars */}
      <Stars />
    </>
  );
}

function Stars() {
  const stars = useRef(
    Array.from({ length: 80 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 1.5 + 0.5,
      delay: Math.random() * 4,
      dur: 2.5 + Math.random() * 3,
    }))
  ).current;

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      {stars.map(s => (
        <motion.div key={s.id}
          className="absolute rounded-full bg-white"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size }}
          animate={{ opacity: [0.1, 0.8, 0.1] }}
          transition={{ duration: s.dur, repeat: Infinity, delay: s.delay }}
        />
      ))}
    </div>
  );
}

// ─── Orbital Logo ────────────────────────────────────────────────────────
function OrbitalLogo() {
  return (
    <div className="relative w-28 h-28 sm:w-36 sm:h-36 mx-auto mb-2">
      {/* Outer ring */}
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
        className="absolute inset-0">
        <svg viewBox="0 0 144 144" className="w-full h-full">
          <circle cx="72" cy="72" r="68" fill="none" stroke="rgba(0,212,255,0.15)" strokeWidth="0.5" />
          <ellipse cx="72" cy="72" rx="68" ry="24" fill="none" stroke="rgba(212,175,55,0.5)" strokeWidth="0.8"
            strokeDasharray="4 3" />
          <ellipse cx="72" cy="72" rx="68" ry="24" fill="none" stroke="rgba(200,16,46,0.4)" strokeWidth="0.8"
            strokeDasharray="4 3" transform="rotate(60 72 72)" />
          <ellipse cx="72" cy="72" rx="68" ry="24" fill="none" stroke="rgba(0,212,255,0.4)" strokeWidth="0.8"
            strokeDasharray="4 3" transform="rotate(-60 72 72)" />
        </svg>
      </motion.div>
      {/* Inner radar scanner */}
      <motion.div animate={{ rotate: -360 }} transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
        className="absolute inset-4">
        <div className="w-full h-full rounded-full border border-cyan-400/20"
          style={{ background: 'conic-gradient(from 0deg, transparent 75%, rgba(0,212,255,0.25) 100%)' }} />
      </motion.div>
      {/* Center Q button */}
      <motion.div animate={{ scale: [1, 1.08, 1], boxShadow: ['0 0 20px #d4af37, 0 0 50px rgba(212,175,55,0.3)', '0 0 35px #d4af37, 0 0 70px rgba(212,175,55,0.5)', '0 0 20px #d4af37, 0 0 50px rgba(212,175,55,0.3)'] }}
        transition={{ duration: 2.5, repeat: Infinity }}
        className="absolute inset-0 flex items-center justify-center">
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#010812] border-2 border-gold flex items-center justify-center font-display text-3xl sm:text-4xl font-bold text-gold">
          Q
        </div>
      </motion.div>
      {/* Corner dots */}
      {[0, 90, 180, 270].map((deg, i) => (
        <motion.div key={i} className="absolute w-1.5 h-1.5 rounded-full bg-cyan-400"
          style={{ top: '50%', left: '50%', transformOrigin: '0 0',
            transform: `rotate(${deg}deg) translate(54px, -3px) sm:translate(68px, -3px)` }}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.3 }}
        />
      ))}
    </div>
  );
}

// ─── Boot sequence text ──────────────────────────────────────────────────
function BootSequence({ onDone, lang }) {
  const [lines, setLines] = useState([]);

  useEffect(() => {
    const BOOT_LINES = getBootLines(lang);
    BOOT_LINES.forEach((line, i) => {
      setTimeout(() => {
        setLines(prev => [...prev, line]);
        if (i === BOOT_LINES.length - 1) setTimeout(onDone, 300);
      }, line.delay);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="font-mono text-[10px] sm:text-xs text-left space-y-1 mb-6 px-2">
      {lines.map((line, i) => (
        <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-1 text-cyan-300/90">
          <span className="text-gold/40">&gt;</span>
          <span>{line.text}</span>
          <span className="text-emerald-400/80 tracking-widest">{line.result}</span>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Status bar (bottom) ─────────────────────────────────────────────────
function StatusBar() {
  const { t, lang } = useLang();
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }}
      className="border-t border-cyan-500/20 bg-[#010812]/80 backdrop-blur px-3 sm:px-6 py-1.5 flex items-center justify-between gap-2">
      <div className="flex items-center gap-3 sm:gap-5 text-[9px] sm:text-[10px] font-mono">
        <span className="flex items-center gap-1 text-emerald-400/70">
          <motion.span className="w-1.5 h-1.5 rounded-full bg-emerald-400"
            animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
          {t('statusSystemActive')}
        </span>
        <span className="hidden sm:flex items-center gap-1 text-cyan-300/80">
          <Wifi className="w-3 h-3" /> {t('statusSecureChannel')}
        </span>
        <span className="hidden sm:flex items-center gap-1 text-cyan-300/80">
          <Cpu className="w-3 h-3" /> {t('statusQuantumUnitOk')}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[9px] sm:text-[10px] font-mono text-gold/30">
        <span className="hidden sm:inline">ANATOLIA-Q v{__APP_VERSION__}</span>
        <span className="text-cyan-300/70">{time.toLocaleTimeString(localeFor(lang))}</span>
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
  const pollRef = useRef(null);

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
          registerDesktopSession(r.jwt, password);
          setStage(STAGES.APPROVED);
          setTimeout(() => onLogin({ userCode: r.userCode }), 1500);
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
    const result = await desktopAuth.verifyOfflineLogin(userCode.trim(), password);
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
      if (isDesktop && (await desktopConnectivity.getState()) === 'local') {
        // Already known to be offline -- skip straight to local verification
        // instead of waiting out a network request that can't succeed.
        await attemptOfflineLogin();
        return;
      }
      const r = await api.loginRequest(userCode.trim(), password);
      // Admin: gets JWT directly, no approval wait
      if (r.status === 'approved' && r.jwt) {
        setJWT(r.jwt);
        registerDesktopSession(r.jwt, password);
        onLogin({ userCode: r.userCode, isAdmin: r.isAdmin });
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
      if (isDesktop && err instanceof TypeError) {
        await attemptOfflineLogin();
        return;
      }
      setError(err.message);
    } finally {
      setLoading(false);
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

      {/* Main card */}
      <motion.div initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-sm sm:max-w-md md:max-w-lg lg:max-w-md">

        {/* Card frame */}
        <div className="relative rounded-sm border border-cyan-500/25 bg-[#010e1e]/90 backdrop-blur-xl p-6 sm:p-8"
          style={{ boxShadow: '0 0 60px rgba(0,150,200,0.08), 0 0 120px rgba(0,80,160,0.05), inset 0 0 60px rgba(0,100,160,0.03)' }}>

          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-gold/60" />
          <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-gold/60" />
          <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-gold/60" />
          <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-gold/60" />

          {/* Top strip */}
          <div className="flex items-center justify-between mb-5 text-[9px] font-mono tracking-widest">
            <span className="text-cyan-300/70 uppercase">{t('projectCode')}: QTR-200120401018</span>
            <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.8, repeat: Infinity }}
              className="text-emerald-400/60 uppercase">● {t('secureLabel')}</motion.span>
            <span className="text-cyan-300/70 uppercase">{t('classifiedShort')}</span>
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
            <p className="text-[9px] sm:text-[10px] text-gold/40 tracking-[0.25em] uppercase">
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
                <motion.form onSubmit={handleLogin}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.9 }}
                  className="space-y-4">

                  <div className="text-[10px] font-mono text-cyan-300/70 tracking-widest uppercase mb-3">
                    &gt; {t('identityVerificationRequired')}
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] text-gold/60 tracking-widest uppercase font-mono">{t('userCode')}</label>
                    <div className="relative group">
                      <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400/40 group-focus-within:text-cyan-400 transition" />
                      <input type="text" value={userCode} onChange={e => setUserCode(e.target.value)}
                        placeholder="·  ·  ·  ·  ·  ·  ·" required autoFocus
                        className="w-full pl-10 pr-4 py-2.5 bg-[#020c18] border border-cyan-500/20 rounded-sm text-gold font-mono tracking-[0.2em] text-sm focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/20 transition placeholder-cyan-900/50" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] text-gold/60 tracking-widest uppercase font-mono">{t('password')}</label>
                    <div className="relative group">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400/40 group-focus-within:text-cyan-400 transition" />
                      <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                        className="w-full pl-10 pr-4 py-2.5 bg-[#020c18] border border-cyan-500/20 rounded-sm text-gold font-mono tracking-[0.2em] text-sm focus:border-cyan-400/60 focus:outline-none focus:ring-1 focus:ring-cyan-400/20 transition" />
                    </div>
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        className="text-crimson text-xs bg-crimson/10 border border-crimson/30 rounded-sm p-2.5 font-mono">
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
                </motion.form>
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
                <p className="text-[10px] font-mono text-cyan-300/70 tracking-wider mb-5">
                  &gt; {t('awaitingApprovalStatus')}
                </p>
                <button onClick={reset} className="text-xs text-crimson/60 hover:text-crimson font-mono underline">{t('cancel')}</button>
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
                <p className="text-xs text-gold/50 mb-5">{t('expiredNote')}</p>
                <motion.button onClick={reset} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  className="px-6 py-2 rounded-sm text-sm font-display tracking-widest text-gold border border-gold/40 hover:bg-gold/10 transition">
                  {t('retry')}
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom strip */}
          <div className="mt-5 pt-4 border-t border-cyan-500/10 flex items-center justify-between text-[9px] font-mono text-gold/30 tracking-wider">
            <span>ANATOLIA-Q v{__APP_VERSION__}</span>
            <span className="text-cyan-300/60">{t('classifiedShort')}</span>
          </div>
        </div>

        {/* Glow line under the card */}
        <div className="h-px w-full mt-0.5" style={{ background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.3), transparent)' }} />
      </motion.div>

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
            showAppearance={false}
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
