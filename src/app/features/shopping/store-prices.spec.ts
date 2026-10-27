import { ChainResult, StorePrices, StoreProduct, cheapest, priceKey } from './store-prices';
import { Supabase } from '../../services/supabase';

function product(chain: StoreProduct['chain'], price: number): StoreProduct {
  return { chain, id: chain, name: 'Milch', brand: null, size: null, price, regularPrice: null, promotion: null, validUntil: null, imageUrl: null, url: null };
}

function fakeSupabase(invoke: (body: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>) {
  const upserts: unknown[] = [];
  const client = {
    functions: { invoke: (_name: string, options: { body: Record<string, unknown> }) => invoke(options.body) },
    from: () => ({
      select: () => ({ maybeSingle: async () => ({ data: { chains: ['lidl', 'migros', 'rewe'] }, error: null }) }),
      upsert: async (row: unknown) => {
        upserts.push(row);
        return { error: null };
      },
    }),
  };
  return { supabase: { client } as unknown as Supabase, upserts };
}

describe('store prices', () => {
  it('picks the cheapest best match over all stores', () => {
    const results: ChainResult[] = [
      { chain: 'migros', products: [product('migros', 1.85), product('migros', 0.9)] },
      { chain: 'aldi', products: [product('aldi', 1.49)] },
      { chain: 'denner', products: [], error: 'Laden gerade nicht erreichbar' },
    ];
    expect(cheapest(results)?.chain).toBe('aldi');
    expect(cheapest([])).toBeNull();
    expect(priceKey('  Bio   Milch ')).toBe('bio milch');
  });

  it('loads only known stores and saves them in a fixed order', async () => {
    const { supabase, upserts } = fakeSupabase(async () => ({ data: { results: [] }, error: null }));
    const stores = new StorePrices(supabase);
    expect(await stores.loadChains()).toEqual(['lidl', 'migros']);
    await stores.saveChains(['lidl', 'aldi']);
    expect(stores.chains()).toEqual(['aldi', 'lidl']);
    expect(upserts).toEqual([expect.objectContaining({ chains: ['aldi', 'lidl'] })]);
  });

  it('searches each item once, two at a time', async () => {
    const pending: { body: Record<string, unknown>; resolve: () => void }[] = [];
    const { supabase } = fakeSupabase((body) => new Promise((resolve) => {
      pending.push({ body, resolve: () => resolve({ data: { results: [{ chain: 'aldi', products: [product('aldi', 1)] }] }, error: null }) });
    }));
    const stores = new StorePrices(supabase);
    stores.chains.set(['aldi']);
    stores.request(['Milch', 'milch ', 'Brot', 'Eier']);
    expect(pending.map((p) => p.body['term'])).toEqual(['milch', 'brot']);
    expect(stores.prices().get('eier')?.status).toBe('loading');
    pending[0].resolve();
    await new Promise((r) => setTimeout(r));
    expect(stores.prices().get('milch')?.status).toBe('done');
    expect(pending.map((p) => p.body['term'])).toEqual(['milch', 'brot', 'eier']);
    stores.request(['Milch']);
    expect(pending).toHaveLength(3);
  });

  it('does nothing without stores and marks failed searches', async () => {
    const { supabase } = fakeSupabase(async () => ({ data: null, error: { message: 'offline' } }));
    const stores = new StorePrices(supabase);
    stores.request(['Milch']);
    expect(stores.prices().size).toBe(0);
    stores.chains.set(['migros']);
    stores.request(['Milch']);
    await new Promise((r) => setTimeout(r));
    expect(stores.prices().get('milch')?.status).toBe('error');
  });
});
