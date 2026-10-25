import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Finance } from './finance';
import { BudgetStore, Household } from '../../features/finance/budget-store';
import { MonthBudget } from '../../features/finance/allocate';

// In-memory stand-in for the Supabase tables
class FakeBudgetStore {
  household: Household | null = { id: 'h1', inviteCode: 'ABCD1234', memberCount: 1 };
  rows = new Map<string, MonthBudget>();
  legacy = new Map<string, MonthBudget>();

  async loadHousehold() { return this.household; }
  async createHousehold() { return (this.household = { id: 'h1', inviteCode: 'ABCD1234', memberCount: 1 }); }
  async joinHousehold(code: string) {
    if (code !== 'ABCD1234') throw new Error('Einladungscode ungültig');
    return (this.household = { id: 'h1', inviteCode: code, memberCount: 2 });
  }
  async load(_: string, month: string) { return this.rows.get(month) ?? null; }
  async save(_: string, budget: MonthBudget) { this.rows.set(budget.month, structuredClone(budget)); }
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

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 9, 25));
    store = new FakeBudgetStore();
  });

  afterEach(() => vi.useRealTimers());

  it('starts with the November plan without saving it', async () => {
    await create();
    expect(component.state()).toBe('ready');
    expect(component.budget().month).toBe('2026-11');
    expect(component.result().endBalance).toBe(0);
    expect(store.rows.size).toBe(0);
  });

  it('saves edits to the household after a short delay', async () => {
    await create();
    component.setField('income', 4000);
    expect(component.saveState()).toBe('saving');
    expect(store.rows.size).toBe(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.rows.get('2026-11')?.income).toBe(4000);
    expect(component.saveState()).toBe('saved');
  });

  it('carries the saved plan over into the next month', async () => {
    await create();
    component.setField('income', 3279);
    await component.goToNextMonth();
    await fixture.whenStable();

    expect(store.rows.has('2026-11')).toBe(true);
    expect(component.budget().month).toBe('2026-12');
    expect(component.budget().debts.map((d) => d.open)).toEqual([1449, 400]);
  });

  it('moves a plan saved in the browser into Supabase', async () => {
    const legacy: MonthBudget = { month: '2026-11', startBalance: 5, income: 6, expenses: [], debts: [], savings: [] };
    store.legacy.set('2026-11', legacy);
    await create();

    expect(component.budget()).toEqual(legacy);
    expect(store.rows.get('2026-11')).toEqual(legacy);
    expect(store.legacy.size).toBe(0);
  });

  it('asks to create or join a household first', async () => {
    store.household = null;
    await create();
    expect(component.state()).toBe('setup');

    component.inviteCode = 'FALSCH';
    await component.joinHousehold();
    expect(component.errorText()).toBe('Einladungscode ungültig');

    component.inviteCode = 'ABCD1234';
    await component.joinHousehold();
    expect(component.state()).toBe('ready');
    expect(component.household()?.memberCount).toBe(2);
  });

  it('reorders debts by priority', async () => {
    await create();
    component.moveUp('debts', 2);
    expect(component.result().debts.map((d) => d.payment)).toEqual([360, 400, 224]);
  });
});
