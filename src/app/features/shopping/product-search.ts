import { Injectable } from '@angular/core';
import { Supabase } from '../../services/supabase';

// A product sold in Switzerland, from Open Food Facts (open database, ODbL); prices are not part of it
export interface Product {
  code: string;
  name: string;
  brand: string | null;
  quantity: string | null;
  imageUrl: string | null;
}

// The products are copied monthly into the own table "products" (scripts/import-products.mjs),
// so the search runs in Supabase: fast, no rate limit, no dependency on Open Food Facts' servers.
const IMAGE_HOST = 'https://images.openfoodfacts.org/';
export const MIN_SEARCH_LENGTH = 3;

interface ProductRow {
  code: string;
  name: string;
  brand: string | null;
  quantity: string | null;
  image_url: string | null;
}

// Only images from Open Food Facts are kept, so a stored item can never point elsewhere
export function safeImageUrl(url: unknown): string | null {
  return typeof url === 'string' && url.startsWith(IMAGE_HOST) ? url : null;
}

export function toProduct(row: ProductRow): Product {
  return { code: row.code, name: row.name, brand: row.brand, quantity: row.quantity, imageUrl: safeImageUrl(row.image_url) };
}

@Injectable({
  providedIn: 'root'
})
export class ProductSearch {
  private readonly cache = new Map<string, Product[]>();

  constructor(private supabase: Supabase) {}

  // Searched by name, brand or barcode (supabase/migrations/20261027080000_products.sql)
  async search(term: string, signal?: AbortSignal): Promise<Product[]> {
    const key = term.trim().toLowerCase();
    if (key.length < MIN_SEARCH_LENGTH) return [];
    const cached = this.cache.get(key);
    if (cached) return cached;

    let query = this.supabase.client.rpc('search_products', { term: key });
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw error;
    const products = ((data ?? []) as ProductRow[]).map(toProduct);
    this.cache.set(key, products);
    return products;
  }
}
