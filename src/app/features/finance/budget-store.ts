import { Injectable } from '@angular/core';
import { Supabase } from '../../services/supabase';
import { MonthBudget } from './allocate';

const LEGACY_KEY_PREFIX = 'finance:';

export interface Household {
  id: string;
  name: string;
  inviteCode: string;
  memberCount: number;
}

// A plan without household is private: only its owner can see it
export interface FinancePlan {
  id: string;
  name: string;
  ownerId: string;
  householdId: string | null;
}

interface HouseholdRow {
  id: string;
  name: string;
  invite_code: string;
  household_members?: { user_id: string }[];
}

interface PlanRow {
  id: string;
  name: string;
  owner_id: string;
  household_id: string | null;
}

const PLAN_COLUMNS = 'id, name, owner_id, household_id';

function toHousehold(row: HouseholdRow): Household {
  return { id: row.id, name: row.name, inviteCode: row.invite_code, memberCount: row.household_members?.length ?? 1 };
}

function toPlan(row: PlanRow): FinancePlan {
  return { id: row.id, name: row.name, ownerId: row.owner_id, householdId: row.household_id };
}

// Plans and their monthly budgets live in Supabase; RLS decides who sees which plan
@Injectable({
  providedIn: 'root'
})
export class BudgetStore {
  constructor(private supabase: Supabase) {}

  async userId(): Promise<string | null> {
    const { data } = await this.supabase.client.auth.getSession();
    return data.session?.user.id ?? null;
  }

  async listHouseholds(): Promise<Household[]> {
    const { data, error } = await this.supabase.client
      .from('households')
      .select('id, name, invite_code, household_members(user_id)')
      .order('created_at');
    if (error) throw error;
    return (data as HouseholdRow[]).map(toHousehold);
  }

  async createHousehold(name: string): Promise<Household> {
    const { data, error } = await this.supabase.client.rpc('create_household', { household_name: name });
    if (error) throw error;
    return toHousehold(data as HouseholdRow);
  }

  async joinHousehold(code: string): Promise<Household> {
    const { data, error } = await this.supabase.client.rpc('join_household', { code });
    if (error) throw error;
    return toHousehold(data as HouseholdRow);
  }

  async listPlans(): Promise<FinancePlan[]> {
    const { data, error } = await this.supabase.client.from('finance_plans').select(PLAN_COLUMNS).order('created_at');
    if (error) throw error;
    return (data as PlanRow[]).map(toPlan);
  }

  async createPlan(name: string, householdId: string | null): Promise<FinancePlan> {
    const { data, error } = await this.supabase.client
      .from('finance_plans')
      .insert({ name, household_id: householdId })
      .select(PLAN_COLUMNS)
      .single();
    if (error) throw error;
    return toPlan(data as PlanRow);
  }

  async updatePlan(id: string, changes: { name?: string; householdId?: string | null }): Promise<void> {
    const row: Partial<PlanRow> = {};
    if (changes.name !== undefined) row.name = changes.name;
    if (changes.householdId !== undefined) row.household_id = changes.householdId;
    const { error } = await this.supabase.client.from('finance_plans').update(row).eq('id', id);
    if (error) throw error;
  }

  async deletePlan(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('finance_plans').delete().eq('id', id);
    if (error) throw error;
  }

  async latestMonth(planId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('month_budgets')
      .select('month')
      .eq('plan_id', planId)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.month ?? null;
  }

  async load(planId: string, month: string): Promise<MonthBudget | null> {
    const { data, error } = await this.supabase.client
      .from('month_budgets')
      .select('data')
      .eq('plan_id', planId)
      .eq('month', month)
      .maybeSingle();
    if (error) throw error;
    return data ? (data.data as MonthBudget) : null;
  }

  async save(planId: string, budget: MonthBudget): Promise<void> {
    const { error } = await this.supabase.client
      .from('month_budgets')
      .upsert({ plan_id: planId, month: budget.month, data: budget }, { onConflict: 'plan_id,month' });
    if (error) throw error;
  }

  // Budgets saved in the browser before the Supabase tables existed
  loadLegacy(month: string): MonthBudget | null {
    try {
      const raw = localStorage.getItem(LEGACY_KEY_PREFIX + month);
      return raw ? (JSON.parse(raw) as MonthBudget) : null;
    } catch {
      return null;
    }
  }

  removeLegacy(month: string) {
    try {
      localStorage.removeItem(LEGACY_KEY_PREFIX + month);
    } catch {
      // storage unavailable: nothing to clean up
    }
  }
}
