import { Component, OnDestroy, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MonthBudget, allocate, carryOver, expenseTotal, nextMonth } from '../../features/finance/allocate';
import { BudgetStore, FinancePlan } from '../../features/finance/budget-store';
import { Household, HouseholdStore } from '../../features/households/household-store';
import { ConfirmService } from '../../components/confirm/confirm';
import { Select, SelectOption } from '../../components/select/select';

type ListKey = 'expenses' | 'debts' | 'savings';
type ViewState = 'loading' | 'empty' | 'ready' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Panel = 'none' | 'new' | 'settings';

// 'private' or the id of a household that uses the finance module
type HouseholdChoice = string;

const SAVE_DELAY_MS = 600;
const SELECTED_PLAN_KEY = 'financeSelectedPlan';

function previousMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(year, m - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)
    ? String((error as { message: string }).message)
    : 'Unbekannter Fehler';
}

function emptyBudget(month: string): MonthBudget {
  return { month, startBalance: 0, income: 0, expenses: [], debts: [], savings: [] };
}

function rememberPlan(id: string) {
  try {
    localStorage.setItem(SELECTED_PLAN_KEY, id);
  } catch {
    // storage unavailable: the first plan opens next time
  }
}

function rememberedPlan(): string | null {
  try {
    return localStorage.getItem(SELECTED_PLAN_KEY);
  } catch {
    return null;
  }
}

@Component({
  selector: 'app-finance',
  imports: [FormsModule, RouterLink, Select],
  templateUrl: './finance.html',
  styleUrl: './finance.css',
})
export class Finance implements OnDestroy {
  readonly state = signal<ViewState>('loading');
  readonly saveState = signal<SaveState>('idle');
  readonly errorText = signal('');
  readonly panel = signal<Panel>('none');

  readonly households = signal<Household[]>([]);
  // Households that switched the finance module on; plans of other households stay hidden
  readonly financeHouseholds = computed(() => this.households().filter((h) => h.modules.includes('finance')));
  private readonly allPlans = signal<FinancePlan[]>([]);
  readonly plans = computed(() =>
    this.allPlans().filter((p) => p.householdId === null || this.financeHouseholds().some((h) => h.id === p.householdId))
  );
  readonly planOptions = computed<SelectOption[]>(() => this.plans().map((p) => ({ value: p.id, label: this.planLabel(p) })));
  readonly userId = signal<string | null>(null);
  readonly plan = signal<FinancePlan | null>(null);

  readonly planHousehold = computed(() => this.householdOf(this.plan()));
  readonly isOwner = computed(() => this.plan()?.ownerId === this.userId());

  // Form fields for "Neuer Plan" and the plan settings
  planName = '';
  householdChoice: HouseholdChoice = 'private';

  readonly budget = signal<MonthBudget>(emptyBudget(currentMonth()));
  readonly result = computed(() => allocate(this.budget()));
  readonly expenseTotal = expenseTotal;

