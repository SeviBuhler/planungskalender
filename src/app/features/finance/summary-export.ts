// Turns a summary into tables and writes them as Excel or PDF, entirely in the browser

import { Summary, monthName, periodLabel } from './summary';
import { Cell, Sheet, xlsx } from './xlsx';

export interface ExportInfo {
  planName: string;
  visibility: string; // "Privat" or "Haushalt „…“"
}

interface Table {
  title: string;
  head: string[];
  body: Cell[][];
  foot?: Cell[];
  widths: number[];
  counts?: number[]; // number columns that are counts, not CHF
}

const kindLabel = (kind: string) => (kind === 'debt' ? 'Schuld' : 'Sparen');

export function summaryTables(summary: Summary): Table[] {
  const tables: Table[] = [
    {
      title: 'Übersicht',
      head: ['', 'CHF'],
      body: [
        ['Startguthaben', summary.startBalance],
        ['Einnahmen', summary.income],
        ['Ausgaben', -summary.plannedTotal],
        ['Schuldenzahlungen', -summary.debtTotal],
        ['Sparraten', -summary.savingsTotal],
      ],
      foot: ['Kontostand Ende', summary.endBalance],
      widths: [28, 16],
    },
  ];
  if (summary.period.kind === 'year') {
    tables.push({
      title: 'Monate',
      head: ['Monat', 'Start', 'Einnahmen', 'Ausgaben', 'Schulden', 'Sparen', 'Ende'],
      body: summary.months.map((m) => [monthName(m.month), m.startBalance, m.income, m.plannedTotal, m.debtTotal, m.savingsTotal, m.endBalance]),
      foot: ['Total', null, summary.income, summary.plannedTotal, summary.debtTotal, summary.savingsTotal, null],
      widths: [14, 12, 12, 12, 12, 12, 12],
    });
  }
  tables.push(
    {
      title: 'Ausgaben',
      head: summary.period.kind === 'year' ? ['Position', 'Monate', 'Total CHF'] : ['Position', '', 'Total CHF'],
      body: summary.expenses.map((e) => [e.name, summary.period.kind === 'year' ? e.months : null, e.total]),
      foot: ['Total', null, summary.plannedTotal],
      widths: [28, 10, 14],
      counts: [1],
    },
    {
      title: 'Schulden & Sparen',
      head: ['Art', 'Position', 'Anfang', 'Bezahlt', 'Rest'],
      body: summary.priorities.map((p) => [kindLabel(p.kind), p.name, p.startAmount, p.paid, p.remaining]),
      foot: ['Total', null, null, summary.debtTotal + summary.savingsTotal, null],
      widths: [10, 26, 14, 14, 14],
    }
  );
  return tables;
}

function infoRows(summary: Summary, info: ExportInfo): Cell[][] {
  return [
    ['Plan', info.planName],
    ['Sichtbar für', info.visibility],
    ['Zeitraum', periodLabel(summary.period)],
    ['Monate mit Daten', summary.months.map((m) => monthName(m.month)).join(', ') || 'keine'],
    ['Erstellt', new Date().toLocaleDateString('de-CH')],
  ];
}

export function fileName(summary: Summary, info: ExportInfo, extension: string): string {
  const period = summary.period.kind === 'year' ? String(summary.period.year) : summary.period.month;
  const plan = info.planName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'Plan';
  return `ForTwo_${plan}_${period}.${extension}`;
}

export function summarySheets(summary: Summary, info: ExportInfo): Sheet[] {
  return summaryTables(summary).map((table, i) => {
    const intro = i === 0 ? [...infoRows(summary, info), []] : [];
    const rows: Cell[][] = [...intro, table.head, ...table.body, ...(table.foot ? [table.foot] : [])];
    const boldRows = [intro.length, ...(table.foot ? [rows.length - 1] : [])];
    return { name: table.title, columns: table.widths, rows, boldRows };
  });
}

export function summaryXlsx(summary: Summary, info: ExportInfo): Blob {
  return new Blob([xlsx(summarySheets(summary, info)) as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

const chf = (value: number) => value.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/’/g, "'");

// Number columns right-aligned as CHF (counts without decimals), text left
function pdfRow(row: Cell[], table: Table) {
  const numeric = (i: number) => [...table.body, table.foot ?? []].some((r) => typeof r[i] === 'number');
  return row.map((value, i) => ({
    content: typeof value === 'number' ? (table.counts?.includes(i) ? String(value) : chf(value)) : (value ?? ''),
    styles: { halign: numeric(i) ? ('right' as const) : ('left' as const) },
  }));
}

// jsPDF is only loaded when someone actually exports a PDF
export async function summaryPdf(summary: Summary, info: ExportInfo): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const violet: [number, number, number] = [112, 64, 232];

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(37, 19, 77);
  doc.text(`Finanzen ${periodLabel(summary.period)}`, 14, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  infoRows(summary, info).forEach(([label, value], i) => doc.text(`${label}: ${value}`, 14, 26 + i * 5));

  let y = 26 + 5 * 5 + 4;
  for (const table of summaryTables(summary)) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(table.title, 14, y);
    autoTable(doc, {
      startY: y + 2,
      head: [pdfRow(table.head, table)],
      body: table.body.map((row) => pdfRow(row, table)),
      foot: table.foot ? [pdfRow(table.foot, table)] : undefined,
      theme: 'striped',
      styles: { fontSize: 9 },
      headStyles: { fillColor: violet },
      footStyles: { fillColor: [246, 242, 255], textColor: [37, 19, 77] },
      showFoot: 'lastPage',
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    if (y > 270) {
      doc.addPage();
      y = 18;
    }
  }
  return doc.output('blob');
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
