import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Finance } from './finance';
import { BudgetStore, FinancePlan } from '../../features/finance/budget-store';
import { Household, HouseholdStore } from '../../features/households/household-store';
import { MonthBudget } from '../../features/finance/allocate';

const ME = 'user-a';

// In-memory stand-ins for the Supabase tables
class FakeHouseholdStore {
  households: Household[] = [];
  async list() { return [...this.households]; }
}

class FakeBudgetStore {
  plans: FinancePlan[] = [];
  rows = new Map<string, MonthBudget>();
  private nextId = 1;

  async userId() { return ME; }
  async listPlans() { return [...this.plans]; }
  async createPlan(name: string, householdId: string | null) {
    const plan = { id: `p${this.nextId++}`, name, ownerId: ME, householdId };
    this.plans.push(plan);
    return plan;
  }
  async updatePlan(id: string, changes: { name?: string; householdId?: string | null }) {
    this.plans = this.plans.map((p) => (p.id === id ? { ...p, ...changes } : p));
  }
  async deletePlan(id: string) { this.plans = this.plans.filter((p) => p.id !== id); }
  async latestMonth(planId: string) {
    const months = [...this.rows.keys()].filter((k) => k.startsWith(planId + '/')).map((k) => k.split('/')[1]).sort();
    return months.at(-1) ?? null;
  }
  async load(planId: string, month: string) { return this.rows.get(`${planId}/${month}`) ?? null; }
  async loadRange(planId: string, from: string, to: string) {
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith(planId + '/') && key.split('/')[1] >= from && key.split('/')[1] <= to)
      .map(([, budget]) => budget);
  }
  async save(planId: string, budget: MonthBudget) { this.rows.set(`${planId}/${budget.month}`, structuredClone(budget)); }
}

const BUDGET: MonthBudget = {
  month: '2026-10',
  startBalance: 200,
  income: 3000,
  expenses: [{ name: 'Miete', amountPerUnit: 1400, quantity: 1 }],
  priorities: [
    { kind: 'debt', name: 'Rechnung', amount: 500, desiredRate: null },
    { kind: 'debt', name: 'Kreditkarte', amount: 1500, desiredRate: null },
  ],
};

