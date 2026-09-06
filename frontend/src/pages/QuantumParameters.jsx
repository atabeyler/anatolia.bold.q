import React, { useEffect, useState } from 'react';

const FEATURES = ['dos','fuzz','intrusive'];

export default function QuantumParameters() {
  const [items, setItems] = useState({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/quantum-params', { credentials: 'include' })
      .then(r => r.json()).then(data => {
        const map = {};
        for (const row of data) map[row.feature] = row;
        setItems(map);
      }).finally(()=>setLoading(false));
  }, []);

  async function toggle(feature, enabled) {
    const reason = prompt('Değişiklik nedeni (loglanacaktır):') || '';
    const expires = prompt('Opsiyonel: kaç saat sonra otomatik kapansın? (boş=kalıcı)') || '';
    let expires_at = null;
    if (expires) {
      const hours = parseFloat(expires);
      if (Number.isFinite(hours)) {
        expires_at = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      }
    }
    if (!confirm(`${feature.toUpperCase()} için ${enabled ? 'AÇMA' : 'KAPAMA'} işlemini onaylıyor musunuz?`)) return;
    const res = await fetch(`/api/quantum-params/${feature}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, expires_at, reason }),
      credentials: 'include'
    });
    if (!res.ok) return alert('Güncelleme başarısız: ' + res.statusText);
    const updated = await res.json();
    setItems(prev => ({ ...prev, [feature]: updated }));
  }

  if (loading) return <div>Yükleniyor...</div>;
  return (
    <div>
      <h1>Quantum Parametreleri</h1>
      <p>Buradan DOS / FUZZ / INTRUSIVE güvenlik sınırlarını yönetebilirsiniz. Değişiklikler audit loglanır.</p>
      <ul>
        {FEATURES.map(f => {
          const row = items[f] || { enabled: false };
          return (
            <li key={f} style={{marginBottom:12}}>
              <strong>{f.toUpperCase()}</strong>
              <label style={{marginLeft:12}}>
                <input type="checkbox" checked={!!row.enabled} onChange={e=>toggle(f, e.target.checked)} />
                {row.enabled ? ' Açık' : ' Kapalı'}
              </label>
              {row.expires_at && <span style={{marginLeft:8}}> (expires: {new Date(row.expires_at).toLocaleString()})</span>}
              {row.reason && <div style={{fontSize:12,color:'#666'}}>Not: {row.reason}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
