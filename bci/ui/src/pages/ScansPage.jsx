import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

const CLASSES = ['PASSIVE', 'SAFE_ACTIVE', 'AUTHENTICATED', 'RESTRICTED'];

function statusBadge(status) {
  if (['COMPLETED'].includes(status)) return 'ok';
  if (['FAILED', 'TIMED_OUT', 'CANCELLED'].includes(status)) return 'danger';
  return 'warn';
}

export default function ScansPage() {
  const { hasPermission } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [target, setTarget] = useState('');
  const [requestedClass, setRequestedClass] = useState('PASSIVE');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    api.listScans().then((r) => setJobs(r.jobs)).catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function onCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createScan({ target, requestedClass });
      setTarget('');
      load();
    } catch (err) {
      setError(err.data?.reason ? `${err.message}: ${err.data.reason}` : err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2>Scans</h2>
      {error && <p className="error">{error}</p>}

      {hasPermission('scan:create') && (
        <form className="stack card" onSubmit={onCreate} style={{ flexDirection: 'row', alignItems: 'end', maxWidth: 'none' }}>
          <div>
            <label htmlFor="scanTarget">Target</label>
            <input id="scanTarget" value={target} onChange={(e) => setTarget(e.target.value)} required placeholder="example.com" />
          </div>
          <div>
            <label htmlFor="scanClass">Scan class</label>
            <select id="scanClass" value={requestedClass} onChange={(e) => setRequestedClass(e.target.value)}>
              {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button type="submit" disabled={submitting}>Start scan</button>
        </form>
      )}

      <p style={{ color: 'var(--muted)', fontSize: 13 }}>
        A scan only starts if the target is covered by an APPROVED authorized scope for the requested class.
      </p>

      <table className="card">
        <thead>
          <tr><th>Target</th><th>Class</th><th>Status</th><th>Attempts</th></tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>{j.target}</td>
              <td>{j.requested_class}</td>
              <td><span className={`badge ${statusBadge(j.status)}`}>{j.status}</span></td>
              <td>{j.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
