import { Component, ElementRef, OnDestroy, computed, effect, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ShoppingItem, ShoppingList, ShoppingStore } from '../../features/shopping/shopping-store';
import { MIN_SEARCH_LENGTH, Product, ProductSearch } from '../../features/shopping/product-search';
import { Household, HouseholdStore } from '../../features/households/household-store';
import { ConfirmService } from '../../components/confirm/confirm';
import { Select, SelectOption } from '../../components/select/select';
import { PageHeader } from '../../components/page-header/page-header';

type ViewState = 'loading' | 'empty' | 'ready' | 'error';
type Panel = 'none' | 'new' | 'settings';

const SELECTED_LIST_KEY = 'shoppingSelectedList';
// Several changes from one save arrive close together; reload once
const RELOAD_DELAY_MS = 150;
// Search Open Food Facts once typing pauses, not on every key
const SEARCH_DELAY_MS = 400;
const OWN_SUGGESTIONS = 4;

// One row of the dropdown under the item input: an item typed before or a product
export type Suggestion = { kind: 'own'; name: string } | { kind: 'product'; product: Product };

function errorMessage(error: unknown): string {
  return error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)
    ? String((error as { message: string }).message)
    : 'Unbekannter Fehler';
}

function rememberList(id: string) {
  try {
    localStorage.setItem(SELECTED_LIST_KEY, id);
  } catch {
    // storage unavailable: the first list opens next time
  }
}

function rememberedList(): string | null {
  try {
    return localStorage.getItem(SELECTED_LIST_KEY);
  } catch {
    return null;
  }
}

function optional(text: string): string | null {
  return text.trim() || null;
}

@Component({
  selector: 'app-shopping',
  imports: [PageHeader, FormsModule, NgTemplateOutlet, RouterLink, Select],
  templateUrl: './shopping.html',
})
export class Shopping implements OnDestroy {
  readonly state = signal<ViewState>('loading');
  readonly errorText = signal('');
  readonly panel = signal<Panel>('none');

  readonly households = signal<Household[]>([]);
  // Households that switched the shopping module on; lists of other households stay hidden
  readonly shoppingHouseholds = computed(() => this.households().filter((h) => h.modules.includes('shopping')));
  private readonly allLists = signal<ShoppingList[]>([]);
  readonly lists = computed(() =>
    this.allLists().filter((l) => l.householdId === null || this.shoppingHouseholds().some((h) => h.id === l.householdId))
  );
  readonly listOptions = computed<SelectOption[]>(() => this.lists().map((l) => ({ value: l.id, label: this.listLabel(l) })));
  readonly userId = signal<string | null>(null);
  readonly list = signal<ShoppingList | null>(null);
  readonly listHousehold = computed(() => this.householdOf(this.list()));
  readonly isOwner = computed(() => this.list()?.ownerId === this.userId());

