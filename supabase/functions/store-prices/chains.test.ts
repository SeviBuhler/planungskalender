// node --test supabase/functions/store-prices/chains.test.ts (Node 22.18+ runs TypeScript directly)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Aldi, Coop, Denner, Lidl, Migros, aldiProduct, coopProduct, nextSunday, dennerProduct, lidlLeafletProduct, lidlSearchProduct, matches, migrosProduct } from './chains.ts';

type Call = { url: string; init?: RequestInit };

function fakeFetch(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call = { url, init };
    calls.push(call);
    const route = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    return route ? routes[route](call) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
}

const jsonResponse = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } });

test('search words must all appear in the name', () => {
  assert.equal(matches('Bio Vollmilch 3.5%', 'milch'), true);
  assert.equal(matches('Bio Vollmilch', 'bio milch'), true);
  assert.equal(matches('Milchschokolade', 'vollmilch'), false);
});

test('Migros: regular price, promotion price and encoded image', () => {
  const regularProduct = migrosProduct({
    uid: '100139240',
    name: 'Vollmilch',
    offer: { price: { effectiveValue: 1.85, advertisedValue: 1.85 }, quantity: '1l' },
    images: [{ url: 'https://image.migros.ch/d/{stack}/abc/vollmilch.jpg' }],
    productUrls: 'https://www.migros.ch/de/product/204003200000',
    productInformation: { mainInformation: { brand: { name: 'M-Classic' } } },
  });
  assert.deepEqual(regularProduct, {
    chain: 'migros', id: '100139240', name: 'Vollmilch', brand: 'M-Classic', size: '1l', price: 1.85, regularPrice: null,
    promotion: null, validUntil: null, imageUrl: 'https://image.migros.ch/d/%7Bstack%7D/abc/vollmilch.jpg',
    url: 'https://www.migros.ch/de/product/204003200000',
  });

  const promo = migrosProduct({
    uid: '1',
    name: 'Kaffee',
    offer: {
      price: { effectiveValue: 10 },
      promotionPrice: { effectiveValue: 7.5 },
      badges: [{ description: '25%' }],
      promotionDateRange: { endDate: '2026-11-02T22:59:59Z' },
    },
  });
  assert.equal(promo?.price, 7.5);
  assert.equal(promo?.regularPrice, 10);
  assert.equal(promo?.promotion, '25%');
  assert.equal(promo?.validUntil, '2026-11-02');
  assert.equal(migrosProduct({ uid: '2', name: 'Spargeln', offer: { price: {} } }), null);
});

test('Migros: guest token, search, details, one retry after an expired token', async () => {
  let tokens = 0;
  let detailCalls = 0;
  const { fetcher, calls } = fakeFetch({
    'https://www.migros.ch/authentication/public/v1/api/guest': () => jsonResponse({}, { leshopch: `token-${++tokens}` }),
    'https://www.migros.ch/onesearch-oc-seaapi/public/v5/search': () => jsonResponse({ productIds: [11, 12] }),
    'https://www.migros.ch/product-display/public/v2/product-detail': () => {
      if (++detailCalls === 1) return new Response('expired', { status: 401 });
      return jsonResponse([
        { uid: '11', name: 'Vollmilch', offer: { price: { effectiveValue: 1.85 } } },
        { uid: '12', name: 'Milchschnitte', offer: { price: { effectiveValue: 3.2 } } },
      ]);
    },
  });
  const products = await new Migros(fetcher).search('milch', 4);
  assert.deepEqual(products.map((p) => p.name), ['Vollmilch', 'Milchschnitte']);
  assert.equal(tokens, 2);
  const search = calls.find((c) => c.url.includes('/v5/search'))!;
  assert.equal(JSON.parse(String(search.init?.body)).query, 'milch');
  assert.equal((search.init?.headers as Record<string, string>).leshopch, 'token-1');
  assert.match(calls.at(-1)!.url, /product-detail\?warehouseId=1&storeType=OFFLINE&region=2&uids=11,12&language=de$/);
});

