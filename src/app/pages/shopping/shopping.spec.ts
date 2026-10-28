import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Shopping, oneMore } from './shopping';
import { ShoppingItem, ShoppingList, ShoppingStore } from '../../features/shopping/shopping-store';
import { Household, HouseholdStore } from '../../features/households/household-store';
import { ConfirmService } from '../../components/confirm/confirm';
import { Product, ProductSearch } from '../../features/shopping/product-search';
import { signal } from '@angular/core';
import { Chain, ChainResult, PriceState, StorePrices, priceKey } from '../../features/shopping/store-prices';

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
  async addItem(listId: string, name: string, quantity: string | null, product: { code: string; imageUrl: string | null } | null = null) {
    const item = {
      id: `i${this.nextId++}`, listId, name, quantity, checked: false, createdAt: String(this.clock++), checkedAt: null,
      productCode: product?.code ?? null, imageUrl: product?.imageUrl ?? null,
    };
    this.items.push(item);
    return { ...item };
  }
  async updateItem(id: string, changes: { name?: string; quantity?: string | null; checked?: boolean }) {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error('offline');
    }
    const product = changes.name !== undefined ? { productCode: null, imageUrl: null } : {};
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...changes, ...product } : i));
  }
  async deleteItem(id: string) { this.items = this.items.filter((i) => i.id !== id); }
  async deleteChecked(listId: string) { this.items = this.items.filter((i) => i.listId !== listId || !i.checked); }
  async recentNames() { return ['Milch']; }
  subscribe(listId: string, onChange: () => void) {
    this.listeners.set(listId, onChange);
    return () => this.listeners.delete(listId);
  }
}

const VOLLMILCH: Product = {
  code: '7613404110285',
  name: 'Vollmilch',
  brand: 'Migros',
  quantity: '1 l',
  imageUrl: 'https://images.openfoodfacts.org/images/products/761/340/411/0285/front_de.3.200.jpg',
};

class FakeStorePrices {
  chains = signal<Chain[]>([]);
  prices = signal<ReadonlyMap<string, PriceState>>(new Map());
  requested: string[][] = [];
  promotionResults: ChainResult[] = [];
  async loadChains() {
    return this.chains();
  }
  async saveChains(chains: Chain[]) {
    this.chains.set(chains);
  }
  request(names: string[]) {
    this.requested.push(names);
  }
  async promotions() {
    return this.promotionResults;
  }
  setPrices(name: string, results: ChainResult[]) {
    this.prices.set(new Map([...this.prices(), [priceKey(name), { status: 'done', results }]]));
  }
}

class FakeProductSearch {
  terms: string[] = [];
  fail = false;
  async search(term: string) {
    this.terms.push(term);
    if (this.fail) throw new Error('offline');
    return term.toLowerCase().startsWith('mil') ? [VOLLMILCH] : [];
  }
}

