import PDFDocument from 'pdfkit';

const COLORS = {
  gold: '#D4AF37',
  black: '#000000',
  red: '#C8102E',
  darkBlue: '#1A2244',
  gray: '#666666',
};

const FONT = 'Times-Roman';
const FONT_BOLD = 'Times-Bold';
const FONT_ITALIC = 'Times-Italic';
const CODE_FONT = 'Courier';

function drawCoverPage(doc, { category, title, userCode, aiProvider }) {
  const dateStr = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
  const docNo = `ANATOLIA-Q/${category.toUpperCase()}-${Date.now().toString().slice(-6)}`;

  doc.moveDown(4);
  doc.font(FONT_BOLD).fontSize(16).fillColor(COLORS.red).text('GİZLİ', { align: 'center' });
  doc.moveDown(1);
  doc.font(FONT_BOLD).fontSize(15).fillColor(COLORS.black).text('BOLD ASKERİ TEKNOLOJİ VE SAVUNMA SANAYİ A.Ş.', { align: 'center' });
  doc.moveDown(0.5);
  doc.font(FONT_ITALIC).fontSize(12).text('Stratejik Analiz ve Politika Geliştirme Birimi', { align: 'center' });
  doc.moveDown(3);
  doc.font(FONT_BOLD).fontSize(28).fillColor(COLORS.darkBlue).text('ANATOLIA-Q', { align: 'center' });
  doc.moveDown(0.5);
  doc.font(FONT_ITALIC).fontSize(13).fillColor(COLORS.black).text('Kuantum Tabanlı Ulusal Karar Destek Sistemi', { align: 'center' });
  doc.moveDown(2);
  doc.font(FONT_BOLD).fontSize(18).fillColor(COLORS.darkBlue).text(title.toUpperCase(), { align: 'center' });
  doc.moveDown(1);
  doc.font(FONT_ITALIC).fontSize(12).fillColor(COLORS.black).text(`Kategori: ${category.toUpperCase()}`, { align: 'center' });
  doc.moveDown(3);

  const info = [
    ['Belge No', docNo],
    ['Tarih', dateStr],
    ['Hazırlayan', `ANATOLIA-Q (${aiProvider})`],
    ['Kullanıcı', userCode],
    ['Sınıflandırma', 'GİZLİLİK DERECESİ: GİZLİ'],
    ['Versiyon', 'v1.0'],
  ];
  const startX = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = tableWidth / 2;
  let y = doc.y;
  for (const [label, value] of info) {
    doc.font(FONT_BOLD).fontSize(10).fillColor(COLORS.black).text(label, startX, y, { width: colWidth });
    doc.font(FONT).fontSize(10).text(value, startX + colWidth, y, { width: colWidth });
    y = doc.y + 4;
  }

  doc.addPage();
}

function drawTable(doc, headers, rows) {
  const startX = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = tableWidth / headers.length;
  const rowPad = 6;

  const rowHeight = (cells) => {
    let max = 0;
    for (let i = 0; i < cells.length; i++) {
      const h = doc.heightOfString(String(cells[i] ?? ''), { width: colWidth - rowPad * 2 });
      if (h > max) max = h;
    }
    return max + rowPad * 2;
  };

  const drawRow = (cells, opts = {}) => {
    const h = rowHeight(cells);
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    if (opts.header) {
      doc.rect(startX, y, tableWidth, h).fill(COLORS.darkBlue);
    }
    doc.font(opts.header ? FONT_BOLD : FONT).fontSize(9).fillColor(opts.header ? '#FFFFFF' : COLORS.black);
    for (let i = 0; i < cells.length; i++) {
      doc.text(String(cells[i] ?? ''), startX + i * colWidth + rowPad, y + rowPad, { width: colWidth - rowPad * 2 });
    }
    doc.y = y + h;
    doc.moveTo(startX, doc.y).lineTo(startX + tableWidth, doc.y).strokeColor(COLORS.gray).lineWidth(0.5).stroke();
  };

  drawRow(headers, { header: true });
  for (const row of rows) drawRow(row);
  doc.moveDown(0.6);
}

function parseAndDraw(doc, md) {
  const lines = md.split('\n');
  let i = 0;

  const ensureSpace = (minHeight = 20) => {
    if (doc.y + minHeight > doc.page.height - doc.page.margins.bottom) doc.addPage();
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      i++;
      ensureSpace();
      doc.font(CODE_FONT).fontSize(8).fillColor(COLORS.black);
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        ensureSpace(12);
        doc.text(lines[i].length ? lines[i] : ' ', { width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
        i++;
      }
      i++;
      doc.moveDown(0.5);
      continue;
    }

    if (line.trim().startsWith('|') && i + 1 < lines.length && lines[i + 1].includes('---')) {
      const headers = line.split('|').map((s) => s.trim()).filter(Boolean);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].split('|').map((s) => s.trim()).filter(Boolean);
        if (cells.length) rows.push(cells);
        i++;
      }
      ensureSpace(40);
      drawTable(doc, headers, rows);
      continue;
    }

    ensureSpace();
    if (line.startsWith('### ')) {
      doc.font(FONT_ITALIC).fontSize(12).fillColor(COLORS.black).text(line.slice(4).trim());
      doc.moveDown(0.3);
    } else if (line.startsWith('## ')) {
      doc.moveDown(0.4);
      doc.font(FONT_BOLD).fontSize(13).fillColor(COLORS.darkBlue).text(line.slice(3).trim());
      doc.moveDown(0.3);
    } else if (line.startsWith('# ')) {
      doc.moveDown(0.5);
      doc.font(FONT_BOLD).fontSize(15).fillColor(COLORS.darkBlue).text(line.slice(2).trim().toUpperCase());
      doc.moveDown(0.4);
    } else if (line.match(/^[-*]\s+/)) {
      doc.font(FONT).fontSize(10).fillColor(COLORS.black).text(`•  ${line.replace(/^[-*]\s+/, '')}`, { indent: 12 });
    } else if (line.match(/^\d+\.\s+/)) {
      doc.font(FONT).fontSize(10).fillColor(COLORS.black).text(`•  ${line.replace(/^\d+\.\s+/, '')}`, { indent: 12 });
    } else if (line.trim()) {
      const bold = line.startsWith('**') && line.endsWith('**');
      const text = line.replace(/\*\*(.+?)\*\*/g, '$1');
      doc.font(bold ? FONT_BOLD : FONT).fontSize(10.5).fillColor(COLORS.black).text(text, { align: 'justify' });
    } else {
      doc.moveDown(0.4);
    }
    i++;
  }
}

export async function generateReportPdf({ category, title, content, userCode, aiProvider }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 }, bufferPages: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      drawCoverPage(doc, { category, title, userCode, aiProvider });
      parseAndDraw(doc, content);

      const range = doc.bufferedPageRange();
      for (let idx = range.start; idx < range.start + range.count; idx++) {
        doc.switchToPage(idx);
        doc.font(FONT).fontSize(8).fillColor(COLORS.gray).text(
          `Bold Askeri Teknoloji ve Savunma Sanayi A.Ş.  |  ${new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}  |  Sayfa ${idx - range.start + 1}/${range.count}`,
          doc.page.margins.left,
          doc.page.height - doc.page.margins.bottom + 20,
          { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
