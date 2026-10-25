import { Injectable } from '@angular/core';
import { Supabase } from '../../services/supabase';
import { MonthBudget } from './allocate';

const LEGACY_KEY_PREFIX = 'finance:';

export interface Household {
  id: string;
  inviteCode: string;
  memberCount: number;
}

interface HouseholdRow {
  id: string;
  invite_code: string;
  household_members?: { user_id: string }[];
}

function toHousehold(row: HouseholdRow): Household {
  return { id: row.id, inviteCode: row.invite_code, memberCount: row.household_members?.length ?? 1 };
}

// Budgets live in Supabase (table month_budgets) and are shared by the two members of a household
@Injectable({
  providedIn: 'root'
})
export class BudgetStore {
  constructor(private supabase: Supabase) {}

  async loadHousehold(): Promise<Household | null> {
    // RLS only returns the household the current user belongs to
    const { data, error } = await this.supabase.client
      .from('households')
      .select('id, invite_code, household_members(user_id)')
      .maybeSingle();
    if (error) throw error;
    return data ? toHousehold(data as HouseholdRow) : null;
  }

  async createHousehold(): Promise<Household> {
    const { data, error } = await this.supabase.client.rpc('create_household');
    if (error) throw error;
    return toHousehold(data as HouseholdRow);
  }

  async joinHousehold(code: string): Promise<Household> {
    const { error } = await this.supabase.client.rpc('join_household', { code });
    if (error) throw error;
    return (await this.loadHousehold())!;
  }

  async load(householdId: string, month: string): Promise<MonthBudget | null> {
    const { data, error } = await this.supabase.client
      .from('month_budgets')
      .select('data')
      .eq('household_id', householdId)
      .eq('month', month)
      .maybeSingle();
    if (error) throw error;
    return data ? (data.data as MonthBudget) : null;
  }

  async save(householdId: string, budget: MonthBudget): Promise<void> {
    const { error } = await this.supabase.client
      .from('month_budgets')
      .upsert({ household_id: householdId, month: budget.month, data: budget }, { onConflict: 'household_id,month' });
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
