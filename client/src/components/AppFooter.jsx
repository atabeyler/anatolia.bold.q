import React from 'react';
import { useLang } from '../services/langContext.jsx';

export default function AppFooter({ fixed = false }) {
  const { t } = useLang();
  return (
    <footer className={`${fixed ? 'fixed bottom-0 left-0 right-0' : 'relative'} z-20 py-2 border-t border-gold/20 bg-navy-light/80 backdrop-blur flex items-center justify-center px-4`}>
      <p className="text-[8px] sm:text-[9px] md:text-[10px] lg:text-xs leading-tight text-gold/60 tracking-wide sm:tracking-wider text-center">
        <strong className="text-gold/80">{t('company')}</strong>
        {' · '}<span className="text-gold/50">{t('rights')}</span>
        {' · '}<span className="text-gold/40">{t('projectCode')}: QTR-200120401018</span>
        {' · '}<span className="text-[7px] sm:text-[8px] md:text-[9px] lg:text-[10px] text-gold/40">{t('classified')}</span>
      </p>
    </footer>
  );
}
