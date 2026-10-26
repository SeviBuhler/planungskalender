import { MonthBudget, allocate, carryOver, nextMonth } from './allocate';

const BUDGET: MonthBudget = {
  month: '2026-11',
  startBalance: 200,
  income: 3000,
  expenses: [
    { name: 'Miete', amountPerUnit: 1000, quantity: 1 },
    { name: 'Einkauf', amountPerUnit: 100, quantity: 4 },
  ],
  debts: [
    { name: 'Rechnung', open: 500 },
    { name: 'Kreditkarte', open: 1500 },
    { name: 'Privat', open: 300 },
  ],
  savings: [
    { name: 'Handy', target: 600, desiredRate: 100 },
    { name: 'Computer', target: 2000, desiredRate: 200 },
  ],
};

describe('allocate', () => {
  it('covers planned expenses first, then pays debts in order', () => {
    const result = allocate(BUDGET);

    expect(result.totalAvailable).toBe(3200);
    expect(result.plannedTotal).toBe(1400);
    expect(result.availableForDebtsAndSavings).toBe(1800);
    expect(result.debts.map((d) => d.payment)).toEqual([500, 1300, 0]);
    expect(result.savings.map((s) => s.rate)).toEqual([0, 0]);
    expect(result.endBalance).toBe(0);
    expect(result.remainingDebt).toBe(500);
    expect(result.plannedCovered).toBe(true);
  });

  it('gives savings the desired rate once all debts are paid', () => {
    const result = allocate({ ...BUDGET, debts: [{ name: 'Privat', open: 300 }] });

    expect(result.debtTotal).toBe(300);
    expect(result.savings.map((s) => s.rate)).toEqual([100, 200]);
    expect(result.endBalance).toBe(1800 - 300 - 300);
  });

  it('pays nothing extra when planned expenses are not covered', () => {
    const result = allocate({ ...BUDGET, income: 1000 });

    expect(result.plannedCovered).toBe(false);
    expect(result.debtTotal).toBe(0);
    expect(result.savingsTotal).toBe(0);
    expect(result.endBalance).toBe(1200 - 1400);
  });

  it('never saves more than the remaining target', () => {
    const result = allocate({
      ...BUDGET,
      debts: [],
      savings: [{ name: 'Handy', target: 50, desiredRate: 100 }],
    });

    expect(result.savings[0]).toEqual({ name: 'Handy', target: 50, rate: 50, remaining: 0 });
  });
});

describe('carryOver', () => {
  it('starts the next month from the remaining balance and open amounts', () => {
    const next = carryOver(BUDGET);

    expect(next.month).toBe('2026-12');
    expect(next.startBalance).toBe(0);
    expect(next.income).toBe(0);
    expect(next.debts).toEqual([
      { name: 'Kreditkarte', open: 200 },
      { name: 'Privat', open: 300 },
    ]);
    expect(next.savings.map((s) => s.target)).toEqual([600, 2000]);
    expect(next.expenses).not.toBe(BUDGET.expenses);
  });

  it('rolls over the year', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
  });
});
