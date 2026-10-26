import { Injectable } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Supabase } from '../../services/supabase';

// A list without household is private: only its owner can see it
export interface ShoppingList {
  id: string;
  name: string;
  ownerId: string;
  householdId: string | null;
}

export interface ShoppingItem {
  id: string;
  listId: string;
  name: string;
  quantity: string | null;
  checked: boolean;
  createdAt: string;
  checkedAt: string | null;
}

interface ListRow {
  id: string;
  name: string;
  owner_id: string;
  household_id: string | null;
}

interface ItemRow {
  id: string;
  list_id: string;
  name: string;
  quantity: string | null;
  checked: boolean;
  created_at: string;
  checked_at: string | null;
}

const LIST_COLUMNS = 'id, name, owner_id, household_id';
const ITEM_COLUMNS = 'id, list_id, name, quantity, checked, created_at, checked_at';

function toList(row: ListRow): ShoppingList {
  return { id: row.id, name: row.name, ownerId: row.owner_id, householdId: row.household_id };
}

function toItem(row: ItemRow): ShoppingItem {
  return {
    id: row.id,
    listId: row.list_id,
    name: row.name,
    quantity: row.quantity,
    checked: row.checked,
    createdAt: row.created_at,
    checkedAt: row.checked_at,
  };
}

// Shopping lists and their items live in Supabase; RLS decides who sees which list
@Injectable({
  providedIn: 'root'
})
export class ShoppingStore {
  constructor(private supabase: Supabase) {}

  async userId(): Promise<string | null> {
    const { data } = await this.supabase.client.auth.getSession();
    return data.session?.user.id ?? null;
  }

  async listLists(): Promise<ShoppingList[]> {
    const { data, error } = await this.supabase.client.from('shopping_lists').select(LIST_COLUMNS).order('created_at');
    if (error) throw error;
    return (data as ListRow[]).map(toList);
  }

  async createList(name: string, householdId: string | null): Promise<ShoppingList> {
    const { data, error } = await this.supabase.client
      .from('shopping_lists')
      .insert({ name, household_id: householdId })
      .select(LIST_COLUMNS)
      .single();
    if (error) throw error;
    return toList(data as ListRow);
  }

  async updateList(id: string, changes: { name?: string; householdId?: string | null }): Promise<void> {
    const row: Partial<ListRow> = {};
    if (changes.name !== undefined) row.name = changes.name;
    if (changes.householdId !== undefined) row.household_id = changes.householdId;
    const { error } = await this.supabase.client.from('shopping_lists').update(row).eq('id', id);
    if (error) throw error;
  }

  async deleteList(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('shopping_lists').delete().eq('id', id);
    if (error) throw error;
  }

  async listItems(listId: string): Promise<ShoppingItem[]> {
    const { data, error } = await this.supabase.client
      .from('shopping_items')
      .select(ITEM_COLUMNS)
      .eq('list_id', listId)
      .order('created_at');
    if (error) throw error;
    return (data as ItemRow[]).map(toItem);
  }

  async addItem(listId: string, name: string, quantity: string | null): Promise<ShoppingItem> {
    const { data, error } = await this.supabase.client
      .from('shopping_items')
      .insert({ list_id: listId, name, quantity })
      .select(ITEM_COLUMNS)
      .single();
    if (error) throw error;
    return toItem(data as ItemRow);
  }

  async updateItem(id: string, changes: { name?: string; quantity?: string | null; checked?: boolean }): Promise<void> {
    const row: Partial<ItemRow> = {};
    if (changes.name !== undefined) row.name = changes.name;
    if (changes.quantity !== undefined) row.quantity = changes.quantity;
    if (changes.checked !== undefined) {
      row.checked = changes.checked;
      row.checked_at = changes.checked ? new Date().toISOString() : null;
    }
    const { error } = await this.supabase.client.from('shopping_items').update(row).eq('id', id);
    if (error) throw error;
  }

  async deleteItem(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('shopping_items').delete().eq('id', id);
    if (error) throw error;
  }

  async deleteChecked(listId: string): Promise<void> {
    const { error } = await this.supabase.client.from('shopping_items').delete().eq('list_id', listId).eq('checked', true);
    if (error) throw error;
  }

  // Item names the user entered before, newest first, for the input suggestions
  async recentNames(limit = 200): Promise<string[]> {
    const { data, error } = await this.supabase.client
      .from('shopping_items')
      .select('name')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    const seen = new Set<string>();
    return (data as { name: string }[])
      .map((row) => row.name.trim())
      .filter((name) => !seen.has(name.toLowerCase()) && !!seen.add(name.toLowerCase()));
  }

  // Calls onChange whenever someone adds, changes or removes an item of the list
  subscribe(listId: string, onChange: () => void): () => void {
    const channel: RealtimeChannel = this.supabase.client
      .channel(`shopping-items-${listId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items', filter: `list_id=eq.${listId}` }, onChange)
      .subscribe();
    return () => {
      this.supabase.client.removeChannel(channel);
    };
  }
}
