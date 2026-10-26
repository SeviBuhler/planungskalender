import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Shopping } from './shopping';
import { ShoppingItem, ShoppingList, ShoppingStore } from '../../features/shopping/shopping-store';
import { Household, HouseholdStore } from '../../features/households/household-store';
import { ConfirmService } from '../../components/confirm/confirm';

const ME = 'user-a';

// In-memory stand-ins for the Supabase tables
class FakeHouseholdStore {
  households: Household[] = [];
  async list() { return [...this.households]; }
}

class FakeShoppingStore {
  lists: ShoppingList[] = [];
  items: ShoppingItem[] = [];
  listeners = new Map<string, () => void>();
  failNextUpdate = false;
  private nextId = 1;
  private clock = 0;

  async userId() { return ME; }
  async listLists() { return [...this.lists]; }
  async createList(name: string, householdId: string | null) {
    const list = { id: `l${this.nextId++}`, name, ownerId: ME, householdId };
    this.lists.push(list);
    return list;
  }
  async updateList(id: string, changes: { name?: string; householdId?: string | null }) {
    this.lists = this.lists.map((l) => (l.id === id ? { ...l, ...changes } : l));
  }
  async deleteList(id: string) {
    this.lists = this.lists.filter((l) => l.id !== id);
    this.items = this.items.filter((i) => i.listId !== id);
  }
  async listItems(listId: string) { return this.items.filter((i) => i.listId === listId).map((i) => ({ ...i })); }
  async addItem(listId: string, name: string, quantity: string | null) {
    const item = { id: `i${this.nextId++}`, listId, name, quantity, checked: false, createdAt: String(this.clock++), checkedAt: null };
    this.items.push(item);
    return { ...item };
  }
  async updateItem(id: string, changes: { name?: string; quantity?: string | null; checked?: boolean }) {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error('offline');
    }
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...changes } : i));
  }
  async deleteItem(id: string) { this.items = this.items.filter((i) => i.id !== id); }
  async deleteChecked(listId: string) { this.items = this.items.filter((i) => i.listId !== listId || !i.checked); }
  async recentNames() { return ['Milch']; }
  subscribe(listId: string, onChange: () => void) {
    this.listeners.set(listId, onChange);
    return () => this.listeners.delete(listId);
  }
}

describe('Shopping', () => {
  let store: FakeShoppingStore;
  let households: FakeHouseholdStore;
  let fixture: ComponentFixture<Shopping>;
  let component: Shopping;

  async function create() {
    await TestBed.configureTestingModule({
      imports: [Shopping],
      providers: [
        provideRouter([]),
        { provide: ShoppingStore, useValue: store },
        { provide: HouseholdStore, useValue: households },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Shopping);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  async function add(name: string, quantity = '') {
    component.newName = name;
    component.newQuantity = quantity;
    await component.addItem();
  }

  beforeEach(() => {
    localStorage.clear();
    store = new FakeShoppingStore();
    households = new FakeHouseholdStore();
  });

  it('asks for a first list when there is none', async () => {
    await create();
    expect(component.state()).toBe('empty');
    expect(component.panel()).toBe('new');

    component.listName = 'Wocheneinkauf';
    await component.createList();
    expect(component.state()).toBe('ready');
    expect(component.list()?.name).toBe('Wocheneinkauf');
    expect(component.list()?.householdId).toBeNull();
    expect(store.listeners.has(component.list()!.id)).toBe(true);
  });

  it('shares a list only with households that use the shopping module', async () => {
    households.households = [
      { id: 'h1', name: 'WG', inviteCode: 'A', memberCount: 2, modules: ['shopping'] },
      { id: 'h2', name: 'Familie', inviteCode: 'B', memberCount: 4, modules: ['finance'] },
    ];
    store.lists = [
      { id: 'l-wg', name: 'WG', ownerId: 'user-b', householdId: 'h1' },
      { id: 'l-fam', name: 'Familie', ownerId: 'user-b', householdId: 'h2' },
    ];
    await create();
    expect(component.shoppingHouseholds().map((h) => h.id)).toEqual(['h1']);
    expect(component.lists().map((l) => l.id)).toEqual(['l-wg']);
    expect(component.listOptions()[0].label).toBe('WG · WG');
    expect(component.isOwner()).toBe(false);
  });

  it('adds, checks and edits items', async () => {
    store.lists = [{ id: 'l1', name: 'Einkauf', ownerId: ME, householdId: null }];
    await create();

    await add('  Brot ');
    await add('Milch', '2 l');
    expect(component.newName).toBe('');
    await add('   ');
    expect(component.openItems().map((i) => [i.name, i.quantity])).toEqual([['Brot', null], ['Milch', '2 l']]);
    expect(component.suggestions()).toEqual(['Brot', 'Milch']);

    const brot = component.openItems()[0];
    await component.toggle(brot);
    expect(component.openItems().map((i) => i.name)).toEqual(['Milch']);
    expect(component.checkedItems().map((i) => i.name)).toEqual(['Brot']);
    expect(store.items.find((i) => i.id === brot.id)?.checked).toBe(true);

    const milch = component.openItems()[0];
    component.startEdit(milch);
    component.editName = 'Hafermilch';
    component.editQuantity = '';
    await component.saveEdit(milch);
    expect(component.editingId()).toBeNull();
    expect(component.openItems()[0]).toMatchObject({ name: 'Hafermilch', quantity: null });
    expect(store.items.find((i) => i.id === milch.id)?.name).toBe('Hafermilch');
  });

  it('puts an item back when saving fails', async () => {
    store.lists = [{ id: 'l1', name: 'Einkauf', ownerId: ME, householdId: null }];
    await create();
    await add('Eier');

    store.failNextUpdate = true;
    await component.toggle(component.openItems()[0]);
    expect(component.openItems().map((i) => i.name)).toEqual(['Eier']);
    expect(component.errorText()).toBe('offline');
  });

  it('clears checked items after confirming', async () => {
    store.lists = [{ id: 'l1', name: 'Einkauf', ownerId: ME, householdId: null }];
    await create();
    await add('Äpfel');
    await add('Reis');
    await component.toggle(component.openItems()[0]);

    vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(true);
    await component.clearChecked();
    expect(component.items().map((i) => i.name)).toEqual(['Reis']);
    expect(store.items.map((i) => i.name)).toEqual(['Reis']);
  });

  it('reloads when another member changes the list', async () => {
    store.lists = [{ id: 'l1', name: 'Einkauf', ownerId: ME, householdId: null }];
    await create();
    vi.useFakeTimers();
    try {
      store.items.push({ id: 'x', listId: 'l1', name: 'Kaffee', quantity: null, checked: false, createdAt: '9', checkedAt: null });
      store.listeners.get('l1')!();
      await vi.advanceTimersByTimeAsync(200);
      expect(component.openItems().map((i) => i.name)).toEqual(['Kaffee']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('makes the list private or shares it from the settings', async () => {
    households.households = [{ id: 'h1', name: 'WG', inviteCode: 'A', memberCount: 2, modules: ['shopping'] }];
    store.lists = [{ id: 'l1', name: 'Einkauf', ownerId: ME, householdId: null }];
    await create();

    component.openSettings();
    component.householdChoice = 'h1';
    await component.saveSettings();
    expect(component.listHousehold()?.name).toBe('WG');
    expect(store.lists[0].householdId).toBe('h1');
  });
});
