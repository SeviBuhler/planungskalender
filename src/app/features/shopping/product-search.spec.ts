import { ProductSearch, fallbackUrl, safeImageUrl, searchUrl, toProduct } from './product-search';

const IMAGE = 'https://images.openfoodfacts.org/images/products/761/340/411/0285/front_de.3.200.jpg';

describe('product search', () => {
  it('maps a hit and prefers the German name', () => {
    expect(
      toProduct({
        code: '7613404110285',
        product_name: 'Lait entier',
        product_name_de: 'Vollmilch',
        brands: 'Migros,M-Classic',
        quantity: '1 l',
        image_front_small_url: IMAGE,
      })
    ).toEqual({ code: '7613404110285', name: 'Vollmilch', brand: 'Migros', quantity: '1 l', imageUrl: IMAGE });
  });

  it('falls back to other languages, accepts brand lists and skips hits without a name', () => {
    expect(toProduct({ code: '1', product_name_fr: 'Pain', brands: ['Coop'] })).toMatchObject({ name: 'Pain', brand: 'Coop', imageUrl: null });
    expect(toProduct({ code: '2', product_name: '  ' })).toBeNull();
  });

  it('only keeps images from Open Food Facts', () => {
    expect(safeImageUrl(IMAGE)).toBe(IMAGE);
    expect(safeImageUrl('https://evil.example/x.jpg')).toBeNull();
    expect(safeImageUrl(42)).toBeNull();
  });

  it('searches Swiss products and strips query syntax', () => {
    const url = new URL(searchUrl('Milch "bio" (1l) -x*'));
    expect(url.origin + url.pathname).toBe('https://search.openfoodfacts.org/search');
    expect(url.searchParams.get('q')).toBe('Milch bio 1l x countries_tags:"en:switzerland"');
    expect(url.searchParams.get('langs')).toBe('de,fr,it,en');
  });

  it('caches results and ignores short terms', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ hits: [{ code: '1', product_name: 'Milch' }, { code: '1', product_name: 'Milch' }] })));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const search = new ProductSearch();
      expect(await search.search('mi')).toEqual([]);
      expect(await search.search('Milch')).toHaveLength(1);
      expect(await search.search('milch ')).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('builds the classic search for Swiss products', () => {
    const url = new URL(fallbackUrl('Milch "bio"'));
    expect(url.origin + url.pathname).toBe('https://world.openfoodfacts.org/cgi/search.pl');
    expect(url.searchParams.get('search_terms')).toBe('Milch bio');
    expect(url.searchParams.get('tag_0')).toBe('en:switzerland');
    expect(url.searchParams.get('json')).toBe('1');
  });

  it('falls back to the classic search, then skips the failing search and spaces out requests', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://search.openfoodfacts.org/')) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ products: [{ code: '1', product_name: 'Ovomaltine' }] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const search = new ProductSearch();
      expect(await search.search('ovo')).toEqual([expect.objectContaining({ name: 'Ovomaltine' })]);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // The next term waits for the classic search's rate limit and does not try Search-a-licious again
      let done = false;
      const next = search.search('ovom').then(() => (done = true));
      await vi.advanceTimersByTimeAsync(1000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(6000);
      await next;
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(String(fetchMock.mock.calls[2][0])).toContain('cgi/search.pl');
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('gives up on a search that hangs and cancels cleanly', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const search = new ProductSearch();
      const failed = search.search('ovo').catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(14000);
      expect(await failed).toBe('Produktsuche antwortet nicht');

      const abort = new AbortController();
      const cancelled = search.search('milch', abort.signal).catch((error: Error) => error.name);
      abort.abort();
      expect(await cancelled).toBe('AbortError');
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
