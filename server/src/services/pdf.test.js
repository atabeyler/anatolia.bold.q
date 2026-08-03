import { describe, it, expect } from 'vitest';
import pdfParse from 'pdf-parse';
import { generateReportPdf, splitBoldSegments } from './pdf.js';

async function pdfText(buf) {
  const { text } = await pdfParse(buf);
  return text;
}

describe('generateReportPdf', () => {
  it('renders Turkish special characters correctly instead of garbling them', async () => {
    // Regression test: pdfkit's built-in standard fonts (Times-Roman etc.)
    // only support WinAnsiEncoding, which doesn't contain ğ/ş/ı/İ/ö/ü/ç --
    // those bytes (and everything after them on the line) came out as
    // corrupted symbols. Fonts must be embedded (see registerFonts in
    // pdf.js) for these to render as the actual Turkish letters.
    const content = 'Ğüşıöç Ğüşıöç Ğüşıöç: Rosatom\'un payı Türkiye\'nin egemenlik haklarını sınırlandırmaktadır.';
    const buf = await generateReportPdf({
      category: 'enerji', title: 'Test', content, userCode: 'BOLD-001', aiProvider: 'Test',
    });
    const text = await pdfText(buf);
    expect(text).toContain('Ğüşıöç');
    expect(text).toContain('Rosatom\'un payı Türkiye\'nin egemenlik haklarını sınırlandırmaktadır.');
  });

  it('produces a valid PDF buffer from markdown content', async () => {
    const content = `## YÖNETİCİ ÖZETİ
Bu bir test raporudur.

- Madde bir
- Madde iki

| Senaryo | Olasılık |
|---|---|
| A | %50 |
| B | %50 |
`;
    const buf = await generateReportPdf({
      category: 'ekonomi',
      title: 'Test Raporu',
      content,
      userCode: 'BOLD-001',
      aiProvider: 'Test Provider',
    });

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('produces a document without crashing even for empty content', async () => {
    const buf = await generateReportPdf({
      category: 'savunma',
      title: 'Empty Report',
      content: '',
      userCode: 'BOLD-002',
      aiProvider: 'Test',
    });
    expect(buf.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('renders #### as a real heading instead of literal hashes', async () => {
    const buf = await generateReportPdf({
      category: 'enerji', title: 'Test', content: '#### Aktörler ve Niyetler\nMetin.',
      userCode: 'BOLD-001', aiProvider: 'Test',
    });
    const text = await pdfText(buf);
    expect(text).not.toContain('####');
    expect(text).toContain('Aktörler ve Niyetler');
  });

  it('splitBoldSegments applies bold to the right segment, not just the right count', () => {
    // Regression test: filtering empty strings before mapping index parity
    // to bold status re-indexes the array and scrambles which segment is
    // bold. This must assert on the *specific* segment, not just presence.
    expect(splitBoldSegments('**Etiket:** açıklama')).toEqual([
      { text: 'Etiket:', bold: true },
      { text: ' açıklama', bold: false },
    ]);
    expect(splitBoldSegments('**Tümü kalın**')).toEqual([
      { text: 'Tümü kalın', bold: true },
    ]);
    expect(splitBoldSegments('normal metin')).toEqual([
      { text: 'normal metin', bold: false },
    ]);
  });

  it('strips ** markers from mid-line bold instead of showing literal asterisks', async () => {
    const buf = await generateReportPdf({
      category: 'enerji', title: 'Test', content: '**Rosatom:** uzun vadeli kaldıraç olarak kullanma niyeti.',
      userCode: 'BOLD-001', aiProvider: 'Test',
    });
    const text = await pdfText(buf);
    expect(text).not.toContain('**');
    expect(text).toContain('Rosatom:');
  });

  it('does not print a standalone --- divider as literal dashes', async () => {
    const buf = await generateReportPdf({
      category: 'enerji', title: 'Test', content: 'Birinci paragraf.\n---\nİkinci paragraf.',
      userCode: 'BOLD-001', aiProvider: 'Test',
    });
    const text = await pdfText(buf);
    expect(text).not.toMatch(/^-{3,}$/m);
  });

  it('strips ** markers inside table cells and bullets', async () => {
    const content = `| Senaryo | Olasılık |
|---|---|
| **SENARYO-A** | %50 |

- **Etiket:** açıklama
`;
    const buf = await generateReportPdf({
      category: 'enerji', title: 'Test', content, userCode: 'BOLD-001', aiProvider: 'Test',
    });
    const text = await pdfText(buf);
    expect(text).not.toContain('**');
    expect(text).toContain('SENARYO-A');
    expect(text).toContain('Etiket:');
  });
});
