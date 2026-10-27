// Prices and promotions of Swiss grocery chains for the ForTwo shopping list. None of the chains
// offers an official API; these are the public endpoints their own apps and websites use.
// They are unofficial and can change at any time, so every chain fails on its own and the
// app shows "Angaben ohne Gewähr". Pure parsing lives here so it can be tested without network.
//
// Tests: node --test supabase/functions/store-prices/chains.test.ts

export type Chain = 'migros' | 'coop' | 'aldi' | 'denner' | 'lidl';
export const CHAINS: Chain[] = ['migros', 'coop', 'aldi', 'denner', 'lidl'];

export interface StoreProduct {
  chain: Chain;
  id: string;
  name: string;
  brand: string | null;
  size: string | null;
  price: number; // CHF, what is paid now
  regularPrice: number | null; // CHF before the promotion, when on promotion
  promotion: string | null; // e.g. "-20%" or "Aktion"
  validUntil: string | null; // YYYY-MM-DD, last day of the promotion
  imageUrl: string | null;
  url: string | null;
}

type Raw = Record<string, unknown>;
type Fetcher = typeof fetch;

const TIMEOUT_MS = 8000;

function obj(value: unknown): Raw {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};
}

function list(value: unknown): Raw[] {
  return Array.isArray(value) ? value.map(obj) : [];
}

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// Multilingual fields ({ de, fr, it }) in German first
function text(value: unknown): string | null {
  if (typeof value === 'string') return str(value);
  const o = obj(value);
  return str(o['de']) ?? str(o['fr']) ?? str(o['it']);
}

function day(value: unknown): string | null {
  const s = str(value);
  const m = s?.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function https(value: unknown): string | null {
  const s = str(value);
  return s && s.startsWith('https://') ? s : null;
}

function regular(price: number, before: number | null): number | null {
  return before !== null && before > price ? before : null;
}

function percentOff(price: number, before: number | null): string | null {
  return before ? `-${Math.round((1 - price / before) * 100)}%` : null;
}

// Words of the search term that a product name must contain, so a search for "milch"
// does not fill the list with unrelated hits where the chain's own search is fuzzy
export function matches(name: string, term: string): boolean {
  const haystack = name.toLowerCase();
  return term.toLowerCase().split(/\s+/).filter(Boolean).every((w) => haystack.includes(w));
}

async function request(fetcher: Fetcher, url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      // Status, address and the start of the answer end up in the function logs
      const body = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
      throw new Error(`HTTP ${response.status} ${new URL(url).host}${new URL(url).pathname} ${body}`.trim());
    }
    return response;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Zeitüberschreitung');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function json(fetcher: Fetcher, url: string, init?: RequestInit): Promise<unknown> {
  return (await request(fetcher, url, init)).json();
}

// ---- Migros (www.migros.ch, guest token in header "leshopch") ----

const MIGROS = 'https://www.migros.ch';
// What migros.ch itself sends; without a browser User-Agent requests may be turned away
const MIGROS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  'Accept-Language': 'de-CH,de;q=0.9',
  Origin: MIGROS,
  Referer: `${MIGROS}/de`,
};
// Region 2 (Zürich) is what migros.ch shows visitors; "national" lacks regional prices
const MIGROS_REGION = '2';

