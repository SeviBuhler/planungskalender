import { Injectable } from '@angular/core';
import { Supabase } from '../../services/supabase';

export type HouseholdModule = 'finance' | 'calendar' | 'shopping';

export const MODULES: { id: HouseholdModule; label: string; available: boolean }[] = [
  { id: 'finance', label: 'Finanzplanung', available: true },
  { id: 'calendar', label: 'Kalender', available: true },
  { id: 'shopping', label: 'Einkaufsliste', available: true },
];

export interface Household {
  id: string;
  name: string;
  inviteCode: string;
  memberCount: number;
  modules: HouseholdModule[];
}

interface HouseholdRow {
  id: string;
  name: string;
  invite_code: string;
  modules: HouseholdModule[];
  household_members?: { user_id: string }[];
}

const COLUMNS = 'id, name, invite_code, modules, household_members(user_id)';

function toHousehold(row: HouseholdRow): Household {
  return {
    id: row.id,
    name: row.name,
    inviteCode: row.invite_code,
    memberCount: row.household_members?.length ?? 1,
    modules: row.modules ?? [],
  };
}

// Households group people who share modules; RLS only returns the ones the user belongs to
@Injectable({
  providedIn: 'root'
})
export class HouseholdStore {
  constructor(private supabase: Supabase) {}

  async list(): Promise<Household[]> {
    const { data, error } = await this.supabase.client.from('households').select(COLUMNS).order('created_at');
    if (error) throw error;
    return (data as HouseholdRow[]).map(toHousehold);
  }

  async create(name: string, modules: HouseholdModule[]): Promise<Household> {
    const { data, error } = await this.supabase.client.rpc('create_household', {
      household_name: name,
      household_modules: modules,
    });
    if (error) throw error;
    return toHousehold(data as HouseholdRow);
  }

  async join(code: string): Promise<Household> {
    const { data, error } = await this.supabase.client.rpc('join_household', { code });
    if (error) throw error;
    return toHousehold(data as HouseholdRow);
  }

  async update(id: string, changes: { name?: string; modules?: HouseholdModule[] }): Promise<void> {
    const { error } = await this.supabase.client.from('households').update(changes).eq('id', id);
    if (error) throw error;
  }

  async leave(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('leave_household', { target: id });
    if (error) throw error;
  }
}