  readonly items = signal<ShoppingItem[]>([]);
  readonly openItems = computed(() => this.items().filter((i) => !i.checked));
  // Most recently checked first, like a cart that fills up
  readonly checkedItems = computed(() =>
    this.items()
      .filter((i) => i.checked)
      .sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? ''))
  );
  readonly suggestions = signal<string[]>([]);

  // Dropdown under the item input
  private readonly query = signal('');
  readonly products = signal<Product[]>([]);
  readonly searching = signal(false);
  readonly searchFailed = signal(false);
  readonly suggestOpen = signal(false);
  readonly activeSuggestion = signal(-1);
  readonly suggestionRows = computed<Suggestion[]>(() => {
    const query = this.query().trim().toLowerCase();
    if (!query) return [];
    const own = this.suggestions()
      .filter((name) => name.toLowerCase().includes(query) && name.toLowerCase() !== query)
      .slice(0, OWN_SUGGESTIONS)
      .map((name): Suggestion => ({ kind: 'own', name }));
    return [...own, ...this.products().map((product): Suggestion => ({ kind: 'product', product }))];
  });
  readonly showSuggestions = computed(() => this.suggestOpen() && (this.suggestionRows().length > 0 || this.searching() || this.searchFailed()));

  // Form fields for "Neue Liste" and the list settings
  listName = '';
  householdChoice = 'private';

  // Form fields for a new item and for the item being edited
  newName = '';
  newQuantity = '';
  readonly editingId = signal<string | null>(null);
  editName = '';
  editQuantity = '';
  private readonly editInput = viewChild<ElementRef<HTMLInputElement>>('editInput');

  private unsubscribe: (() => void) | undefined;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  private loadToken = 0;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private searchAbort: AbortController | undefined;

  constructor(
    private store: ShoppingStore,
    private householdStore: HouseholdStore,
    private confirm: ConfirmService,
    private productSearch: ProductSearch
  ) {
    this.init();
    // Focus the name as soon as a row switches to editing
    effect(() => this.editInput()?.nativeElement.focus());
  }

  ngOnDestroy() {
    this.unsubscribe?.();
    clearTimeout(this.reloadTimer);
    this.stopSearch();
  }

  householdOf(list: ShoppingList | null): Household | null {
    return this.households().find((h) => h.id === list?.householdId) ?? null;
  }

  listLabel(list: ShoppingList): string {
    const household = this.householdOf(list);
    return `${list.name} · ${household ? household.name : 'Privat'}`;
  }

  private async init() {
    try {
      const [userId] = await Promise.all([this.store.userId(), this.reloadLists()]);
      this.userId.set(userId);
      this.store.recentNames().then((names) => this.suggestions.set(names), () => undefined);
      const lists = this.lists();
      if (lists.length === 0) {
        this.openNewList();
        this.state.set('empty');
        return;
      }
      await this.selectList(lists.find((l) => l.id === rememberedList())?.id ?? lists[0].id);
    } catch (error) {
      this.fail(error);
    }
  }

  private async reloadLists() {
    const [lists, households] = await Promise.all([this.store.listLists(), this.householdStore.list()]);
    this.allLists.set(lists);
    this.households.set(households);
  }

  async selectList(id: string) {
    const list = this.lists().find((l) => l.id === id);
    if (!list) return;
    this.list.set(list);
    this.panel.set('none');
    this.editingId.set(null);
    rememberList(list.id);
    this.unsubscribe?.();
    this.unsubscribe = this.store.subscribe(list.id, () => this.scheduleReload());
    if (this.state() !== 'ready') this.state.set('loading');
    try {
      await this.reloadItems();
      this.state.set('ready');
    } catch (error) {
      this.fail(error);
    }
  }

  private scheduleReload() {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.reloadItems().catch((error) => this.errorText.set(errorMessage(error))), RELOAD_DELAY_MS);
  }

  private async reloadItems() {
    const list = this.list();
    if (!list) return;
    const token = ++this.loadToken;
    const items = await this.store.listItems(list.id);
    if (token === this.loadToken) this.items.set(items); // a newer load or list replaced this one meanwhile
  }

  openNewList() {
    this.listName = '';
    this.householdChoice = 'private';
    this.errorText.set('');
    this.panel.set('new');
  }

  openSettings() {
    const list = this.list();
    if (!list) return;
    this.listName = list.name;
    this.householdChoice = list.householdId ?? 'private';
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

  async createList() {
    if (!this.listName.trim()) {
      this.errorText.set('Bitte einen Namen eingeben');
      return;
    }
    this.errorText.set('');
    try {
      const list = await this.store.createList(this.listName.trim(), this.chosenHousehold());
      await this.reloadLists();
      await this.selectList(list.id);
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  async saveSettings() {
    const list = this.list();
    if (!list || !this.listName.trim()) return;
    this.errorText.set('');
    try {
      await this.store.updateList(list.id, { name: this.listName.trim(), householdId: this.chosenHousehold() });
      await this.reloadLists();
      this.list.set(this.lists().find((l) => l.id === list.id) ?? null);
      this.panel.set('none');
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  async deleteList() {
    const list = this.list();
    if (!list || !(await this.confirm.ask(`Liste „${list.name}“ mit allen Artikeln löschen?`, 'Löschen'))) return;
    try {
      await this.store.deleteList(list.id);
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      await this.reloadLists();
      this.list.set(null);
      this.items.set([]);
      const next = this.lists()[0];
      if (next) {
        await this.selectList(next.id);
      } else {
        this.openNewList();
        this.state.set('empty');
      }
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  onNameInput(value: string) {
    this.newName = value;
    this.query.set(value);
    this.suggestOpen.set(true);
    this.activeSuggestion.set(-1);
    this.stopSearch();
    this.products.set([]);
    this.searchFailed.set(false);
    if (value.trim().length < MIN_SEARCH_LENGTH) return;
    this.searching.set(true);
    this.searchTimer = setTimeout(() => this.runSearch(value), SEARCH_DELAY_MS);
  }

  private async runSearch(term: string) {
    const abort = new AbortController();
    this.searchAbort = abort;
    try {
      const products = await this.productSearch.search(term, abort.signal);
      if (!abort.signal.aborted) this.products.set(products);
    } catch {
      // Without the product database the own suggestions still work
      if (!abort.signal.aborted) this.searchFailed.set(true);
    } finally {
      if (!abort.signal.aborted) this.searching.set(false);
    }
  }

  private stopSearch() {
    clearTimeout(this.searchTimer);
    this.searchAbort?.abort();
    this.searching.set(false);
  }

  // Clicks inside the dropdown keep the focus; leaving the input closes it
  leaveSuggestions(event: FocusEvent) {
    const box = event.currentTarget as HTMLElement;
    if (!box.contains(event.relatedTarget as Node | null)) this.closeSuggestions();
  }

  closeSuggestions() {
    this.suggestOpen.set(false);
    this.activeSuggestion.set(-1);
  }

  onNameKeydown(event: KeyboardEvent) {
    const count = this.suggestionRows().length;
    if (!this.showSuggestions() || count === 0) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        this.activeSuggestion.update((i) => (event.key === 'ArrowDown' ? (i + 1) % count : (i <= 0 ? count : i) - 1));
        return;
      case 'Enter': {
        const row = this.suggestionRows()[this.activeSuggestion()];
        if (row) {
          event.preventDefault();
          this.choose(row);
        }
        return;
      }
      case 'Escape':
        this.closeSuggestions();
        return;
    }
  }

  // Picking a suggestion adds it right away, with the quantity typed so far
  choose(row: Suggestion) {
    this.newName = row.kind === 'own' ? row.name : row.product.name;
    return this.addItem(row.kind === 'product' ? row.product : null);
  }

  productDetails(product: Product): string {
    return [product.brand, product.quantity].filter(Boolean).join(' · ');
  }

  async addItem(product: Product | null = null) {
    const list = this.list();
    const name = this.newName.trim();
    if (!list || !name) return;
    const quantity = optional(this.newQuantity);
    this.newName = '';
    this.newQuantity = '';
    this.query.set('');
    this.stopSearch();
    this.products.set([]);
    this.closeSuggestions();
    this.errorText.set('');
    try {
      const item = await this.store.addItem(list.id, name, quantity, product && { code: product.code, imageUrl: product.imageUrl });
      // The realtime echo may already have brought it in
      this.items.update((items) => (items.some((i) => i.id === item.id) ? items : [...items, item]));
      if (!this.suggestions().some((s) => s.toLowerCase() === name.toLowerCase())) {
        this.suggestions.update((names) => [name, ...names]);
      }
    } catch (error) {
      this.newName = name;
      this.newQuantity = quantity ?? '';
      this.errorText.set(errorMessage(error));
    }
  }

  // Optimistic: the row moves at once and goes back if saving fails
  async toggle(item: ShoppingItem) {
    const checked = !item.checked;
    const checkedAt = checked ? new Date().toISOString() : null;
    this.patchItem(item.id, { checked, checkedAt });
    try {
      await this.store.updateItem(item.id, { checked });
    } catch (error) {
      this.patchItem(item.id, { checked: item.checked, checkedAt: item.checkedAt });
      this.errorText.set(errorMessage(error));
    }
  }

  startEdit(item: ShoppingItem) {
    this.editingId.set(item.id);
    this.editName = item.name;
    this.editQuantity = item.quantity ?? '';
  }

  cancelEdit() {
    this.editingId.set(null);
  }

  // Moving between name and quantity keeps editing; leaving the row saves
  leaveEdit(event: FocusEvent, item: ShoppingItem) {
    const row = event.currentTarget as HTMLElement;
    if (!row.contains(event.relatedTarget as Node | null)) this.saveEdit(item);
  }

  async saveEdit(item: ShoppingItem) {
    if (this.editingId() !== item.id) return;
    const name = this.editName.trim();
    const quantity = optional(this.editQuantity);
    this.editingId.set(null);
    if (!name || (name === item.name && quantity === item.quantity)) return;
    const renamed = name !== item.name;
    this.patchItem(item.id, renamed ? { name, quantity, productCode: null, imageUrl: null } : { quantity });
    try {
      await this.store.updateItem(item.id, renamed ? { name, quantity } : { quantity });
    } catch (error) {
      this.patchItem(item.id, { name: item.name, quantity: item.quantity, productCode: item.productCode, imageUrl: item.imageUrl });
      this.errorText.set(errorMessage(error));
    }
  }

  async removeItem(item: ShoppingItem) {
    this.items.update((items) => items.filter((i) => i.id !== item.id));
    try {
      await this.store.deleteItem(item.id);
    } catch (error) {
      this.items.update((items) => [...items, item]);
      this.errorText.set(errorMessage(error));
    }
  }

  async clearChecked() {
    const list = this.list();
    const count = this.checkedItems().length;
    if (!list || count === 0) return;
    if (!(await this.confirm.ask(`${count} erledigte Artikel löschen?`, 'Löschen'))) return;
    const before = this.items();
    this.items.update((items) => items.filter((i) => !i.checked));
    try {
      await this.store.deleteChecked(list.id);
    } catch (error) {
      this.items.set(before);
      this.errorText.set(errorMessage(error));
    }
  }

  private patchItem(id: string, changes: Partial<ShoppingItem>) {
    this.items.update((items) => items.map((i) => (i.id === id ? { ...i, ...changes } : i)));
  }

  private fail(error: unknown) {
    this.errorText.set(errorMessage(error));
    this.state.set('error');
  }
}