export function migrosProduct(raw: Raw): StoreProduct | null {
  const offer = obj(raw['offer']);
  const base = obj(offer['price']);
  const promo = obj(offer['promotionPrice']);
  const promoPrice = num(promo['effectiveValue']);
  const basePrice = num(base['effectiveValue']) ?? num(base['advertisedValue']);
  const price = promoPrice ?? basePrice;
  const name = str(raw['name']) ?? str(raw['title']);
  const id = str(raw['uid']) ?? str(raw['migrosId']);
  if (!price || !name || !id) return null;
  const before = regular(price, basePrice);
  const badge = list(offer['badges']).map((b) => str(b['description'])).find(Boolean) ?? null;
  const image = str(list(raw['images'])[0]?.['url']);
  const brand = str(obj(obj(obj(raw['productInformation'])['mainInformation'])['brand'])['name']);
  return {
    chain: 'migros',
    id,
    name,
    brand,
    size: str(offer['quantity']),
    price,
    regularPrice: before,
    promotion: before || promoPrice ? badge ?? percentOff(price, before) ?? 'Aktion' : null,
    validUntil: day(obj(offer['promotionDateRange'])['endDate']),
    // The CDN path contains a literal {stack} placeholder; browsers want it encoded
    imageUrl: image && image.startsWith('https://') ? image.replace('{stack}', '%7Bstack%7D') : null,
    url: https(raw['productUrls']),
  };
}

export class Migros {
  private token: Promise<string> | null = null;
  private fetcher: Fetcher;
  constructor(fetcher: Fetcher = fetch) {
    this.fetcher = fetcher;
  }

  private guestToken(): Promise<string> {
    this.token ??= request(this.fetcher, `${MIGROS}/authentication/public/v1/api/guest`, {
      headers: { ...MIGROS_HEADERS, accept: 'application/json, text/plain, */*' },
    }).then((r) => {
      const token = r.headers.get('leshopch');
      if (!token) throw new Error('Kein Gast-Token');
      return token;
    }).catch((error) => {
      this.token = null;
      throw error;
    });
    return this.token;
  }

  // One new guest token when the old one expired
  private async call(url: string, init: RequestInit = {}): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { ...MIGROS_HEADERS, accept: 'application/json, text/plain, */*', leshopch: await this.guestToken() };
      if (init.body) headers['content-type'] = 'application/json';
      try {
        return await json(this.fetcher, url, { ...init, headers });
      } catch (error) {
        if (attempt > 0 || !/HTTP 40[13]/.test(String(error))) throw error;
        this.token = null;
      }
    }
  }

  private async details(uids: string[]): Promise<StoreProduct[]> {
    if (uids.length === 0) return [];
    // Same parameters as the website; without warehouseId and storeType the endpoint answers 400.
    // The uids stay comma separated, an encoded comma (%2C) is not understood.
    const query = `warehouseId=1&storeType=OFFLINE&region=${MIGROS_REGION}&uids=${uids.map(encodeURIComponent).join(',')}&language=de`;
    const body = await this.call(`${MIGROS}/product-display/public/v2/product-detail?${query}`);
    const rows = Array.isArray(body) ? body : Object.values(obj(body));
    return rows.map(obj).map(migrosProduct).filter((p): p is StoreProduct => p !== null);
  }

  async search(term: string, limit: number): Promise<StoreProduct[]> {
    const body = obj(await this.call(`${MIGROS}/onesearch-oc-seaapi/public/v5/search`, {
      method: 'POST',
      body: JSON.stringify({ regionId: MIGROS_REGION, language: 'de', productIds: [], query: term, sortFields: [], sortOrder: 'asc', algorithm: 'DEFAULT' }),
    }));
    const ids = (Array.isArray(body['productIds']) ? body['productIds'] : []).map(String).slice(0, limit * 2);
    return (await this.details(ids)).filter((p) => matches(p.name + ' ' + (p.brand ?? ''), term)).slice(0, limit);
  }

  async promotions(limit: number): Promise<StoreProduct[]> {
    const body = obj(await this.call(`${MIGROS}/product-display/public/web/v2/products/promotion/search`, {
      method: 'POST',
      body: JSON.stringify({
        storeType: 'OFFLINE', period: 'CURRENT', language: 'de', filters: {}, sortFields: ['CATEGORYLEVEL'], sortOrder: 'asc',
        from: 0, until: 100, region: 'national', warehouse: '1', query: '',
      }),
    }));
    const ids = list(body['items']).filter((i) => !i['type'] || i['type'] === 'PRODUCT').map((i) => String(i['id'])).slice(0, limit);
    const endDate = day(body['endDate']);
    // Product details are fetched in pages; the endpoint rejects very long uid lists
    const pages: string[][] = [];
    for (let i = 0; i < ids.length; i += 25) pages.push(ids.slice(i, i + 25));
    const products = (await Promise.all(pages.map((page) => this.details(page)))).flat();
    return products.map((p) => ({ ...p, promotion: p.promotion ?? 'Aktion', validUntil: p.validUntil ?? endDate }));
  }
}

