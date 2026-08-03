import React, { createContext, useContext, useEffect, useState } from 'react';
import { t as translate } from './i18n.js';

const LangContext = createContext();

export const SUPPORTED_LANGS = ['tr', 'en', 'de', 'fr', 'ar'];
const RTL_LANGS = new Set(['ar']);

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    const saved = localStorage.getItem('anatolia_lang');
    return SUPPORTED_LANGS.includes(saved) ? saved : 'tr';
  });

  const setLang = (next) => {
    if (!SUPPORTED_LANGS.includes(next)) return;
    setLangState(next);
    localStorage.setItem('anatolia_lang', next);
  };

  // Kept for the few call sites (voice commands) that only ever toggle
  // between Turkish and English.
  const switchLang = () => setLang(lang === 'tr' ? 'en' : 'tr');

  const t = (key) => translate(lang, key);
  const dir = RTL_LANGS.has(lang) ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  useEffect(() => {
    const onSet = (e) => {
      const next = e?.detail?.lang;
      if (SUPPORTED_LANGS.includes(next)) setLang(next);
    };
    window.addEventListener('aq:lang:set', onSet);
    return () => window.removeEventListener('aq:lang:set', onSet);
  }, []);

  return (
    <LangContext.Provider value={{ lang, dir, setLang, switchLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
