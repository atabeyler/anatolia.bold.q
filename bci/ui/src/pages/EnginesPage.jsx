import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

function statusBadge(status) {
  if (status === 'HEALTHY') return 'ok';
  if (status === 'DEGRADED') return 'warn';
  return 'danger';
}

export default function EnginesPage() {
  const { hasPermission } = useAuth();
  const [engines, setEngines] = useState([]);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);

  function load() {
    api.listEngines().then((r) => setEngines(r.engines)).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  async function onHealthCheck() {
    setChecking(true);
    setError(null);
    try {
      await api.runEngineHealthCheck();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <h2>Engines</h2>
      {error && <p className="error">{error}</p>}

      {hasPermission('system:manage') && (
        <button disabled={checking} onClick={onHealthCheck} style={{ marginBottom: 12 }}>
          {checking ? 'Checking…' : 'Run health check'}
        </button>
      )}

      <table className="card">
        <thead>
          <tr><th>Engine</th><th>Status</th><th>Version</th><th>Intrusiveness</th><th>License</th><th>Last checked</th></tr>
        </thead>
        <tbody>
          {engines.map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td>
              <td><span className={`badge ${statusBadge(e.status)}`}>{e.status || 'UNKNOWN'}</span></td>
              <td>{e.version || '—'}</td>
              <td>{e.intrusiveness}</td>
              <td>{e.license}</td>
              <td>{e.last_checked_at ? new Date(e.last_checked_at).toLocaleString() : 'never'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
