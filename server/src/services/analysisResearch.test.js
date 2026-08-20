import { describe, it, expect, vi, beforeEach } from 'vitest';

const researchWebMock = vi.fn(async () => [{ title: 'Result', url: 'https://example.com', snippet: 'x' }]);
vi.mock('./webResearch.js', () => ({
  researchWeb: (...args) => researchWebMock(...args),
  formatResearchContext: (results) => (results.length ? `[web] ${results.length} result(s)` : ''),
}));
vi.mock('./ai.js', () => ({
  getCategoryGroup: () => 'defense',
  CATEGORY_GROUP_SOURCES: { defense: { local: ['mevzuat.gov.tr'], international: [] } },
}));

const { gatherResearchContext } = await import('./analysisResearch.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('gatherResearchContext', () => {
  it('runs the web-search queries for the default (standart) depth', async () => {
    const context = await gatherResearchContext('savunma', 'İHA teknolojisi');
    expect(researchWebMock).toHaveBeenCalled();
    expect(context).toContain('[web]');
  });

  it('runs the web-search queries when depth is explicitly derin', async () => {
    const context = await gatherResearchContext('savunma', 'İHA teknolojisi', 'derin');
    expect(researchWebMock).toHaveBeenCalled();
    expect(context).toContain('[web]');
  });

  it('skips the web-search round-trip entirely for hizli depth', async () => {
    const context = await gatherResearchContext('savunma', 'İHA teknolojisi', 'hizli');
    expect(researchWebMock).not.toHaveBeenCalled();
    expect(context).toBe('');
  });
});
