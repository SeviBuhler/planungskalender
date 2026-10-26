import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Finance } from './finance';
import { BudgetStore, FinancePlan, Household } from '../../features/finance/budget-store';
import { MonthBudget } from '../../features/finance/allocate';

const ME = 'user-a';

// In-memory stand-in for the Supabase tables
class FakeBudgetStore {
  households: Household[] = [];
  plans: FinancePlan[] = [];
  rows = new Map<string, MonthBudget>();
  legacy = new Map<string, MonthBudget>();
  private nextId = 1;

  async userId() { return ME; }
  async listHouseholds() { return [...this.households]; }
  async createHousehold(name: string) {
    const household = { id: `h${this.nextId++}`, name: name || 'Haushalt', inviteCode: 'NEU12345', memberCount: 1 };
    this.households.push(household);
    return household;
  }
  async joinHousehold(code: string) {
    if (code !== 'ABCD1234') throw new Error('Einladungscode ungültig');
    const household = { id: 'joined', name: 'Partner', inviteCode: code, memberCount: 2 };
    this.households.push(household);
    return household;
  }
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
  async save(planId: string, budget: MonthBudget) { this.rows.set(`${planId}/${budget.month}`, structuredClone(budget)); }
  loadLegacy(month: string) { return this.legacy.get(month) ?? null; }
  removeLegacy(month: string) { this.legacy.delete(month); }
}

describe('Finance', () => {
  let store: FakeBudgetStore;
  let fixture: ComponentFixture<Finance>;
  let component: Finance;

  async function create() {
    await TestBed.configureTestingModule({
      imports: [Finance],
      providers: [provideRouter([]), { provide: BudgetStore, useValue: store }],
    }).compileComponents();
    fixture = TestBed.createComponent(Finance);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  async function createPlan(name: string, choice = 'private', template = false) {
    component.openNewPlan();
    component.planName = name;
    component.householdChoice = choice;
    component.useTemplate = template;
    await component.createPlan();
    await fixture.whenStable();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 26));
    localStorage.clear();
    store = new FakeBudgetStore();
  });

  afterEach(() => vi.useRealTimers());

  it('asks for a first plan without forcing a household', async () => {
    await create();
    expect(component.state()).toBe('empty');
    expect(component.panel()).toBe('new');
    expect(component.householdChoice).toBe('private');
  });

  it('creates a private plan from the Excel template', async () => {
    await create();
    await createPlan('Mein Budget', 'private', true);

    expect(store.plans).toEqual([{ id: 'p1', name: 'Mein Budget', ownerId: ME, householdId: null }]);
    expect(store.households.length).toBe(0);
    expect(component.state()).toBe('ready');
    expect(component.budget().month).toBe('2026-11');
    expect(component.result().endBalance).toBe(0);
  });

  it('creates a shared plan in a new household', async () => {
    await create();
    component.openNewPlan();
    component.planName = 'Gemeinsam';
    component.householdChoice = 'new';
    component.newHouseholdName = 'Wir zwei';
    await component.createPlan();

    expect(store.households.map((h) => h.name)).toEqual(['Wir zwei']);
    expect(component.plan()?.householdId).toBe(store.households[0].id);
    expect(component.planHousehold()?.inviteCode).toBe('NEU12345');
  });

  it('joins an existing household with an invite code', async () => {
    await create();
    component.openNewPlan();
    component.planName = 'Gemeinsam';
    component.householdChoice = 'join';
    component.inviteCode = 'FALSCH';
    await component.createPlan();
    expect(component.errorText()).toBe('Einladungscode ungültig');
    expect(store.plans.length).toBe(0);

    component.inviteCode = 'ABCD1234';
    await component.createPlan();
    expect(component.plan()?.householdId).toBe('joined');
  });

  it('shares a private plan later and makes it private again', async () => {
    store.households.push({ id: 'h9', name: 'Wir zwei', inviteCode: 'X', memberCount: 2 });
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
    store.plans.push({ id: 'shared', name: 'Von Partner', ownerId: 'user-b', householdId: 'h1' });
    await create();
    expect(component.plan()?.id).toBe('shared');
    expect(component.isOwner()).toBe(false);
  });

  it('carries the plan over into the next month', async () => {
    await create();
    await createPlan('Mein Budget', 'private', true);
    await component.goToNextMonth();
    await fixture.whenStable();

    expect(component.budget().month).toBe('2026-12');
    expect(component.budget().debts.map((d) => d.open)).toEqual([1449, 400]);
  });

  it('moves a month saved in the browser into the opened plan', async () => {
    const legacy: MonthBudget = { month: '2026-10', startBalance: 5, income: 6, expenses: [], debts: [], savings: [] };
    store.legacy.set('2026-10', legacy);
    store.plans.push({ id: 'p0', name: 'Alt', ownerId: ME, householdId: null });
    await create();

    expect(component.budget()).toEqual(legacy);
    expect(store.rows.get('p0/2026-10')).toEqual(legacy);
    expect(store.legacy.size).toBe(0);
  });
});
