import { describe, it, expect } from 'vitest';
import { generateReportDocx } from './docx.js';

describe('generateReportDocx', () => {
  it('produces a valid .docx (ZIP) buffer from markdown content', async () => {
    const content = `## YÖNETİCİ ÖZETİ
Bu bir test raporudur.

- Madde bir
- Madde iki

| Senaryo | Olasılık |
|---|---|
| A | %50 |
| B | %50 |
`;
    const buf = await generateReportDocx({
      category: 'ekonomi',
      title: 'Test Raporu',
      content,
      userCode: 'BOLD-001',
      aiProvider: 'Test Provider',
    });

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    // .docx files are ZIP archives — the signature starts with "PK".
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('produces a document without crashing even for empty content', async () => {
    const buf = await generateReportDocx({
      category: 'savunma',
      title: 'Empty Report',
      content: '',
      userCode: 'BOLD-002',
      aiProvider: 'Test',
    });
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');
  });
});
