import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockApi = { listAssets: vi.fn() };
vi.mock('../src/api.js', () => ({ api: mockApi }));

const authValue = { hasPermission: vi.fn() };
vi.mock('../src/AuthContext.jsx', () => ({ useAuth: () => authValue }));

const { default: AssetsPage } = await import('../src/pages/AssetsPage.jsx');

beforeEach(() => {
  mockApi.listAssets.mockReset().mockResolvedValue({
    assets: [{ id: '1', name: 'example.com', asset_type: 'DOMAIN', criticality: 'HIGH' }],
  });
  authValue.hasPermission.mockReset();
});

describe('AssetsPage RBAC-aware rendering', () => {
  it('hides the create form for a user without asset:create', async () => {
    authValue.hasPermission.mockReturnValue(false);
    render(<AssetsPage />);
    expect(await screen.findByText('example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add asset/i })).not.toBeInTheDocument();
  });

  it('shows the create form for a user with asset:create', async () => {
    authValue.hasPermission.mockReturnValue(true);
    render(<AssetsPage />);
    expect(await screen.findByRole('button', { name: /add asset/i })).toBeInTheDocument();
  });
});
