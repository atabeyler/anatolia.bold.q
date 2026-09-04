import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/assets', label: 'Assets' },
  { to: '/scans', label: 'Scans' },
  { to: '/findings', label: 'Findings' },
  { to: '/reports', label: 'Reports' },
  { to: '/engines', label: 'Engines' },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <h1>BCI</h1>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {item.label}
          </NavLink>
        ))}
        <div style={{ marginTop: 'auto' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{user?.email}</div>
          <a className="logout" onClick={logout}>
            Log out
          </a>
        </div>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
