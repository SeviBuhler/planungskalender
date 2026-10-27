import { Component, OnInit, computed, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CHAINS, Chain, ChainResult, StorePrices, StoreProduct, chainLabel, formatPrice } from '../../../features/shopping/store-prices';

function errorMessage(error: unknown): string {
  return error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)
    ? String((error as { message: string }).message)
    : 'Unbekannter Fehler';
}

// "Wo kaufst du ein?" and the current promotions of those stores
@Component({
  selector: 'app-store-deals',
  imports: [FormsModule],
  templateUrl: './store-deals.html',
})
export class StoreDeals implements OnInit {
  readonly add = output<string>();
  readonly close = output<void>();

  readonly allChains = CHAINS;
  readonly label = chainLabel;
  readonly price = formatPrice;
  readonly errorText = signal('');
  readonly loading = signal(false);
  readonly results = signal<ChainResult[]>([]);
  readonly filter = signal('');
  readonly chainFilter = signal<Chain | 'all'>('all');

  readonly deals = computed<StoreProduct[]>(() => {
    const words = this.filter().trim().toLowerCase().split(/\s+/).filter(Boolean);
    const chain = this.chainFilter();
    return this.results()
      .filter((r) => chain === 'all' || r.chain === chain)
      .flatMap((r) => r.products)
      .filter((p) => words.every((w) => `${p.name} ${p.brand ?? ''}`.toLowerCase().includes(w)));
  });
  readonly failedChains = computed(() => this.results().filter((r) => r.error).map((r) => chainLabel(r.chain)));

  constructor(readonly stores: StorePrices) {}

  ngOnInit() {
    this.loadDeals();
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

  // "bis 2.11."
  until(date: string | null): string {
    const m = date?.match(/^\d{4}-(\d{2})-(\d{2})$/);
    return m ? `bis ${Number(m[2])}.${Number(m[1])}.` : '';
  }
}
