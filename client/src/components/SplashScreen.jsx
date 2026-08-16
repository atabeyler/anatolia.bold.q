import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import QuantumLogo from './QuantumLogo.jsx';

const DISPLAY_MS = 2500;

// Shown briefly when the app is launched as an installed PWA (home screen /
// desktop icon) -- the icon itself can't animate (OS-level icons are static
// PNGs), so this reproduces the in-app animated logo full-screen for a
// moment right after launch instead.
export default function SplashScreen() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), DISPLAY_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-[#0a0e1a]"
        >
          <QuantumLogo size="lg" />
          <div
            className="text-gold text-sm tracking-[0.35em] uppercase"
            style={{ fontFamily: "'Cinzel', 'Times New Roman', serif" }}
          >
            ANATOLIA-Q
          </div>
          <div className="text-gold text-[10px] tracking-[0.3em] uppercase">
            BOLD TECHNOLOGIES
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
