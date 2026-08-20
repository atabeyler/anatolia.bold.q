import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Wifi, Cpu } from 'lucide-react';
import { useLang } from '../services/langContext.jsx';
import { localeFor } from '../services/i18n.js';

// Split out of LoginPage.jsx: purely decorative/presentational pieces of
// the boot screen (background, logo animation, boot text, status bar) that
// take no closures over LoginPage's own state -- only props/hooks of their
// own -- so they don't need to live alongside the login form logic.

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
export function Corner({ pos }) {
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
export function GridBackground() {
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
export function OrbitalLogo() {
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
export function BootSequence({ onDone, lang }) {
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
    <div className="font-mono text-xs sm:text-sm text-left space-y-1 mb-6 px-2">
      {lines.map((line, i) => (
        <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-1 text-cyan-300/90">
          <span className="text-gold/70">&gt;</span>
          <span>{line.text}</span>
          <span className="text-emerald-400/80 tracking-widest">{line.result}</span>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Status bar (bottom) ─────────────────────────────────────────────────
export function StatusBar() {
  const { t, lang } = useLang();
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }}
      className="border-t border-cyan-500/20 bg-[#010812]/80 backdrop-blur px-3 sm:px-6 py-1.5 flex items-center justify-between gap-2">
      <div className="flex items-center gap-3 sm:gap-5 text-xs sm:text-sm font-mono">
        <span className="flex items-center gap-1 text-emerald-400/80">
          <motion.span className="w-1.5 h-1.5 rounded-full bg-emerald-400"
            animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
          {t('statusSystemActive')}
        </span>
        <span className="hidden sm:flex items-center gap-1 text-cyan-300/90">
          <Wifi className="w-3 h-3" /> {t('statusSecureChannel')}
        </span>
        <span className="hidden sm:flex items-center gap-1 text-cyan-300/90">
          <Cpu className="w-3 h-3" /> {t('statusQuantumUnitOk')}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs sm:text-sm font-mono text-gold/60">
        <span className="hidden sm:inline">ANATOLIA-Q v{__APP_VERSION__}</span>
        <span className="text-cyan-300/80">{time.toLocaleTimeString(localeFor(lang))}</span>
      </div>
    </motion.div>
  );
}
