import React, { useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { isDesktop, desktopConnectivity, desktopSync } from '../services/desktopBridge.js';

const LABELS = {
  cloud: { text: 'Q CLOUD', icon: Cloud, className: 'text-emerald-400 border-emerald-400/40' },
  sync: { text: 'SYNC', icon: RefreshCw, className: 'text-cyan-300 border-cyan-300/40 animate-pulse' },
  local: { text: 'Q LOCAL', icon: CloudOff, className: 'text-gold/70 border-gold/40' },
};

// Desktop-only status chip (spec point 6: the user never picks cloud vs.
// local manually — this just reflects which mode the app is currently in).
// Renders nothing at all on the web build, since isDesktop is false there.
export default function DesktopSyncBadge() {
  const [state, setState] = useState('local');

  useEffect(() => {
    if (!isDesktop) return undefined;
    desktopSync.status().then((s) => s && setState(s.state)).catch(() => {});
    return desktopConnectivity.onChange(setState);
  }, []);

  if (!isDesktop) return null;

  const { text, icon: Icon, className } = LABELS[state] || LABELS.local;
  return (
    <span
      className={`btn-depth header-control h-[28px] sm:h-[30px] px-2.5 py-0 rounded text-[10px] tracking-widest font-display flex items-center gap-1.5 shrink-0 border ${className}`}
      title="ANATOLIA-Q Desktop çalışma modu"
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="hidden lg:inline">{text}</span>
    </span>
  );
}
