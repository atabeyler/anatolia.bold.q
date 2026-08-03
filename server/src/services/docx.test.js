import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateReportDocx } from './docx.js';

async function documentXml(buf) {
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml').async('string');
}

// Extracts [{ text, bold }] per <w:r> run, in document order, so a test can
// assert bold is on the *specific* run it belongs to -- not just that a
// <w:b/> exists somewhere earlier in the XML (a loose match like that let a
// real bug -- bold applied to the wrong split segment -- pass unnoticed).
function runs(xml) {
  const matches = [...xml.matchAll(/<w:r>(?:(?!<w:r>).)*?<\/w:r>/gs)];
  return matches.map((m) => {
    const chunk = m[0];
    const text = [...chunk.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/gs)].map((t) => t[1]).join('');
    return { text, bold: /<w:b\/>/.test(chunk) };
  });
}

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

  it('renders #### as a real heading instead of literal hashes', async () => {
    const buf = await generateReportDocx({
      category: 'enerji', title: 'Test', content: '#### Aktörler ve Niyetler\nMetin.',
      userCode: 'BOLD-001', aiProvider: 'Test',
    });
    const xml = await documentXml(buf);
    expect(xml).not.toContain('####');
    expect(xml).toContain('Aktörler ve Niyetler');
  });

  it('renders mid-line **bold** as an actual bold run, not literal asterisks', async () => {
    const buf = await generateReportDocx({
      category: 'enerji', title: 'Test', content: '**Rosatom:** uzun vadeli kaldıraç olarak kullanma niyeti.',
      userCode: 'BOLD-001', aiProvider: 'Test',
    });
    const xml = await documentXml(buf);
    expect(xml).not.toContain('**');
    const bodyRuns = runs(xml).filter((r) => r.text.includes('Rosatom') || r.text.includes('uzun vadeli'));
    expect(bodyRuns.find((r) => r.text === 'Rosatom:')?.bold).toBe(true);
    expect(bodyRuns.find((r) => r.text.includes('uzun vadeli'))?.bold).toBe(false);
  });

  it('renders a standalone --- divider as a rule instead of literal dashes', async () => {
    const buf = await generateReportDocx({
      category: 'enerji', title: 'Test', content: 'Birinci paragraf.\n---\nİkinci paragraf.',
      userCode: 'BOLD-001', aiProvider: 'Test',
    });
    const xml = await documentXml(buf);
    expect(xml).not.toMatch(/<w:t[^>]*>-{3,}<\/w:t>/);
  });

  it('strips ** markers inside table cells and bullets, applying bold to the right run', async () => {
    const content = `| Senaryo | Olasılık |
|---|---|
| **SENARYO-A** | %50 |

- **Etiket:** açıklama
`;
    const buf = await generateReportDocx({
      category: 'enerji', title: 'Test', content, userCode: 'BOLD-001', aiProvider: 'Test',
    });
    const xml = await documentXml(buf);
    expect(xml).not.toContain('**');
    const allRuns = runs(xml);
    expect(allRuns.find((r) => r.text === 'SENARYO-A')?.bold).toBe(true);
    expect(allRuns.find((r) => r.text === 'Etiket:')?.bold).toBe(true);
    expect(allRuns.find((r) => r.text.includes('açıklama'))?.bold).toBe(false);
  });
});