describe('Shopping', () => {
  let store: FakeShoppingStore;
  let products: FakeProductSearch;
  let storePrices: FakeStorePrices;
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
        { provide: ProductSearch, useValue: products },
        { provide: StorePrices, useValue: storePrices },
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
    products = new FakeProductSearch();
    storePrices = new FakeStorePrices();
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
      store.items.push({ id: 'x', listId: 'l1', name: 'Kaffee', quantity: null, checked: false, createdAt: '9', checkedAt: null, productCode: null, imageUrl: null });
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

  it('says when the product search is not reachable and keeps the own suggestions', async () => {
    await create();
    component.suggestions.set(['Milchreis']);
    products.fail = true;
    vi.useFakeTimers();
    try {
      component.onNameInput('milc');
      await vi.advanceTimersByTimeAsync(500);
      expect(component.searchFailed()).toBe(true);
      expect(component.showSuggestions()).toBe(true);
      expect(component.suggestionRows()).toEqual([{ kind: 'own', name: 'Milchreis' }]);
      component.onNameInput('milch');
      expect(component.searchFailed()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('suggests own items and Open Food Facts products while typing', async () => {
    store.lists = [{ id: 'l1', name: 'Einkauf', ownerId: ME, householdId: null }];
    await create();
    component.suggestions.set(['Milchreis', 'Brot']);
    vi.useFakeTimers();
    try {
      component.onNameInput('mi');
      expect(component.suggestionRows()).toEqual([{ kind: 'own', name: 'Milchreis' }]);
      component.onNameInput('mil');
      component.onNameInput('milc');
      await vi.advanceTimersByTimeAsync(500);
      // Only the last term reaches the product database
      expect(products.terms).toEqual(['milc']);
      expect(component.suggestionRows().map((r) => r.kind)).toEqual(['own', 'product']);
      expect(component.searching()).toBe(false);
    } finally {
      vi.useRealTimers();
    }

    component.newQuantity = '2';
    component.onNameKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    component.onNameKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    component.onNameKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(component.openItems()).toMatchObject([
      { name: 'Vollmilch', quantity: '2', productCode: VOLLMILCH.code, imageUrl: VOLLMILCH.imageUrl },
    ]);
    expect(component.showSuggestions()).toBe(false);
    expect(component.newName).toBe('');

    // Renaming drops the product picture, changing the quantity keeps it
    const item = component.openItems()[0];
    component.startEdit(item);
    component.editQuantity = '3';
    await component.saveEdit(item);
    expect(component.openItems()[0].imageUrl).toBe(VOLLMILCH.imageUrl);
    component.startEdit(component.openItems()[0]);
    component.editName = 'Hafermilch';
    await component.saveEdit(component.openItems()[0]);
    expect(component.openItems()[0]).toMatchObject({ name: 'Hafermilch', imageUrl: null, productCode: null });
    expect(store.items[0].imageUrl).toBeNull();
  });

  it('shows the cheapest store price per item and the prices of all stores on click', async () => {
    await create();
    component.listName = 'Wocheneinkauf';
    await component.createList();
    await add('Milch');
    await add('Brot');
    fixture.detectChanges();
    // Without chosen stores nothing is searched
    expect(storePrices.requested).toEqual([]);

    storePrices.chains.set(['migros', 'aldi']);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(storePrices.requested.at(-1)).toEqual(['Milch', 'Brot']);

    const milk = (price: number, chain: Chain, promotion: string | null = null) => ({
      chain, id: chain, name: 'Vollmilch', brand: null, size: '1 l', price, regularPrice: null, promotion, validUntil: null, imageUrl: null, url: null,
    });
    storePrices.setPrices('Milch', [
      { chain: 'migros', products: [milk(1.85, 'migros')] },
      { chain: 'aldi', products: [milk(1.49, 'aldi', '-20%')] },
    ]);
    fixture.detectChanges();
    const item = component.openItems().find((i) => i.name === 'Milch')!;
    expect(component.bestPrice(item)?.chain).toBe('aldi');
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('[aria-label="Preise für Milch"]');
    expect(button.textContent).toContain('1.49');
    expect(button.textContent).toContain('Aldi');
    expect(button.textContent).toContain('Aktion');

    button.click();
    fixture.detectChanges();
    const details: string = fixture.nativeElement.textContent;
    expect(details).toContain('1.85');
    expect(details).toContain('ohne Gewähr');
  });

  it('adds a promotion to the list', async () => {
    await create();
    component.listName = 'Wocheneinkauf';
    await component.createList();
    component.showDeals(true);
    await component.addFromDeal({ name: 'Rohschinken', image: null });
    await component.addFromDeal({ name: 'Brie', image: null });
    expect(component.openItems().map((i) => i.name)).toEqual(['Rohschinken', 'Brie']);
    expect(component.dealsAdded()).toBe(2);

    // "Rückgängig" takes the last one off the list again
    expect(component.undoItem()?.name).toBe('Brie');
    await component.undoAdd();
    expect(component.openItems().map((i) => i.name)).toEqual(['Rohschinken']);
    expect(component.dealsAdded()).toBe(1);
    expect(component.undoItem()).toBeNull();

    // Opening the list clears the count
    component.showDeals(false);
    expect(component.dealsAdded()).toBe(0);
  });

  it('raises the quantity when the same promotion is added again', async () => {
    await create();
    component.listName = 'Wocheneinkauf';
    await component.createList();
    component.showDeals(true);
    await component.addFromDeal({ name: 'Brie', image: null });
    await component.addFromDeal({ name: 'brie', image: null });
    await component.addFromDeal({ name: 'Brie', image: null });
    expect(component.openItems().map((i) => [i.name, i.quantity])).toEqual([['Brie', '3']]);
    expect(component.dealsAdded()).toBe(3);
    expect(component.undoItem()?.quantity).toBe('3');

    // Undo takes one off again instead of the whole row
    await component.undoAdd();
    expect(component.openItems().map((i) => [i.name, i.quantity])).toEqual([['Brie', '2']]);
    expect(component.dealsAdded()).toBe(2);
    expect(store.items.map((i) => i.quantity)).toEqual(['2']);
  });

  it('counts up in steps of one and leaves other quantities alone', () => {
    expect(oneMore(null)).toBe('2');
    expect(oneMore(' 4 ')).toBe('5');
    expect(oneMore('500 g')).toBeNull();
    expect(oneMore('1,5')).toBeNull();
  });
});
