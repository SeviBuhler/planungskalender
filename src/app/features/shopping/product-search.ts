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
const SEARCH_URL = 'https://search.openfoodfacts.org/search';
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

// Products sold in Switzerland, searched by name, brand or barcode. Lucene syntax
// (quotes, brackets, operators) is removed so typed text stays a plain text search.
export function searchUrl(term: string): string {
  const words = term.replace(/[^\p{L}\p{N}\s.,'&]/gu, ' ').replace(/\s+/g, ' ').trim();
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

@Injectable({
  providedIn: 'root'
})
export class ProductSearch {
  private readonly cache = new Map<string, Product[]>();

  async search(term: string, signal?: AbortSignal): Promise<Product[]> {
    const key = term.trim().toLowerCase();
    if (key.length < MIN_SEARCH_LENGTH) return [];
    const cached = this.cache.get(key);
    if (cached) return cached;

    const response = await fetch(searchUrl(key), { signal });
    if (!response.ok) throw new Error(`Produktsuche fehlgeschlagen (${response.status})`);
    const body = (await response.json()) as { hits?: Hit[] };
    const seen = new Set<string>();
    const products = (body.hits ?? [])
      .map(toProduct)
      .filter((p): p is Product => p !== null && !seen.has(p.code) && !!seen.add(p.code));
    this.cache.set(key, products);
    return products;
  }
}
