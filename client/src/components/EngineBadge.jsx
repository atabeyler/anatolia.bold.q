import React from 'react';
import { Cloud, BrainCircuit, HardDrive } from 'lucide-react';
import { ENGINE } from '../services/aiContract.js';
import { useLang } from '../services/langContext.jsx';

// The one place that renders "which engine actually answered" (task spec
// point 8) -- used by both AnalysisView's result panel and ConsultChat's
// message list, so the three states (Q CLOUD / Q LOCAL LLM / Q LOCAL DATA)
// are always visually distinct and never mislabeled as each other.
const CONFIG = {
  [ENGINE.CLOUD]: { icon: Cloud, key: 'qCloudBadge', className: 'text-cyan-300/80' },
  [ENGINE.LOCAL_LLM]: { icon: BrainCircuit, key: 'qLocalLlmBadge', className: 'text-emerald-300/80' },
  [ENGINE.LOCAL_DATA]: { icon: HardDrive, key: 'qLocalDataBadge', className: 'text-amber-300/80' },
};

export default function EngineBadge({ engine, providerLabel, size = 'sm' }) {
  const { t } = useLang();
  const config = CONFIG[engine] || CONFIG[ENGINE.CLOUD];
  const Icon = config.icon;
  const iconSize = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5';
  // Cloud keeps showing the actual provider name (e.g. "Claude (Anthropic)")
  // as its label, same as before this task -- the Cloud icon already makes
  // it unambiguous. The two local engines always show their explicit,
  // distinct "Q LOCAL LLM (Offline)" / "Q LOCAL DATA (Offline)" label
  // instead of a generic "local" label, so they're never confusable with
  // each other or with cloud (task spec point 8).
  const label = engine === ENGINE.CLOUD ? (providerLabel || t(config.key)) : t(config.key);
  return (
    <span className={`inline-flex items-center gap-1 font-mono uppercase tracking-wide ${config.className} ${size === 'sm' ? 'text-xs' : 'text-[11px]'}`}>
      <Icon className={iconSize} />
      {label}
    </span>
  );
}
