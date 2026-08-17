import React from 'react';
import { motion } from 'framer-motion';

const KEYFRAMES = `
  @keyframes orb1 { from { transform: rotateX(72deg) rotateZ(0deg); } to { transform: rotateX(72deg) rotateZ(360deg); } }
  @keyframes orb2 { from { transform: rotateX(72deg) rotateZ(60deg); } to { transform: rotateX(72deg) rotateZ(420deg); } }
  @keyframes orb3 { from { transform: rotateX(72deg) rotateZ(120deg); } to { transform: rotateX(72deg) rotateZ(480deg); } }
  @keyframes coreGlow { 0%,100% { box-shadow: 0 0 12px #00c8ff, 0 0 24px rgba(0,200,255,0.3), inset 0 0 8px rgba(212,175,55,0.3); } 50% { box-shadow: 0 0 20px #00c8ff, 0 0 45px rgba(0,200,255,0.6), inset 0 0 12px rgba(212,175,55,0.5); } }
`;

export default function QuantumLogo({ size = 'md' }) {
  const s = size === 'lg' ? 112 : size === 'sm' ? 40 : 52;
  const core = Math.round(s * 0.42);
  const font = Math.round(s * 0.19);
  const bw = Math.max(1, Math.round(s * 0.032));

  return React.createElement(
    motion.div,
    {
      animate: { filter: ['drop-shadow(0 0 6px #00c8ff) drop-shadow(0 0 12px rgba(0,200,255,0.3))', 'drop-shadow(0 0 14px #00c8ff) drop-shadow(0 0 28px rgba(0,200,255,0.6))', 'drop-shadow(0 0 6px #00c8ff) drop-shadow(0 0 12px rgba(0,200,255,0.3))'] },
      transition: { duration: 2.5, repeat: Infinity },
      style: { width: s, height: s, position: 'relative', flexShrink: 0, perspective: s * 4 }
    },
    React.createElement('style', null, KEYFRAMES),
    React.createElement('div', { style: { position: 'absolute', inset: Math.round(s*0.04), border: '1px dashed rgba(0,200,255,0.2)', borderRadius: '50%' } }),
    React.createElement('div', { style: { position: 'absolute', inset: 0, border: bw + 'px solid #d4af37', borderRadius: '50%', animation: 'orb1 8s linear infinite', opacity: 0.85 } }),
    React.createElement('div', { style: { position: 'absolute', inset: 0, border: bw + 'px solid #00c8ff', borderRadius: '50%', animation: 'orb2 6s linear infinite', opacity: 0.75 } }),
    React.createElement('div', { style: { position: 'absolute', inset: 0, border: Math.max(1,Math.round(s*0.024)) + 'px solid #7000ff', borderRadius: '50%', animation: 'orb3 10s linear infinite', opacity: 0.6 } }),
    React.createElement('div', {
      style: {
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%,-50%)',
        width: core, height: core, borderRadius: '50%',
        background: 'radial-gradient(circle at 38% 35%, #00e0ff, #0090cc 50%, #003366)',
        border: Math.max(1,Math.round(s*0.025)) + 'px solid #00c8ff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'coreGlow 2.5s ease-in-out infinite',
        zIndex: 10
      }
    },
      React.createElement('span', {
        style: {
          fontFamily: 'Cinzel, serif', fontWeight: 700, fontSize: font,
          color: '#ffffff', lineHeight: 1, userSelect: 'none',
          textShadow: '0 0 8px #00c8ff'
        }
      }, 'Q')
    )
  );
}