describe('Finance', () => {
  let store: FakeBudgetStore;
  let households: FakeHouseholdStore;
  let fixture: ComponentFixture<Finance>;
  let component: Finance;

  async function create() {
    await TestBed.configureTestingModule({
      imports: [Finance],
      providers: [
        provideRouter([]),
        { provide: BudgetStore, useValue: store },
        { provide: HouseholdStore, useValue: households },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Finance);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  async function createPlan(name: string, choice = 'private') {
    component.openNewPlan();
    component.planName = name;
    component.householdChoice = choice;
    await component.createPlan();
    await fixture.whenStable();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 26));
    localStorage.clear();
    store = new FakeBudgetStore();
    households = new FakeHouseholdStore();
  });

  afterEach(() => vi.useRealTimers());

  it('asks for a first plan without forcing a household', async () => {
    await create();
    expect(component.state()).toBe('empty');
    expect(component.panel()).toBe('new');
    expect(component.householdChoice).toBe('private');
  });

  it('creates a private plan without any household', async () => {
    await create();
    await createPlan('Mein Budget');

    expect(store.plans).toEqual([{ id: 'p1', name: 'Mein Budget', ownerId: ME, householdId: null }]);
    expect(component.state()).toBe('ready');
    expect(component.budget()).toEqual({ month: '2026-10', startBalance: 0, income: 0, expenses: [], priorities: [] });
  });

  it('offers only households that use the finance module', async () => {
    households.households.push(
      { id: 'h1', name: 'Wir zwei', inviteCode: 'A', memberCount: 2, modules: ['finance', 'calendar'] },
      { id: 'h2', name: 'Familie', inviteCode: 'B', memberCount: 5, modules: ['calendar'] },
    );
    store.plans.push({ id: 'hidden', name: 'Familienbudget', ownerId: 'user-b', householdId: 'h2' });
    await create();

    expect(component.financeHouseholds().map((h) => h.name)).toEqual(['Wir zwei']);
    expect(component.plans().length).toBe(0);

    await createPlan('Gemeinsam', 'h1');
    expect(component.plan()?.householdId).toBe('h1');
    expect(component.planHousehold()?.name).toBe('Wir zwei');
  });

  it('shares a private plan later and makes it private again', async () => {
    households.households.push({ id: 'h9', name: 'Wir zwei', inviteCode: 'X', memberCount: 2, modules: ['finance'] });
    await create();
    await createPlan('Mein Budget');

    component.openSettings();
    component.householdChoice = 'h9';
    await component.saveSettings();
    expect(store.plans[0].householdId).toBe('h9');

    component.openSettings();
    expect(component.householdChoice).toBe('h9');
    component.householdChoice = 'private';
    await component.saveSettings();
    expect(store.plans[0].householdId).toBeNull();
  });

  it('keeps budgets of different plans apart and saves after a short delay', async () => {
    await create();
    await createPlan('A');
    await createPlan('B');

    component.setField('income', 4000);
    expect(component.saveState()).toBe('saving');
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.rows.get('p2/2026-10')?.income).toBe(4000);
    expect(component.saveState()).toBe('saved');

    await component.selectPlan('p1');
    expect(component.budget().income).toBe(0);
  });

  it('only lets the owner edit a plan', async () => {
    households.households.push({ id: 'h1', name: 'Wir zwei', inviteCode: 'A', memberCount: 2, modules: ['finance'] });
    store.plans.push({ id: 'shared', name: 'Von Partner', ownerId: 'user-b', householdId: 'h1' });
    await create();
    expect(component.plan()?.id).toBe('shared');
    expect(component.isOwner()).toBe(false);
  });

  it('opens the newest month and carries it over into the next one', async () => {
    store.plans.push({ id: 'p0', name: 'Mein Budget', ownerId: ME, householdId: null });
    store.rows.set('p0/2026-10', BUDGET);
    await create();
    expect(component.budget().month).toBe('2026-10');

    await component.goToNextMonth();
    expect(component.budget().month).toBe('2026-11');
    expect(component.budget().priorities).toEqual([{ kind: 'debt', name: 'Kreditkarte', amount: 200, desiredRate: null }]);
  });

  it('mixes debts and savings in one priority list with desired payments', async () => {
    store.plans.push({ id: 'p0', name: 'Mein Budget', ownerId: ME, householdId: null });
    store.rows.set('p0/2026-10', { ...BUDGET, income: 3500 });
    await create();

    component.addPriority('saving');
    component.setItem('priorities', 2, 'name', 'Ferien');
    component.setItem('priorities', 2, 'amount', 1000);
    component.setItem('priorities', 2, 'desiredRate', 300);
    component.move(2, -1);
    component.move(1, -1);
    component.setItem('priorities', 1, 'desiredRate', 200); // Rechnung: only 200 this month
    expect(component.budget().priorities.map((p) => p.name)).toEqual(['Ferien', 'Rechnung', 'Kreditkarte']);
    // 2300 left after rent: Ferien 300, Rechnung 200, Kreditkarte gets the rest
    expect(component.result().priorities.map((p) => p.payment)).toEqual([300, 200, 1500]);

    component.setItem('priorities', 1, 'desiredRate', '');
    expect(component.budget().priorities[1].desiredRate).toBeNull();
    component.setItem('priorities', 0, 'kind', 'debt');
    expect(component.result().debtTotal).toBe(2300);
  });

  it('saves pending edits before showing the summary of the open month', async () => {
    store.plans.push({ id: 'p0', name: 'Mein Budget', ownerId: ME, householdId: null });
    store.rows.set('p0/2026-10', BUDGET);
    await create();

    component.setField('income', 3500);
    await component.openSummary();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.rows.get('p0/2026-10')?.income).toBe(3500);
    expect(component.visibilityLabel()).toBe('Privat');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Oktober 2026');
    expect(text).toContain('Kreditkarte');
    expect(text).toContain('Kontostand Ende');
  });
});
