import { ProductSearch, safeImageUrl, toProduct } from './product-search';
import { Supabase } from '../../services/supabase';

const IMAGE = 'https://images.openfoodfacts.org/images/products/761/340/411/0285/front_de.3.200.jpg';

function fakeSupabase(result: { data: unknown; error: unknown }) {
  const calls: { fn: string; args: unknown; signal?: AbortSignal }[] = [];
  const client = {
    rpc(fn: string, args: unknown) {
      const call: { fn: string; args: unknown; signal?: AbortSignal } = { fn, args };
      calls.push(call);
      const query = {
        abortSignal(signal: AbortSignal) {
          call.signal = signal;
          return query;
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
      };
      return query;
    },
  };
  return { supabase: { client } as unknown as Supabase, calls };
}

describe('product search', () => {
  it('maps a row from the product table', () => {
    expect(toProduct({ code: '7613404110285', name: 'Vollmilch', brand: 'Migros', quantity: '1 l', image_url: IMAGE }))
      .toEqual({ code: '7613404110285', name: 'Vollmilch', brand: 'Migros', quantity: '1 l', imageUrl: IMAGE });
  });

  it('only keeps images from Open Food Facts', () => {
    expect(safeImageUrl(IMAGE)).toBe(IMAGE);
    expect(safeImageUrl('https://evil.example/x.jpg')).toBeNull();
    expect(safeImageUrl(42)).toBeNull();
  });

  it('searches the own product table, caches results and ignores short terms', async () => {
    const { supabase, calls } = fakeSupabase({ data: [{ code: '1', name: 'Milch', brand: null, quantity: null, image_url: null }], error: null });
    const search = new ProductSearch(supabase);
    expect(await search.search('mi')).toEqual([]);
    const abort = new AbortController();
    expect(await search.search('Milch', abort.signal)).toEqual([{ code: '1', name: 'Milch', brand: null, quantity: null, imageUrl: null }]);
    expect(await search.search('milch ')).toHaveLength(1);
    expect(calls).toEqual([{ fn: 'search_products', args: { term: 'milch' }, signal: abort.signal }]);
  });

  it('reports errors and does not cache them', async () => {
    const { supabase, calls } = fakeSupabase({ data: null, error: { message: 'Funktion fehlt' } });
    const search = new ProductSearch(supabase);
    await expect(search.search('milch')).rejects.toMatchObject({ message: 'Funktion fehlt' });
    await expect(search.search('milch')).rejects.toBeTruthy();
    expect(calls).toHaveLength(2);
  });
});