test('Aldi: price in Rappen, was-price and image placeholders', () => {
  const product = aldiProduct({
    sku: '000000000000525709',
    name: 'Milch Drink',
    brandName: 'RETOUR AUX SOURCES',
    sellingSize: '1 l',
    urlSlugText: 'retour-aux-sources-milch-drink',
    price: { amount: 149, wasPriceDisplay: 'CHF 1.85' },
    assets: [{ url: 'https://dm.emea.cms.aldi.cx/is/image/aldiprodeu/product/jpg/scaleWidth/{width}/9562/{slug}' }],
  });
  assert.equal(product?.price, 1.49);
  assert.equal(product?.regularPrice, 1.85);
  assert.equal(product?.promotion, '-19%');
  assert.equal(product?.imageUrl, 'https://dm.emea.cms.aldi.cx/is/image/aldiprodeu/product/jpg/scaleWidth/200/9562/retour-aux-sources-milch-drink');
  assert.equal(product?.url, 'https://www.aldi-suisse.ch/de/p.retour-aux-sources-milch-drink.000000000000525709.html');
  assert.equal(aldiProduct({ sku: '1', name: 'Ohne Preis', price: {} }), null);
});

test('Aldi: search filters unrelated hits and uses an accepted page size', async () => {
  const { fetcher, calls } = fakeFetch({
    'https://api.aldi-suisse.ch/v3/product-search': () => jsonResponse({
      data: [
        { sku: '1', name: 'Vollmilch', price: { amount: 145 } },
        { sku: '2', name: 'Butter', price: { amount: 300 } },
      ],
    }),
  });
  const products = await new Aldi(fetcher).search('milch', 4);
  assert.deepEqual(products.map((p) => p.id), ['1']);
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('limit'), '12');
  assert.equal(url.searchParams.get('servicePoint'), 'E172');
});

test('Denner: current promotions only, anonymous login once', async () => {
  const today = '2026-10-27';
  assert.equal(dennerProduct({ id: 'a', title: { de: 'Alt' }, priceDiscount: 2, validTo: '2026-10-20' }, today), null);
  assert.equal(dennerProduct({ id: 'b', title: { de: 'Nächste Woche' }, priceDiscount: 2, validFrom: '2026-11-01' }, today), null);

  const { fetcher, calls } = fakeFetch({
    'https://app-api.denner.ch/api/auth/m/signup': () => jsonResponse({ clientId: 'client' }),
    'https://app-api.denner.ch/api/auth/m/signin': () => jsonResponse({ accessToken: 'jwt' }),
    'https://app-api.denner.ch/api/m/content/v2': () => jsonResponse({
      products: [
        { id: 'p1', title: { de: 'Vollmilch UHT' }, description: { de: '12 x 1 l' }, priceDiscount: 13.95, priceOrigin: 17.4, validFrom: '2026-10-21', validTo: '2026-10-27', imageUrl: 'https://denner.imgix.net/a.png' },
        { id: 'p2', title: { de: 'Kaffee' }, priceDiscount: 8, stopper: { text: { de: 'HIT' } } },
      ],
    }),
  });
  const denner = new Denner(fetcher, () => new Date('2026-10-27T10:00:00Z'));
  const milk = await denner.search('milch', 4);
  assert.deepEqual(milk, [{
    chain: 'denner', id: 'p1', name: 'Vollmilch UHT', brand: null, size: '12 x 1 l', price: 13.95, regularPrice: 17.4,
    promotion: '-20%', validUntil: '2026-10-27', imageUrl: 'https://denner.imgix.net/a.png', url: null,
  }]);
  assert.equal((await denner.promotions(10))[1].promotion, 'HIT');
  // The content is loaded once and kept
  assert.equal(calls.filter((c) => c.url.includes('/content/')).length, 1);
  assert.equal((calls[2].init?.headers as Record<string, string>).Authorization, 'Bearer jwt');
});

