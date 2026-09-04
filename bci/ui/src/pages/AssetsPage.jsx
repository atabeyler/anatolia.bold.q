import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

const ASSET_TYPES = ['DOMAIN', 'HOST', 'WEB_APP', 'API', 'REPOSITORY', 'CONTAINER', 'CLOUD_RESOURCE', 'IDENTITY', 'SERVICE'];

export default function AssetsPage() {
  const { hasPermission } = useAuth();
  const [assets, setAssets] = useState([]);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [assetType, setAssetType] = useState(ASSET_TYPES[0]);
  const [creating, setCreating] = useState(false);

  function load() {
    api.listAssets().then((r) => setAssets(r.assets)).catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function onCreate(e) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await api.createAsset({ name, assetType });
      setName('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h2>Assets</h2>
      {error && <p className="error">{error}</p>}

      {hasPermission('asset:create') && (
        <form className="stack card" onSubmit={onCreate} style={{ flexDirection: 'row', alignItems: 'end', maxWidth: 'none' }}>
          <div>
            <label htmlFor="assetName">Name</label>
            <input id="assetName" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="assetType">Type</label>
            <select id="assetType" value={assetType} onChange={(e) => setAssetType(e.target.value)}>
              {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button type="submit" disabled={creating}>Add asset</button>
        </form>
      )}

      <table className="card">
        <thead>
          <tr><th>Name</th><th>Type</th><th>Criticality</th></tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id}>
              <td>{a.name}</td>
              <td>{a.asset_type}</td>
              <td>{a.criticality}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