  readonly monthLabel = computed(() => {
    const [year, m] = this.budget().month.split('-').map(Number);
    return new Date(year, m - 1, 1).toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });
  });

  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private loadToken = 0;

  constructor(private store: BudgetStore, private householdStore: HouseholdStore, private confirm: ConfirmService) {
    this.init();
  }

  ngOnDestroy() {
    this.flushSave();
  }

  chf(value: number): string {
    return value.toLocaleString('de-CH', { maximumFractionDigits: 2 });
  }

  householdOf(plan: FinancePlan | null): Household | null {
    return this.households().find((h) => h.id === plan?.householdId) ?? null;
  }

  planLabel(plan: FinancePlan): string {
    const household = this.householdOf(plan);
    return `${plan.name} · ${household ? household.name : 'Privat'}`;
  }

  private async init() {
    try {
      const [userId] = await Promise.all([this.store.userId(), this.reloadLists()]);
      this.userId.set(userId);
      const plans = this.plans();
      if (plans.length === 0) {
        this.openNewPlan();
        this.state.set('empty');
        return;
      }
      await this.selectPlan(plans.find((p) => p.id === rememberedPlan())?.id ?? plans[0].id);
    } catch (error) {
      this.fail(error);
    }
  }

  private async reloadLists() {
    const [plans, households] = await Promise.all([this.store.listPlans(), this.householdStore.list()]);
    this.allPlans.set(plans);
    this.households.set(households);
  }

  async selectPlan(id: string) {
    const plan = this.plans().find((p) => p.id === id);
    if (!plan) return;
    await this.flushSave();
    this.plan.set(plan);
    this.panel.set('none');
    rememberPlan(plan.id);
    try {
      // Open the newest month that has data, so a plan opens where it was left
      await this.openMonth((await this.store.latestMonth(plan.id)) ?? currentMonth());
    } catch (error) {
      this.fail(error);
    }
  }

  openNewPlan() {
    this.planName = '';
    this.householdChoice = 'private';
    this.errorText.set('');
    this.panel.set('new');
  }

  openSettings() {
    const plan = this.plan();
    if (!plan) return;
    this.planName = plan.name;
    this.householdChoice = plan.householdId ?? 'private';
    this.errorText.set('');
    this.panel.set('settings');
  }

  closePanel() {
    this.errorText.set('');
    this.panel.set('none');
  }

  private chosenHousehold(): string | null {
    return this.householdChoice === 'private' ? null : this.householdChoice;
  }

  async createPlan() {
    if (!this.planName.trim()) {
      this.errorText.set('Bitte einen Namen eingeben');
      return;
    }
    this.errorText.set('');
    try {
      const plan = await this.store.createPlan(this.planName.trim(), this.chosenHousehold());
      await this.reloadLists();
      await this.selectPlan(plan.id);
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  async saveSettings() {
    const plan = this.plan();
    if (!plan || !this.planName.trim()) return;
    this.errorText.set('');
    try {
      await this.store.updatePlan(plan.id, { name: this.planName.trim(), householdId: this.chosenHousehold() });
      await this.reloadLists();
      this.plan.set(this.plans().find((p) => p.id === plan.id) ?? null);
      this.panel.set('none');
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  async deletePlan() {
    const plan = this.plan();
    if (!plan || !(await this.confirm.ask(`Plan „${plan.name}“ mit allen Monaten löschen?`, 'Löschen'))) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    try {
      await this.store.deletePlan(plan.id);
      await this.reloadLists();
      this.plan.set(null);
      const next = this.plans()[0];
      if (next) {
        await this.selectPlan(next.id);
      } else {
        this.openNewPlan();
        this.state.set('empty');
      }
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  async openMonth(month: string) {
    const plan = this.plan();
    if (!plan) return;
    await this.flushSave();
    const token = ++this.loadToken;
    if (this.state() !== 'ready') this.state.set('loading');

    try {
      const budget = await this.findBudget(plan.id, month);
      if (token !== this.loadToken) return; // a newer month or plan was opened meanwhile
      this.budget.set(budget);
      this.saveState.set('idle');
      this.state.set('ready');
    } catch (error) {
      if (token === this.loadToken) this.fail(error);
    }
  }

  private async findBudget(planId: string, month: string): Promise<MonthBudget> {
    const stored = await this.store.load(planId, month);
    if (stored) return stored;

    // No data yet: carry over from the previous month if there is one
    const previous = await this.store.load(planId, previousMonth(month));
    if (previous) return { ...carryOver(previous), month };
    return emptyBudget(month);
  }

  goToPreviousMonth() {
    return this.openMonth(previousMonth(this.budget().month));
  }

  goToNextMonth() {
    return this.openMonth(nextMonth(this.budget().month));
  }

  private edit(change: (budget: MonthBudget) => MonthBudget) {
    this.budget.update(change);
    this.saveState.set('saving');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DELAY_MS);
  }

  private async flushSave() {
    if (this.saveTimer === undefined) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const plan = this.plan();
    if (!plan) return;
    try {
      await this.store.save(plan.id, this.budget());
      this.saveState.set('saved');
    } catch (error) {
      this.saveState.set('error');
      this.errorText.set(errorMessage(error));
    }
  }

  private fail(error: unknown) {
    this.errorText.set(errorMessage(error));
    this.state.set('error');
  }

  setField(field: 'startBalance' | 'income', value: number) {
    this.edit((b) => ({ ...b, [field]: Number(value) || 0 }));
  }

  setItem(list: ListKey, index: number, field: string, value: string | number) {
    this.edit((b) => {
      const items = b[list].map((item, i) =>
        i === index ? { ...item, [field]: field === 'name' || field === 'note' ? value : Number(value) || 0 } : item
      );
      return { ...b, [list]: items };
    });
  }

  addItem(list: ListKey) {
    const blank = {
      expenses: { name: '', amountPerUnit: 0, quantity: 1 },
      debts: { name: '', open: 0 },
      savings: { name: '', target: 0, desiredRate: 0 },
    }[list];
    this.edit((b) => ({ ...b, [list]: [...b[list], blank] }));
  }

  removeItem(list: ListKey, index: number) {
    this.edit((b) => ({ ...b, [list]: b[list].filter((_, i) => i !== index) }));
  }

  // Moves an entry up in the priority order (debts and savings are paid top to bottom)
  moveUp(list: 'debts' | 'savings', index: number) {
    if (index === 0) return;
    this.edit((b) => {
      const items = [...b[list]];
      [items[index - 1], items[index]] = [items[index], items[index - 1]];
      return { ...b, [list]: items };
    });
  }
}