// ---- Coop (coop.ch shop API "coopathome", no login) ----
// Coop protects its site against bots (DataDome); requests from servers may be refused.

const COOP = 'https://www.coop.ch/rest/v2/coopathome';
const COOP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'de-CH,de;q=0.9,en;q=0.8',
};
// The weekly promotions (Aktionen) category
const COOP_PROMOTIONS = 'm_1011';
const COOP_PROMOTION_PAGES = 3;

// Coop promotions run Monday to Sunday and carry no end date of their own
export function nextSunday(now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

export function coopProduct(raw: Raw): StoreProduct | null {
  const price = num(obj(raw['price'])['value']);
  const name = str(raw['title']) ?? str(raw['name']);
  const id = str(raw['code']);
  if (!price || !name || !id) return null;
  const before = regular(price, num(obj(raw['originalPrice'])['value']));
  const flagged = ['hasPromotion', 'weekPromotion', 'weekendPromotion', 'assortmentHitPromotion', 'megaStorePromotion']
    .some((flag) => raw[flag] === true);
  const content = str(raw['content']);
  const unit = str(raw['contentUnit']);
  const path = str(raw['categoryPathForTracking']);
  const discount = num(raw['discountPercentage']);
  return {
    chain: 'coop',
    id,
    name,
    brand: str(raw['declarationBrand']) ?? str(raw['brand']),
    size: content && unit ? `${content} ${unit}` : content,
    price,
    regularPrice: before,
    promotion: before || flagged ? (discount ? `-${Math.round(discount)}%` : percentOff(price, before) ?? 'Aktion') : null,
    validUntil: null,
    imageUrl: https(list(raw['images'])[0]?.['url']),
    url: path ? `https://www.coop.ch/de/${path.replace(/^\/+|\/+$/g, '')}/p/${encodeURIComponent(id)}` : null,
  };
}

export class Coop {
  private fetcher: Fetcher;
  private now: () => Date;
  constructor(fetcher: Fetcher = fetch, now: () => Date = () => new Date()) {
    this.fetcher = fetcher;
    this.now = now;
  }

  private async page(path: string, page: number, size: number): Promise<StoreProduct[]> {
    const params = new URLSearchParams({ currentPage: String(page), pageSize: String(size), query: 'availableOnline:false', language: 'de' });
    const body = obj(await json(this.fetcher, `${COOP}${path}?${params}`, { headers: COOP_HEADERS }));
    return list(body['products']).map(coopProduct).filter((p): p is StoreProduct => p !== null);
  }

  async search(term: string, limit: number): Promise<StoreProduct[]> {
    const products = await this.page(`/products/search/${encodeURIComponent(term)}`, 0, Math.max(limit * 3, 12));
    return products.filter((p) => matches(p.name, term)).slice(0, limit);
  }

  async promotions(limit: number): Promise<StoreProduct[]> {
    const pages = await Promise.all(
      Array.from({ length: COOP_PROMOTION_PAGES }, (_, i) => this.page(`/products/category/${COOP_PROMOTIONS}`, i, 100).catch(() => null)),
    );
    if (pages.every((p) => p === null)) throw new Error('Coop-Aktionen nicht erreichbar');
    const validUntil = nextSunday(this.now());
    const seen = new Set<string>();
    return pages.flatMap((p) => p ?? [])
      .filter((p) => p.promotion && !seen.has(p.id) && !!seen.add(p.id))
      .slice(0, limit)
      .map((p) => ({ ...p, validUntil }));
  }
}

// ---- Aldi Suisse (api.aldi-suisse.ch, no login) ----

const ALDI = 'https://api.aldi-suisse.ch';
const ALDI_HEADERS = { 'User-Agent': 'ALDI iOS App CH 9.2614.1 8', Accept: '*/*', 'Accept-Language': 'de_CH' };
// Prices are the same in all stores; a service point is still required
const ALDI_SERVICE_POINT = 'E172';
// The search accepts only certain page sizes
const ALDI_LIMITS = [12, 16, 24, 30, 32, 48, 60];

function aldiLimit(wanted: number): number {
  return ALDI_LIMITS.find((l) => l >= wanted) ?? ALDI_LIMITS[ALDI_LIMITS.length - 1];
}

// "CHF 2.30" -> 2.3
function chf(value: unknown): number | null {
  const m = str(value)?.replace(',', '.').match(/(\d+(?:\.\d+)?)/);
  return m ? num(m[1]) : null;
}

export function aldiProduct(raw: Raw): StoreProduct | null {
  const priceInfo = obj(raw['price']);
  const amount = num(priceInfo['amount']);
  const price = amount ? Math.round(amount) / 100 : null; // amount is in Rappen
  const name = str(raw['name']);
  const id = str(raw['sku']);
  if (!price || !name || !id) return null;
  const before = regular(price, chf(priceInfo['wasPriceDisplay']));
  const image = str(list(raw['assets'])[0]?.['url']);
  const slug = str(raw['urlSlugText']);
  return {
    chain: 'aldi',
    id,
    name,
    brand: str(raw['brandName']),
    size: str(raw['sellingSize']),
    price,
    regularPrice: before,
    promotion: before ? percentOff(price, before) : null,
    validUntil: null,
    imageUrl: image?.startsWith('https://') ? image.replace('{width}', '200').replace('{slug}', slug ?? 'produkt') : null,
    url: slug ? `https://www.aldi-suisse.ch/de/p.${slug}.${id}.html` : null,
  };
}

export class Aldi {
  private fetcher: Fetcher;
  constructor(fetcher: Fetcher = fetch) {
    this.fetcher = fetcher;
  }

  private async products(term: string, limit: number, onlyPromotion: boolean): Promise<StoreProduct[]> {
    const params = new URLSearchParams({
      q: term, servicePoint: ALDI_SERVICE_POINT, serviceType: 'walk-in', offset: '0', limit: String(aldiLimit(limit)),
    });
    if (onlyPromotion) params.set('onlyPromotion', 'true');
    const body = obj(await json(this.fetcher, `${ALDI}/v3/product-search?${params}`, { headers: ALDI_HEADERS }));
    return list(body['data']).map(aldiProduct).filter((p): p is StoreProduct => p !== null);
  }

  async search(term: string, limit: number): Promise<StoreProduct[]> {
    return (await this.products(term, limit * 2, false)).filter((p) => matches(p.name + ' ' + (p.brand ?? ''), term)).slice(0, limit);
  }

  async promotions(limit: number): Promise<StoreProduct[]> {
    return (await this.products('', limit, true)).slice(0, limit).map((p) => ({ ...p, promotion: p.promotion ?? 'Aktion' }));
  }
}

// ---- Denner (app-api.denner.ch, anonymous app login) ----
// The app content holds the current promotions only, not the whole assortment.

const DENNER = 'https://app-api.denner.ch';
const DENNER_APP = 'ch.denner.mobile.Denner';
const DENNER_HEADERS = {
  'User-Agent': 'DennerApp/6.1.00 (ch.denner.mobile.Denner; build:20260119.248; iOS 26.3.1) Alamofire/5.10.2',
  Accept: '*/*',
  'Accept-Language': 'de',
};
const DENNER_CONTENT_MS = 60 * 60 * 1000;

export function dennerProduct(raw: Raw, today: string): StoreProduct | null {
  const price = num(raw['priceOverride']) ?? num(raw['priceDiscount']);
  const name = text(raw['title']);
  const id = str(raw['id']);
  if (!price || !name || !id) return null;
  // Tobacco promotions are not shopping list material
  if (/smoking/.test(str(raw['legalWarning']) ?? '')) return null;
  const validUntil = day(raw['validTo']);
  const validFrom = day(raw['validFrom']);
  // Promotions announced for next week are already in the content
  if ((validUntil && validUntil < today) || (validFrom && validFrom > today)) return null;
  const before = regular(price, num(raw['priceOrigin']));
  const stopper = text(obj(raw['stopper'])['text']);
  return {
    chain: 'denner',
    id,
    name,
    brand: null,
    size: text(raw['description']),
    price,
    regularPrice: before,
    promotion: percentOff(price, before) ?? stopper ?? 'Aktion',
    validUntil,
    imageUrl: https(raw['imageUrl']),
    url: null,
  };
}

export class Denner {
  private token: Promise<string> | null = null;
  private content: { products: StoreProduct[]; expires: number } | null = null;
  private fetcher: Fetcher;
  private now: () => Date;
  // Plain fields instead of constructor parameter properties, so Node can run the tests without a build
  constructor(fetcher: Fetcher = fetch, now: () => Date = () => new Date()) {
    this.fetcher = fetcher;
    this.now = now;
  }

  private login(): Promise<string> {
    this.token ??= (async () => {
      const post = (path: string, body: unknown) => json(this.fetcher, `${DENNER}${path}`, {
        method: 'POST',
        headers: { ...DENNER_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const signup = obj(await post('/api/auth/m/signup', { appId: DENNER_APP }));
      const signin = obj(await post('/api/auth/m/signin', { appId: DENNER_APP, clientId: signup['clientId'] }));
      const token = str(signin['accessToken']);
      if (!token) throw new Error('Kein Denner-Token');
      return token;
    })().catch((error) => {
      this.token = null;
      throw error;
    });
    return this.token;
  }

  private async products(): Promise<StoreProduct[]> {
    if (this.content && this.content.expires > Date.now()) return this.content.products;
    const load = async () => json(this.fetcher, `${DENNER}/api/m/content/v2?v=0`, {
      headers: { ...DENNER_HEADERS, Authorization: `Bearer ${await this.login()}` },
    });
    let body: unknown;
    try {
      body = await load();
    } catch (error) {
      if (!/HTTP 40[13]/.test(String(error))) throw error;
      this.token = null;
      body = await load();
    }
    const today = this.now().toISOString().slice(0, 10);
    const products = list(obj(body)['products']).map((p) => dennerProduct(p, today)).filter((p): p is StoreProduct => p !== null);
    this.content = { products, expires: Date.now() + DENNER_CONTENT_MS };
    return products;
  }

  async search(term: string, limit: number): Promise<StoreProduct[]> {
    return (await this.products()).filter((p) => matches(p.name, term)).slice(0, limit);
  }

  async promotions(limit: number): Promise<StoreProduct[]> {
    return (await this.products()).slice(0, limit);
  }
}

// ---- Lidl (search of www.lidl.ch, promotions from the Lidl Plus leaflet) ----

const LIDL_WEB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  Accept: 'application/json, text/plain, */*',
};
const LIDL_APP_HEADERS = {
  'User-Agent': 'LidlSocialInternacional/16.47.15 (com.lidl.eci.lidl.plus; build:1445; iOS 26.3.1) Alamofire/5.10.2',
  Brand: 'Apple',
  App: 'com.lidl.eci.lidl.plus',
  'Operating-System': 'iOS',
  'App-Version': '16.47.15',
  'Accept-Language': 'DE',
  Accept: '*/*',
};
const LIDL_LEAFLET = 'https://digital-leaflet.lidlplus.com/api/v1/CH';
const LIDL_CAMPAIGNS = 5;

export function lidlSearchProduct(raw: Raw): StoreProduct | null {
  if (raw['category'] !== 'Food') return null;
  const priceInfo = obj(raw['price']);
  const price = num(priceInfo['price']);
  const name = str(raw['fullTitle']) ?? str(raw['title']);
  const id = str(raw['erpNumber']) ?? str(raw['productId']);
  if (!price || !name || !id) return null;
  const before = regular(price, num(priceInfo['oldPrice']));
  const discount = obj(priceInfo['discount']);
  const path = str(raw['canonicalUrl']) ?? str(raw['canonicalPath']);
  return {
    chain: 'lidl',
    id,
    name,
    brand: str(obj(raw['brand'])['name']),
    size: null,
    price,
    regularPrice: before,
    promotion: before ? str(discount['discountText']) ?? percentOff(price, before) : null,
    validUntil: day(raw['storeEndDate']),
    imageUrl: https(raw['image']),
    url: path?.startsWith('/') ? `https://www.lidl.ch${path}` : null,
  };
}

export function lidlLeafletProduct(raw: Raw, validUntil: string | null): StoreProduct | null {
  const main = obj(raw['mainPrice']);
  const price = num(main['price']);
  const name = str(raw['title']);
  const id = str(raw['id']);
  if (!price || !name || !id) return null;
  const before = regular(price, num(main['oldPrice']));
  return {
    chain: 'lidl',
    id,
    name,
    brand: str(raw['brand']),
    size: str(raw['subtitle']),
    price,
    regularPrice: before,
    promotion: str(main['discount']) ?? percentOff(price, before) ?? 'Aktion',
    validUntil,
    imageUrl: https(raw['imageUrl']),
    url: null,
  };
}

export class Lidl {
  private fetcher: Fetcher;
  constructor(fetcher: Fetcher = fetch) {
    this.fetcher = fetcher;
  }

  async search(term: string, limit: number): Promise<StoreProduct[]> {
    const params = new URLSearchParams({
      q: term, locale: 'de_CH', assortment: 'CH', version: 'v2.0.0', offset: '0', fetchsize: String(Math.min(limit * 4, 48)),
    });
    const body = obj(await json(this.fetcher, `https://www.lidl.ch/q/api/search?${params}`, { headers: LIDL_WEB_HEADERS }));
    return list(body['items'])
      .map((item) => lidlSearchProduct(obj(obj(item['gridbox'])['data'])))
      .filter((p): p is StoreProduct => p !== null && matches(p.name, term))
      .slice(0, limit);
  }

  async promotions(limit: number): Promise<StoreProduct[]> {
    const groups = obj(await json(this.fetcher, `${LIDL_LEAFLET}/campaignGroups`, { headers: LIDL_APP_HEADERS }));
    const ids = list(groups['groups']).flatMap((g) => list(g['campaigns'])).map((c) => str(c['id'])).filter((id): id is string => !!id);
    const campaigns = await Promise.all(ids.slice(0, LIDL_CAMPAIGNS).map((id) =>
      json(this.fetcher, `${LIDL_LEAFLET}/campaigns/${encodeURIComponent(id)}`, { headers: LIDL_APP_HEADERS }).catch(() => null)
    ));
    const seen = new Set<string>();
    return campaigns.flatMap((c) => list(obj(c)['products']).map((p) => lidlLeafletProduct(p, null)))
      .filter((p): p is StoreProduct => p !== null && !seen.has(p.name) && !!seen.add(p.name))
      .slice(0, limit);
  }
}

export interface ChainApi {
  search(term: string, limit: number): Promise<StoreProduct[]>;
  promotions(limit: number): Promise<StoreProduct[]>;
}

export function chainApis(fetcher: Fetcher = fetch): Record<Chain, ChainApi> {
  return { migros: new Migros(fetcher), coop: new Coop(fetcher), aldi: new Aldi(fetcher), denner: new Denner(fetcher), lidl: new Lidl(fetcher) };
}
