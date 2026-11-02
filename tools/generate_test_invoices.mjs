#!/usr/bin/env node
// Dependency-free generator for invoice desk upload and reconciliation examples.
// Run from the repository root: node tools/generate_test_invoices.mjs [output-dir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(process.argv[2] || path.join(root, 'output', 'test-invoices'));
const PAGE_W = 595;
const PAGE_H = 842;
const palette = { ink: '#30251e', muted: '#786c60', orange: '#e96b20', line: '#e8e0d6', pale: '#faf7f2', warn: '#fff2e1' };

const cases = [
  {
    file: '01-correct-consulting-invoice.pdf', label: 'Correct - consulting services', number: 'AC-2026-1101',
    supplier: 'Acme Office Systems Pvt. Ltd.', gstin: '29ABCDE1234F1Z5', date: '02 Nov 2026', due: '16 Nov 2026',
    lines: [
      { description: 'Finance workspace setup', quantity: 1, rate: 10000, amount: 10000 },
      { description: 'Monthly accounting support', quantity: 2, rate: 2500, amount: 5000 },
    ], subtotal: 15000, tax: 2700, total: 17700, taxLabel: 'IGST (18%)', handwriting: false,
    expected: 'PASS: line items, subtotal, tax, and total reconcile.',
  },
  {
    file: '02-correct-equipment-invoice.pdf', label: 'Correct - equipment purchase', number: 'NS-2026-2048',
    supplier: 'Northstar Business Supplies', gstin: '27AABCN4821K1Z7', date: '03 Nov 2026', due: '03 Dec 2026',
    lines: [
      { description: 'Document scanner', quantity: 2, rate: 12500, amount: 25000 },
      { description: 'Network printer', quantity: 1, rate: 14000, amount: 14000 },
      { description: 'Installation and setup', quantity: 1, rate: 3000, amount: 3000 },
    ], subtotal: 42000, tax: 7560, total: 49560, taxLabel: 'IGST (18%)', handwriting: false,
    expected: 'PASS: line items, subtotal, tax, and total reconcile.',
  },
  {
    file: '03-error-line-extension.pdf', label: 'Intentional error - line extension', number: 'AC-2026-1103',
    supplier: 'Acme Office Systems Pvt. Ltd.', gstin: '29ABCDE1234F1Z5', date: '04 Nov 2026', due: '18 Nov 2026',
    lines: [
      { description: 'Annual software license', quantity: 2, rate: 5000, amount: 10000 },
      { description: 'Onboarding session', quantity: 3, rate: 1500, amount: 4000 },
    ], subtotal: 14000, tax: 2520, total: 16520, taxLabel: 'IGST (18%)', handwriting: false,
    expected: 'FAIL: onboarding line shows 4000, but quantity x rate is 4500.',
  },
  {
    file: '04-error-subtotal.pdf', label: 'Intentional error - subtotal', number: 'NS-2026-2050',
    supplier: 'Northstar Business Supplies', gstin: '27AABCN4821K1Z7', date: '05 Nov 2026', due: '19 Nov 2026',
    lines: [
      { description: 'Office chairs', quantity: 4, rate: 2000, amount: 8000 },
      { description: 'Desk lamps', quantity: 2, rate: 1200, amount: 2400 },
    ], subtotal: 11400, tax: 2052, total: 13452, taxLabel: 'IGST (18%)', handwriting: false,
    expected: 'FAIL: listed line items total 10400, but the printed subtotal is 11400.',
  },
  {
    file: '05-error-invoice-total.pdf', label: 'Intentional error - invoice total', number: 'AC-2026-1105',
    supplier: 'Acme Office Systems Pvt. Ltd.', gstin: '29ABCDE1234F1Z5', date: '06 Nov 2026', due: '20 Nov 2026',
    lines: [
      { description: 'Data migration service', quantity: 1, rate: 18000, amount: 18000 },
      { description: 'Compliance review', quantity: 1, rate: 6000, amount: 6000 },
    ], subtotal: 24000, tax: 4320, total: 27320, taxLabel: 'IGST (18%)', handwriting: false,
    expected: 'FAIL: subtotal plus tax is 28320, but the printed invoice total is 27320.',
  },
  {
    file: '06-handwritten-style-invoice.pdf', label: 'Handwritten style - simulated', number: 'HM-2026-006',
    supplier: 'Harbor Market Services', gstin: '29AAHCH9123R1Z2', date: '07 Nov 2026', due: '21 Nov 2026',
    lines: [
      { description: 'Monthly bookkeeping', quantity: 1, rate: 7600, amount: 7600 },
      { description: 'Receipt reconciliation', quantity: 2, rate: 1200, amount: 2400 },
    ], subtotal: 10000, tax: 1800, total: 12800, taxLabel: 'IGST (18%)', handwriting: true,
    expected: 'FAIL: handwritten-style total is 12800; subtotal plus tax is 11800.',
  },
];

function pdfEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function rgb(hex) {
  const value = hex.slice(1);
  return [0, 2, 4].map(i => (parseInt(value.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
}

function buildPage(invoice) {
  const ops = [];
  const rect = (x, top, width, height, fill) => ops.push(`${rgb(fill)} rg ${x} ${PAGE_H - top - height} ${width} ${height} re f`);
  const rule = (x1, top1, x2, top2, color = palette.line, width = 1) => ops.push(`${rgb(color)} RG ${width} w ${x1} ${PAGE_H - top1} m ${x2} ${PAGE_H - top2} l S`);
  const text = (x, top, value, size = 10, color = palette.ink, font = 'F1', angle = 0) => {
    const radians = angle * Math.PI / 180;
    const a = Math.cos(radians).toFixed(4), b = Math.sin(radians).toFixed(4);
    const y = PAGE_H - top - size;
    ops.push(`BT /${font} ${size} Tf ${rgb(color)} rg ${a} ${b} ${(-Math.sin(radians)).toFixed(4)} ${a} ${x} ${y} Tm (${pdfEscape(value)}) Tj ET`);
  };

  rect(0, 0, PAGE_W, PAGE_H, '#ffffff');
  rect(0, 0, PAGE_W, 12, palette.orange);
  if (invoice.handwriting) rect(42, 30, 511, 22, palette.warn);
  text(48, 39, invoice.handwriting ? 'HARBOR MARKET' : invoice.supplier.split(' ')[0].toUpperCase(), 21, palette.ink, invoice.handwriting ? 'F3' : 'F2', invoice.handwriting ? -1.1 : 0);
  text(49, 66, invoice.supplier.toUpperCase(), 8, palette.muted, invoice.handwriting ? 'F3' : 'F2', invoice.handwriting ? 0.6 : 0);
  text(49, 94, `GSTIN ${invoice.gstin}`, 9, palette.muted, invoice.handwriting ? 'F3' : 'F1', invoice.handwriting ? -0.5 : 0);
  text(49, 111, 'Bengaluru, Karnataka 560001', 9, palette.muted, invoice.handwriting ? 'F3' : 'F1', invoice.handwriting ? 0.7 : 0);
  text(49, 128, 'accounts@example.test  |  +91 80 5550 0100', 9, palette.muted, invoice.handwriting ? 'F3' : 'F1', invoice.handwriting ? -0.4 : 0);
  text(407, 42, invoice.handwriting ? 'INVOICE' : 'TAX INVOICE', 17, palette.ink, 'F2');
  text(407, 70, 'INVOICE NO.', 8, palette.muted, 'F2');
  text(407, 84, invoice.number, 10, palette.ink, invoice.handwriting ? 'F3' : 'F2', invoice.handwriting ? 0.8 : 0);
  text(407, 107, 'ISSUE DATE', 8, palette.muted, 'F2');
  text(407, 121, invoice.date, 9, palette.ink, invoice.handwriting ? 'F3' : 'F1', invoice.handwriting ? -0.7 : 0);
  text(407, 145, 'DUE DATE', 8, palette.muted, 'F2');
  text(407, 159, invoice.due, 9, palette.ink, invoice.handwriting ? 'F3' : 'F1', invoice.handwriting ? 0.5 : 0);
  rule(48, 189, 547, 189);
  rect(48, 210, 499, 82, palette.pale);
  text(63, 226, 'BILL TO', 8, palette.orange, 'F2');
  text(63, 244, 'TechJays Accounting CRM', 11, palette.ink, 'F2');
  text(63, 263, 'GSTIN 29AAACT1234B1ZQ', 9, palette.muted);
  text(63, 278, 'Bengaluru, Karnataka, India', 9, palette.muted);
  text(48, 318, invoice.handwriting ? 'ITEMS / PLEASE CHECK TOTALS' : 'INVOICE DETAILS', 8, palette.orange, 'F2');
  rect(48, 338, 499, 30, palette.ink);
  text(61, 348, 'DESCRIPTION', 8, '#fff7eb', 'F2');
  text(352, 348, 'QTY', 8, '#fff7eb', 'F2');
  text(400, 348, 'UNIT PRICE', 8, '#fff7eb', 'F2');
  text(490, 348, 'AMOUNT', 8, '#fff7eb', 'F2');
  let rowTop = 382;
  invoice.lines.forEach((item, index) => {
    if (index % 2 === 1) rect(48, rowTop - 4, 499, 36, '#fcfaf7');
    const face = invoice.handwriting ? 'F3' : 'F1';
    const jitter = invoice.handwriting ? (index % 2 ? 0.6 : -0.6) : 0;
    text(61, rowTop + jitter, item.description, 9, palette.ink, face, invoice.handwriting ? (index % 2 ? 0.8 : -0.5) : 0);
    text(355, rowTop + jitter, String(item.quantity), 9, palette.ink, face, invoice.handwriting ? -0.4 : 0);
    text(400, rowTop + jitter, item.rate.toLocaleString('en-US', { minimumFractionDigits: 2 }), 9, palette.ink, face, invoice.handwriting ? 0.5 : 0);
    text(489, rowTop + jitter, item.amount.toLocaleString('en-US', { minimumFractionDigits: 2 }), 9, palette.ink, face, invoice.handwriting ? -0.6 : 0);
    rule(48, rowTop + 26, 547, rowTop + 26, palette.line, 0.7);
    rowTop += 42;
  });

  const totalsTop = Math.max(rowTop + 28, 505);
  const face = invoice.handwriting ? 'F3' : 'F1';
  const jitter = invoice.handwriting ? -0.5 : 0;
  text(358, totalsTop, 'Subtotal', 9, palette.muted, face, invoice.handwriting ? 0.5 : 0);
  text(474, totalsTop, `INR ${invoice.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 9, palette.ink, invoice.handwriting ? 'F3' : 'F2', jitter);
  text(358, totalsTop + 24, invoice.taxLabel, 9, palette.muted, face, invoice.handwriting ? -0.4 : 0);
  text(474, totalsTop + 24, `INR ${invoice.tax.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 9, palette.ink, invoice.handwriting ? 'F3' : 'F2', -jitter);
  rule(358, totalsTop + 48, 547, totalsTop + 48, '#d9cfc2');
  text(358, totalsTop + 62, 'TOTAL DUE', 9, palette.ink, 'F2', jitter);
  text(444, totalsTop + 59, `INR ${invoice.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 13, palette.orange, 'F2', invoice.handwriting ? 0.7 : 0);
  if (invoice.handwriting) {
    // Pen-like wavy underline and handwritten note make the example visually distinct.
    ops.push(`${rgb('#25201b')} RG 1.5 w 450 ${PAGE_H - totalsTop - 81} m 463 ${PAGE_H - totalsTop - 78} 480 ${PAGE_H - totalsTop - 83} 498 ${PAGE_H - totalsTop - 80} c S`);
    text(49, totalsTop + 77, 'Thanks! - Harbor Market', 10, '#38302b', 'F3', -1.0);
  }
  const noteTop = Math.min(totalsTop + 117, 728);
  rect(48, noteTop, 499, 66, invoice.handwriting ? '#fffaf0' : palette.pale);
  text(63, noteTop + 14, invoice.handwriting ? 'NOTE' : 'PAYMENT TERMS', 8, palette.orange, 'F2');
  text(63, noteTop + 32, invoice.handwriting ? 'Please check amount before payment.' : 'Payment due within 14 days of invoice date.', 9, palette.muted, invoice.handwriting ? 'F3' : 'F1', invoice.handwriting ? -0.5 : 0);
  text(63, noteTop + 48, `Please include invoice ${invoice.number} with payment.`, 8, palette.muted, invoice.handwriting ? 'F3' : 'F1', invoice.handwriting ? 0.4 : 0);
  rule(48, 792, 547, 792);
  text(48, 808, 'SAMPLE DOCUMENT FOR LOCAL INVOICE REVIEW TESTING', 7, palette.muted, 'F2');
  text(477, 808, 'PAGE 1 OF 1', 7, palette.muted, 'F2');
  return ops.join('\n') + '\n';
}

function writePdf(invoice, outputPath) {
  const content = buildPage(invoice);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
  ];
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index++) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  fs.writeFileSync(outputPath, Buffer.from(pdf, 'latin1'));
}

fs.mkdirSync(outputDir, { recursive: true });
for (const invoice of cases) writePdf(invoice, path.join(outputDir, invoice.file));
const manifest = cases.map(({ file, label, number, subtotal, tax, total, expected }) => ({
  file, label, invoice_number: number, subtotal, tax, printed_total: total,
  calculated_total: subtotal + tax, expected_result: expected,
}));
fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Generated ${cases.length} invoice PDFs in ${outputDir}`);
for (const invoice of cases) console.log(`- ${invoice.file}`);
