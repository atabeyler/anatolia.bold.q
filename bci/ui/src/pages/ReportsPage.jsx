import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

const REPORT_TYPES = ['EXECUTIVE', 'TECHNICAL', 'REMEDIATION', 'AUDIT'];

export default function ReportsPage() {
  const { hasPermission } = useAuth();
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);

  function load() {
    api.listReports().then((r) => setReports(r.reports)).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  async function onGenerate(reportType) {
    setGenerating(true);
    setError(null);
    try {
      await api.generateReport(reportType);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function view(id) {
    setSelected(await api.getReport(id));
  }

  return (
    <div>
      <h2>Reports</h2>
      {error && <p className="error">{error}</p>}

      {hasPermission('report:export') && (
        <div className="card" style={{ display: 'flex', gap: 8 }}>
          {REPORT_TYPES.map((t) => (
            <button key={t} className="secondary" disabled={generating} onClick={() => onGenerate(t)}>
              Generate {t}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>{selected.report.report_type}</strong>
            <button className="secondary" onClick={() => setSelected(null)}>Close</button>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>
            hash: {selected.report.content_hash.slice(0, 16)}… · integrity:{' '}
            <span className={`badge ${selected.report.integrityValid ? 'ok' : 'danger'}`}>
              {selected.report.integrityValid ? 'valid' : 'TAMPERED'}
            </span>
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 300, overflow: 'auto' }}>
            {JSON.stringify(selected.report.content, null, 2)}
          </pre>
        </div>
      )}

      <table className="card">
        <thead>
          <tr><th>Type</th><th>Generated</th><th>BCI Version</th><th></th></tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id}>
              <td>{r.report_type}</td>
              <td>{new Date(r.created_at).toLocaleString()}</td>
              <td>{r.bci_version}</td>
              <td><button className="secondary" onClick={() => view(r.id)}>View</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