test('Lidl: only food from the web search, leaflet promotions', async () => {
  assert.equal(lidlSearchProduct({ category: 'Non Food', fullTitle: 'Wasserkocher', erpNumber: '1', price: { price: 20 } }), null);
  const water = lidlSearchProduct({
    category: 'Food', fullTitle: 'VITTEL Mineralwasser still', erpNumber: '10060363', brand: { name: 'VITTEL' },
    price: { price: 3.25, oldPrice: 6.49, discount: { discountText: '-50% im 6er Pack' } },
    canonicalUrl: '/p/de-CH/vittel-mineralwasser-still/p10060363', image: 'https://imgproxy-retcat.assets.schwarz/x.png',
  });
  assert.equal(water?.promotion, '-50% im 6er Pack');
  assert.equal(water?.url, 'https://www.lidl.ch/p/de-CH/vittel-mineralwasser-still/p10060363');
  assert.equal(lidlLeafletProduct({ id: 'x', title: 'Rohschinken', mainPrice: { price: 2.99, oldPrice: 3.45, discount: '-13%' } }, null)?.promotion, '-13%');

  const { fetcher } = fakeFetch({
    'https://digital-leaflet.lidlplus.com/api/v1/CH/campaignGroups': () => jsonResponse({ groups: [{ campaigns: [{ id: '1' }, { id: '2' }] }] }),
    'https://digital-leaflet.lidlplus.com/api/v1/CH/campaigns/1': () => jsonResponse({ products: [{ id: '1_a', title: 'Rohschinken', mainPrice: { price: 2.99 } }] }),
    'https://digital-leaflet.lidlplus.com/api/v1/CH/campaigns/2': () => new Response('down', { status: 500 }),
  });
  const promos = await new Lidl(fetcher).promotions(10);
  assert.deepEqual(promos.map((p) => [p.name, p.promotion]), [['Rohschinken', 'Aktion']]);
});

test('Coop: search, promotion flags, size and product link', async () => {
  const milk = coopProduct({
    code: '4389992', title: 'Naturaplan Bio Vollmilch UHT', price: { value: 9.95 }, originalPrice: { value: 11.7 }, weekPromotion: true,
    content: '6', contentUnit: 'l', categoryPathForTracking: 'lebensmittel/milchprodukte-eier/milch',
    images: [{ url: 'https://www.coop.ch/img/produkte/310_310/RGB/4389992_001.jpg' }],
  });
  assert.deepEqual(milk, {
    chain: 'coop', id: '4389992', name: 'Naturaplan Bio Vollmilch UHT', brand: null, size: '6 l', price: 9.95, regularPrice: 11.7,
    promotion: '-15%', validUntil: null, imageUrl: 'https://www.coop.ch/img/produkte/310_310/RGB/4389992_001.jpg',
    url: 'https://www.coop.ch/de/lebensmittel/milchprodukte-eier/milch/p/4389992',
  });
  assert.equal(coopProduct({ code: '1', title: 'Brot', price: { value: 2 } })?.promotion, null);
  assert.equal(nextSunday(new Date('2026-10-27T10:00:00Z')), '2026-11-01');
  assert.equal(nextSunday(new Date('2026-11-01T10:00:00Z')), '2026-11-01');

  const { fetcher, calls } = fakeFetch({
    'https://www.coop.ch/rest/v2/coopathome/products/search/': () => jsonResponse({
      products: [{ code: '1', title: 'Vollmilch', price: { value: 1.95 } }, { code: '2', title: 'Rahm', price: { value: 2.5 } }],
    }),
    'https://www.coop.ch/rest/v2/coopathome/products/category/m_1011': (call) => {
      if (call.url.includes('currentPage=2')) return new Response('blocked', { status: 403 });
      return jsonResponse({ products: [
        { code: 'a', title: 'Kaffee', price: { value: 5 }, originalPrice: { value: 10 }, hasPromotion: true },
        { code: 'b', title: 'Tee', price: { value: 3 } },
      ] });
    },
  });
  const coop = new Coop(fetcher, () => new Date('2026-10-27T10:00:00Z'));
  assert.deepEqual((await coop.search('milch', 4)).map((p) => p.id), ['1']);
  assert.match(calls[0].url, /search\/milch\?currentPage=0&pageSize=12&query=availableOnline%3Afalse&language=de/);
  const promos = await coop.promotions(10);
  assert.deepEqual(promos.map((p) => [p.id, p.promotion, p.validUntil]), [['a', '-50%', '2026-11-01']]);
});

test('errors name the status and the address for the logs', async () => {
  const { fetcher } = fakeFetch({ 'https://www.coop.ch/': () => new Response('<html>Please enable JS</html>', { status: 403 }) });
  await assert.rejects(new Coop(fetcher).search('milch', 4), /HTTP 403 www\.coop\.ch\/rest\/v2\/coopathome\/products\/search\/milch <html>Please enable JS/);
});
