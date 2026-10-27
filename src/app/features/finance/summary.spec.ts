import { MonthBudget, carryOver } from './allocate';
import { summarize } from './summary';
import { summarySheets, summaryTables } from './summary-export';

const OCTOBER: MonthBudget = {
  month: '2026-10',
  startBalance: 200,
  income: 3000,
  expenses: [
    { name: 'Miete', amountPerUnit: 1400, quantity: 1 },
    { name: 'Einkauf', amountPerUnit: 100, quantity: 4 },
  ],
  priorities: [
    { kind: 'debt', name: 'Kreditkarte', amount: 1500, desiredRate: 1000 },
    { kind: 'saving', name: 'Ferien', amount: 2000, desiredRate: 300 },
  ],
};
const NOVEMBER: MonthBudget = { ...carryOver(OCTOBER), income: 3000 };

describe('summarize', () => {
  it('sums up a single month like the month view', () => {
    const summary = summarize({ kind: 'month', month: '2026-10' }, [OCTOBER, NOVEMBER]);

    expect(summary.months.map((m) => m.month)).toEqual(['2026-10']);
    expect(summary.income).toBe(3000);
    expect(summary.plannedTotal).toBe(1800);
    expect(summary.debtTotal).toBe(1000);
    expect(summary.savingsTotal).toBe(300);
    expect(summary.endBalance).toBe(100);
    expect(summary.remainingDebt).toBe(500);
  });

  it('follows debts and savings across the months of a year', () => {
    const summary = summarize({ kind: 'year', year: 2026 }, [NOVEMBER, OCTOBER]);

    expect(summary.months.map((m) => m.month)).toEqual(['2026-10', '2026-11']);
    expect(summary.startBalance).toBe(200);
    expect(summary.income).toBe(6000);
    expect(summary.expenses).toEqual([
      { name: 'Miete', total: 2800, months: 2 },
      { name: 'Einkauf', total: 800, months: 2 },
    ]);
    // November: 100 + 3000 - 1800 = 1300 → Kreditkarte 500 (rest), Ferien 300
    expect(summary.priorities).toEqual([
      { kind: 'debt', name: 'Kreditkarte', startAmount: 1500, paid: 1500, remaining: 0 },
      { kind: 'saving', name: 'Ferien', startAmount: 2000, paid: 600, remaining: 1400 },
    ]);
    expect(summary.endBalance).toBe(500);
    expect(summary.remainingDebt).toBe(0);
  });

  it('reports months whose planned expenses are not covered and ignores other years', () => {
    const broke = { ...OCTOBER, month: '2026-12', startBalance: 0, income: 1000 };
    const summary = summarize({ kind: 'year', year: 2026 }, [broke, { ...OCTOBER, month: '2025-12' }]);
    expect(summary.months.length).toBe(1);
    expect(summary.uncoveredMonths).toEqual(['2026-12']);
  });

  it('is empty when no month is saved', () => {
    const summary = summarize({ kind: 'month', month: '2027-01' }, [OCTOBER]);
    expect(summary.months).toEqual([]);
    expect(summary.endBalance).toBe(0);
  });
});

describe('summary export', () => {
  it('adds a month table only to the year summary', () => {
    expect(summaryTables(summarize({ kind: 'month', month: '2026-10' }, [OCTOBER])).map((t) => t.title)).toEqual([
      'Übersicht',
      'Ausgaben',
      'Schulden & Sparen',
    ]);
    expect(summaryTables(summarize({ kind: 'year', year: 2026 }, [OCTOBER])).map((t) => t.title)).toContain('Monate');
  });

  it('puts plan and visibility on the first sheet', () => {
    const sheets = summarySheets(summarize({ kind: 'year', year: 2026 }, [OCTOBER, NOVEMBER]), {
      planName: 'Wir',
      visibility: 'Haushalt „Wir zwei“',
    });
    expect(sheets[0].rows.slice(0, 2)).toEqual([
      ['Plan', 'Wir'],
      ['Sichtbar für', 'Haushalt „Wir zwei“'],
    ]);
    expect(sheets[1].rows.at(-1)).toEqual(['Total', null, 6000, 3600, 1500, 600, null]);
  });
});
