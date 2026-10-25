import { MonthBudget, NOVEMBER_2026, allocate, carryOver, nextMonth } from './allocate';

describe('allocate', () => {
  it('matches the numbers of the "Budget November" sheet', () => {
    const result = allocate(NOVEMBER_2026);

    expect(result.totalAvailable).toBe(3389);
    expect(result.plannedTotal).toBe(2405);
    expect(result.availableForDebtsAndSavings).toBe(984);
    expect(result.debts.map((d) => d.payment)).toEqual([360, 624, 0]);
    expect(result.savings.map((s) => s.rate)).toEqual([0, 0]);
    expect(result.endBalance).toBe(0);
    expect(result.remainingDebt).toBe(1849);
    expect(result.plannedCovered).toBe(true);
  });

  it('gives savings the desired rate once all debts are paid', () => {
    const budget: MonthBudget = {
      ...NOVEMBER_2026,
      debts: [{ name: 'Dana', open: 400 }],
    };
    const result = allocate(budget);

    expect(result.debtTotal).toBe(400);
    expect(result.savings.map((s) => s.rate)).toEqual([100, 200]);
    expect(result.endBalance).toBe(984 - 400 - 300);
  });

  it('pays nothing extra when planned expenses are not covered', () => {
    const result = allocate({ ...NOVEMBER_2026, income: 1000 });

    expect(result.plannedCovered).toBe(false);
    expect(result.debtTotal).toBe(0);
    expect(result.savingsTotal).toBe(0);
    expect(result.endBalance).toBe(1110 - 2405);
  });

  it('never saves more than the remaining target', () => {
    const result = allocate({
      ...NOVEMBER_2026,
      debts: [],
      savings: [{ name: 'Handy', target: 50, desiredRate: 100 }],
    });

    expect(result.savings[0]).toEqual({ name: 'Handy', target: 50, rate: 50, remaining: 0 });
  });
});

describe('carryOver', () => {
  it('starts the next month from the remaining balance and open amounts', () => {
    const december = carryOver(NOVEMBER_2026);

    expect(december.month).toBe('2026-12');
    expect(december.startBalance).toBe(0);
    expect(december.income).toBe(0);
    expect(december.debts).toEqual([
      { name: 'Kreditkarte', open: 1449 },
      { name: 'Dana', open: 400 },
    ]);
    expect(december.savings.map((s) => s.target)).toEqual([600, 4000]);
    expect(december.expenses).not.toBe(NOVEMBER_2026.expenses);
  });

  it('rolls over the year', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
  });
});
