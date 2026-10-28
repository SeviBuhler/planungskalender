import { Component, OnInit, computed, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconButton } from '../../../components/icon-button/icon-button';
import { CHAINS, Chain, ChainResult, StorePrices, StoreProduct, chainLabel, formatPrice } from '../../../features/shopping/store-prices';

// A deal put on the list, with its picture for the flight into the cart
export interface DealPick {
  name: string;
  image: Element | null;
}

// How long the + stays a ✓ after adding
const ADDED_MS = 1500;

function errorMessage(error: unknown): string {
  return error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)
    ? String((error as { message: string }).message)
    : 'Unbekannter Fehler';
}

// The user's stores and their current promotions
@Component({
  selector: 'app-store-deals',
  imports: [FormsModule, IconButton],
  templateUrl: './store-deals.html',
  host: { class: 'max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col' },
})
export class StoreDeals implements OnInit {
  readonly add = output<DealPick>();
  readonly close = output<void>();

  readonly allChains = CHAINS;
  readonly label = chainLabel;
  readonly price = formatPrice;
  readonly errorText = signal('');
  readonly loading = signal(false);
  readonly results = signal<ChainResult[]>([]);
  readonly filter = signal('');
  readonly menu = signal<'info' | 'stores' | null>(null);
  readonly chainFilter = signal<Chain | 'all'>('all');
  readonly chainOptions = computed<{ value: Chain | 'all'; label: string }[]>(() => [
    { value: 'all', label: 'Alle' },
    ...this.stores.chains().map((c) => ({ value: c, label: chainLabel(c) })),
  ]);

  readonly deals = computed<StoreProduct[]>(() => {
    const words = this.filter().trim().toLowerCase().split(/\s+/).filter(Boolean);
    const chain = this.chainFilter();
    return this.results()
      .filter((r) => chain === 'all' || r.chain === chain)
      .flatMap((r) => r.products)
      .filter((p) => words.every((w) => `${p.name} ${p.brand ?? ''}`.toLowerCase().includes(w)));
  });
  // Deals just added: their + shows a ✓ for a moment
  readonly added = signal<ReadonlySet<string>>(new Set());
  readonly failedChains = computed(() => this.results().filter((r) => r.error).map((r) => chainLabel(r.chain)));

  constructor(readonly stores: StorePrices) {}

  ngOnInit() {
    this.loadDeals();
  }

  toggleMenu(menu: 'info' | 'stores') {
    this.menu.set(this.menu() === menu ? null : menu);
  }

  chosen(chain: Chain): boolean {
    return this.stores.chains().includes(chain);
  }

  async toggleChain(chain: Chain) {
    const chains = this.chosen(chain) ? this.stores.chains().filter((c) => c !== chain) : [...this.stores.chains(), chain];
    this.errorText.set('');
    try {
      await this.stores.saveChains(chains);
      if (this.chainFilter() !== 'all' && !chains.includes(this.chainFilter() as Chain)) this.chainFilter.set('all');
      await this.loadDeals();
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  async loadDeals() {
    if (this.stores.chains().length === 0) {
      this.results.set([]);
      return;
    }
    this.loading.set(true);
    try {
      this.results.set(await this.stores.promotions());
    } catch (error) {
      this.errorText.set('Aktionen konnten nicht geladen werden: ' + errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  key(deal: StoreProduct): string {
    return `${deal.chain}:${deal.id}`;
  }

  pick(deal: StoreProduct, event: Event) {
    const row = (event.currentTarget as HTMLElement).closest('li');
    this.add.emit({ name: deal.name, image: row?.querySelector('[data-thumb]') ?? null });
    const key = this.key(deal);
    this.added.update((keys) => new Set(keys).add(key));
    setTimeout(() => this.added.update((keys) => new Set([...keys].filter((k) => k !== key))), ADDED_MS);
  }

  // "bis 2.11."
  until(date: string | null): string {
    const m = date?.match(/^\d{4}-(\d{2})-(\d{2})$/);
    return m ? `bis ${Number(m[2])}.${Number(m[1])}.` : '';
  }
}
