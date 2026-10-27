import { Injectable } from '@angular/core';

// A product from Open Food Facts (open database, ODbL); prices are not part of it
export interface Product {
  code: string;
  name: string;
  brand: string | null;
  quantity: string | null;
  imageUrl: string | null;
}

// Search-a-licious is the Elasticsearch based search of Open Food Facts. Unlike the
// classic search (10 requests per minute) it is meant for interactive search and allows CORS.
// It sometimes hangs or fails; the service worker then answers "504 Gateway Timeout".
const SEARCH_URL = 'https://search.openfoodfacts.org/search';
// The classic search is the fallback. It allows 10 requests per minute, so it is spaced out.
const FALLBACK_URL = 'https://world.openfoodfacts.org/cgi/search.pl';
const FALLBACK_SPACING_MS = 6500;
const TIMEOUT_MS = 5000;
const FALLBACK_TIMEOUT_MS = 8000;
// After a failure Search-a-licious is skipped for a while instead of waiting for it each time
const PRIMARY_PAUSE_MS = 5 * 60 * 1000;
const IMAGE_HOST = 'https://images.openfoodfacts.org/';
const FIELDS = [
  'code',
  'product_name',
  'product_name_de',
  'product_name_fr',
  'product_name_it',
  'product_name_en',
  'brands',
  'quantity',
  'image_front_small_url',
].join(',');
const PAGE_SIZE = 8;
export const MIN_SEARCH_LENGTH = 3;

type Hit = Record<string, unknown>;

function text(value: unknown): string | null {
  if (Array.isArray(value)) value = value[0];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Only images from Open Food Facts are kept, so a stored item can never point elsewhere
export function safeImageUrl(url: unknown): string | null {
  return typeof url === 'string' && url.startsWith(IMAGE_HOST) ? url : null;
}

// Hits carry one name per language; German first, then the other Swiss languages
export function toProduct(hit: Hit): Product | null {
  const name = text(hit['product_name_de']) ?? text(hit['product_name']) ?? text(hit['product_name_fr'])
    ?? text(hit['product_name_it']) ?? text(hit['product_name_en']);
  const code = text(hit['code']);
  if (!name || !code) return null;
  return {
    code,
    name,
    brand: text(hit['brands'])?.split(',')[0].trim() || null,
    quantity: text(hit['quantity']),
    imageUrl: safeImageUrl(hit['image_front_small_url']),
  };
}

// Lucene syntax (quotes, brackets, operators) is removed so typed text stays a plain text search
function plainWords(term: string): string {
  return term.replace(/[^\p{L}\p{N}\s.,'&]/gu, ' ').replace(/\s+/g, ' ').trim();
}

// Products sold in Switzerland, searched by name, brand or barcode
export function searchUrl(term: string): string {
  const words = plainWords(term);
  const query = `${words} countries_tags:"en:switzerland"`;
  const params = new URLSearchParams({
    q: query,
    langs: 'de,fr,it,en',
    boost_phrase: 'true',
    page_size: String(PAGE_SIZE),
    fields: FIELDS,
  });
  return `${SEARCH_URL}?${params}`;
}

// The same search with the classic API
export function fallbackUrl(term: string): string {
  const params = new URLSearchParams({
    search_terms: plainWords(term),
    search_simple: '1',
    action: 'process',
    json: '1',
    tagtype_0: 'countries',
    tag_contains_0: 'contains',
    tag_0: 'en:switzerland',
    page_size: String(PAGE_SIZE),
    fields: FIELDS,
  });
  return `${FALLBACK_URL}?${params}`;
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

// Waits, unless the search is cancelled meanwhile
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// fetch with a time limit; cancelling the search still cancels the request
async function fetchJson(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Produktsuche fehlgeschlagen (${response.status})`);
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error('Produktsuche antwortet nicht');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function hitsOf(body: Record<string, unknown>, key: string): Hit[] {
  const hits = body[key];
  return Array.isArray(hits) ? (hits as Hit[]) : [];
}

@Injectable({
  providedIn: 'root'
})
export class ProductSearch {
  private readonly cache = new Map<string, Product[]>();
  private primaryPausedUntil = 0;
  private nextFallbackAt = 0;

  async search(term: string, signal?: AbortSignal): Promise<Product[]> {
    const key = term.trim().toLowerCase();
    if (key.length < MIN_SEARCH_LENGTH) return [];
    const cached = this.cache.get(key);
    if (cached) return cached;

    const seen = new Set<string>();
    const products = (await this.fetchHits(key, signal))
      .map(toProduct)
      .filter((p): p is Product => p !== null && !seen.has(p.code) && !!seen.add(p.code));
    this.cache.set(key, products);
    return products;
  }

  private async fetchHits(key: string, signal?: AbortSignal): Promise<Hit[]> {
    if (Date.now() >= this.primaryPausedUntil) {
      try {
        return hitsOf(await fetchJson(searchUrl(key), TIMEOUT_MS, signal), 'hits');
      } catch (error) {
        if (signal?.aborted) throw error;
        this.primaryPausedUntil = Date.now() + PRIMARY_PAUSE_MS;
      }
    }
    // Typing on cancels the waiting search, so only the last term uses up a request
    await wait(this.nextFallbackAt - Date.now(), signal);
    this.nextFallbackAt = Date.now() + FALLBACK_SPACING_MS;
    return hitsOf(await fetchJson(fallbackUrl(key), FALLBACK_TIMEOUT_MS, signal), 'products');
  }
}
