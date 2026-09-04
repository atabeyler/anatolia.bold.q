import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function scoreBadge(score) {
  if (score == null) return 'muted';
  if (score >= 80) return 'ok';
  if (score >= 50) return 'warn';
  return 'danger';
}

export default function DashboardPage() {
  const [security, setSecurity] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.securityScore(), api.coverageScore()])
      .then(([s, c]) => { setSecurity(s); setCoverage(c); })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <h2>Dashboard</h2>
      {error && <p className="error">{error}</p>}
      <div className="grid">
        <div className="card tile">
          <div className={`value badge ${scoreBadge(security?.score)}`}>{security?.score ?? '—'}</div>
          <div className="label">Security Score</div>
        </div>
        <div className="card tile">
          <div className={`value badge ${scoreBadge(coverage?.score)}`}>{coverage?.score ?? '—'}</div>
          <div className="label">Coverage Score</div>
          {coverage?.reason && <div className="label">{coverage.reason}</div>}
        </div>
        <div className="card tile">
          <div className="value">{security?.openFindingCount ?? '—'}</div>
          <div className="label">Open Findings</div>
        </div>
      </div>
    </div>
  );
}
