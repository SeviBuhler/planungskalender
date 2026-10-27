import { Injectable, signal } from '@angular/core';
import { Supabase } from '../../services/supabase';

// Prices and promotions from the chains' own websites and apps, via the Edge Function
// supabase/functions/store-prices. Unofficial, so everything is shown "ohne Gewähr".
export type Chain = 'migros' | 'aldi' | 'denner' | 'lidl';

export const CHAINS: { id: Chain; label: string; note: string }[] = [
  { id: 'migros', label: 'Migros', note: 'Sortiment und Aktionen' },
  { id: 'aldi', label: 'Aldi', note: 'Sortiment und Aktionen' },
  { id: 'denner', label: 'Denner', note: 'nur Aktionen' },
  { id: 'lidl', label: 'Lidl', note: 'Sortiment und Prospekt' },
];

export function chainLabel(chain: Chain): string {
  return CHAINS.find((c) => c.id === chain)?.label ?? chain;
}

export interface StoreProduct {
  chain: Chain;
  id: string;
  name: string;
  brand: string | null;
  size: string | null;
  price: number;
  regularPrice: number | null;
  promotion: string | null;
  validUntil: string | null;
  imageUrl: string | null;
  url: string | null;
}

export interface ChainResult {
  chain: Chain;
  products: StoreProduct[];
  error?: string;
}

export interface PriceState {
  status: 'loading' | 'done' | 'error';
  results: ChainResult[];
}

// At most this many price searches run at once, so a long list does not flood the stores
const CONCURRENT = 2;
const PROMOTIONS_MS = 30 * 60 * 1000;

export function priceKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function formatPrice(price: number): string {
  return price.toFixed(2);
}

// The first hit of each chain is its best match; the cheapest of those wins
export function cheapest(results: ChainResult[]): StoreProduct | null {
  return results
    .map((r) => r.products[0])
    .filter((p): p is StoreProduct => !!p)
    .reduce<StoreProduct | null>((best, p) => (!best || p.price < best.price ? p : best), null);
}

@Injectable({
  providedIn: 'root'
})
export class StorePrices {
  readonly chains = signal<Chain[]>([]);
  readonly prices = signal<ReadonlyMap<string, PriceState>>(new Map());
  private queue: string[] = [];
  private running = 0;
  private promotionsCache: { key: string; expires: number; value: Promise<ChainResult[]> } | null = null;

  constructor(private supabase: Supabase) {}

  async loadChains(): Promise<Chain[]> {
    const { data, error } = await this.supabase.client.from('store_preferences').select('chains').maybeSingle();
    if (error) throw error;
    const chains = ((data?.chains ?? []) as string[]).filter((c): c is Chain => CHAINS.some((k) => k.id === c));
    this.chains.set(chains);
    return chains;
  }

  async saveChains(chains: Chain[]) {
    const before = this.chains();
    const ordered = CHAINS.map((c) => c.id).filter((c) => chains.includes(c));
    this.chains.set(ordered);
    const { error } = await this.supabase.client
      .from('store_preferences')
      .upsert({ chains: ordered, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) {
      this.chains.set(before);
      throw error;
    }
    // Prices were searched for other stores
    this.prices.set(new Map());
    this.queue = [];
    this.promotionsCache = null;
  }

  private async invoke(body: Record<string, unknown>): Promise<ChainResult[]> {
    const { data, error } = await this.supabase.client.functions.invoke('store-prices', { body });
    if (error) throw error;
    return ((data as { results?: ChainResult[] })?.results ?? []);
  }

  // Looks up the prices of these items in the chosen stores, each name once
  request(names: string[]) {
    if (this.chains().length === 0) return;
    const known = this.prices();
    const fresh = [...new Set(names.map(priceKey))].filter((key) => key.length >= 2 && !known.has(key) && !this.queue.includes(key));
    if (fresh.length === 0) return;
    this.update(fresh, { status: 'loading', results: [] });
    this.queue.push(...fresh);
    this.drain();
  }

  private update(keys: string[], state: PriceState) {
    const next = new Map(this.prices());
    for (const key of keys) next.set(key, state);
    this.prices.set(next);
  }

  private drain() {
    while (this.running < CONCURRENT && this.queue.length > 0) {
      const key = this.queue.shift()!;
      const chains = this.chains();
      this.running++;
      this.invoke({ action: 'search', term: key, chains })
        .then((results) => ({ status: 'done' as const, results }), () => ({ status: 'error' as const, results: [] }))
        .then((state) => {
          // Stores changed meanwhile: this answer is for the old ones
          if (chains === this.chains()) this.update([key], state);
        })
        .finally(() => {
          this.running--;
          this.drain();
        });
    }
  }

  // Current promotions of the chosen stores
  promotions(): Promise<ChainResult[]> {
    const chains = this.chains();
    const key = chains.join(',');
    if (this.promotionsCache && this.promotionsCache.key === key && this.promotionsCache.expires > Date.now()) {
      return this.promotionsCache.value;
    }
    const value = chains.length === 0 ? Promise.resolve([]) : this.invoke({ action: 'promotions', chains });
    this.promotionsCache = { key, expires: Date.now() + PROMOTIONS_MS, value };
    value.catch(() => (this.promotionsCache = null));
    return value;
  }
}
