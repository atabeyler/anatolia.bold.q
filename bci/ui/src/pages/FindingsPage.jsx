import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

function priorityBadge(priority) {
  if (priority === 'IMMEDIATE') return 'danger';
  if (priority === '24_HOURS' || priority === 'HIGH_PRIORITY') return 'warn';
  return 'muted';
}

function FindingDetail({ id, onClose, onChanged }) {
  const { hasPermission } = useAuth();
  const [finding, setFinding] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function load() {
    api.getFinding(id).then(setFinding).catch((err) => setError(err.message));
  }
  useEffect(load, [id]);

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!finding) return <div className="card">Loading…</div>;
  const { finding: f, sources } = finding;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>{f.title}</h3>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>
      <p style={{ color: 'var(--muted)' }}>{f.target} · {f.category}</p>
      {error && <p className="error">{error}</p>}
      <div className="grid" style={{ marginBottom: 12 }}>
        <div className="tile"><div className="value">{f.risk_score ?? '—'}</div><div className="label">Risk</div></div>
        <div className="tile"><div className="value">{f.confidence_score}</div><div className="label">Confidence</div></div>
        <div className="tile"><div className="value">{f.status}</div><div className="label">Status</div></div>
        <div className="tile"><div className="value">{f.verification_status}</div><div className="label">Verification</div></div>
      </div>

      <p><strong>Sources:</strong> {sources.map((s) => s.engine_id).join(', ') || 'none'}</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="secondary" disabled={busy} onClick={() => run(async () => setExplanation(await api.explainFinding(id)))}>
          Explain
        </button>
        <button className="secondary" disabled={busy} onClick={() => run(async () => setVerifyResult(await api.verifyFindingFix(id)))}>
          Verify fix
        </button>
        {hasPermission('finding:verify') && (
          <>
            <button className="secondary" disabled={busy} onClick={() => run(() => api.confirmFinding(id))}>Confirm</button>
            <button className="secondary" disabled={busy} onClick={() => run(() => api.markFalsePositive(id))}>
              Mark false positive
            </button>
          </>
        )}
      </div>

      {explanation && <p className="card">{explanation.text} <em style={{ color: 'var(--muted)' }}>({explanation.source})</em></p>}
      {verifyResult && <p className="card">Verify result: <strong>{verifyResult.result}</strong> — {verifyResult.detail}</p>}
    </div>
  );
}

export default function FindingsPage() {
  const [findings, setFindings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    api.listFindings().then((r) => setFindings(r.findings)).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  return (
    <div>
      <h2>Findings</h2>
      {error && <p className="error">{error}</p>}

      {selectedId && <FindingDetail id={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />}

      <table className="card">
        <thead>
          <tr><th>Title</th><th>Target</th><th>Priority</th><th>Risk</th><th>Status</th></tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(f.id)}>
              <td>{f.title}</td>
              <td>{f.target}</td>
              <td>{f.priority && <span className={`badge ${priorityBadge(f.priority)}`}>{f.priority}</span>}</td>
              <td>{f.risk_score ?? '—'}</td>
              <td>{f.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
