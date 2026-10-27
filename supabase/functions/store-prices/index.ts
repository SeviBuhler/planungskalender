// Preise und Aktionen von Migros, Aldi, Denner und Lidl für die Einkaufsliste von ForTwo.
// Die Läden haben keine offiziellen Schnittstellen; die Abfragen in chains.ts nutzen die
// öffentlichen Endpunkte ihrer Apps und Websites und können jederzeit ausfallen.
// Angaben ohne Gewähr.
//
// POST /functions/v1/store-prices, mit dem Access Token des Benutzers
//   { action: "search", term: "milch", chains: ["migros", "aldi"] }  passende Produkte pro Laden
//   { action: "promotions", chains: [...] }                          aktuelle Aktionen pro Laden
// Antwort: { results: [{ chain, products: [...], error?: string }] }
//
// Ergebnisse werden pro Instanz zwischengespeichert, damit die Läden nicht bei jedem Tippen
// gefragt werden. Deploy: supabase functions deploy store-prices

import { createClient } from 'npm:@supabase/supabase-js@2';
import { CHAINS, Chain, StoreProduct, chainApis } from './chains.ts';

const SEARCH_LIMIT = 4;
const PROMOTION_LIMIT = 60;
const SEARCH_CACHE_MS = 30 * 60 * 1000;
const PROMOTION_CACHE_MS = 2 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;

// Origins that may call the function: STORE_PRICES_ORIGINS (comma separated, e.g. a custom domain),
// the app's Vercel deployments and local development
const EXTRA_ORIGINS = (Deno.env.get('STORE_PRICES_ORIGINS') ?? Deno.env.get('WEBAUTHN_ORIGINS') ?? '')
  .split(',').map((o) => o.trim()).filter(Boolean);
const ORIGIN_PATTERNS = [/^https:\/\/fortwo[a-z0-9-]*\.vercel\.app$/, /^http:\/\/localhost:\d+$/];

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const apis = chainApis();
const cache = new Map<string, { expires: number; value: Promise<StoreProduct[]> }>();

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return EXTRA_ORIGINS.includes(origin) || ORIGIN_PATTERNS.some((p) => p.test(origin)) ? origin : null;
}

function reply(origin: string | null, status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin ?? '',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
    },
  });
}

// Only signed-in users; the anon key alone would make this an open proxy
async function signedIn(req: Request): Promise<boolean> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!token) return false;
  const { data, error } = await supabase.auth.getUser(token);
  return !error && !!data.user;
}

function cached(key: string, ttl: number, load: () => Promise<StoreProduct[]>): Promise<StoreProduct[]> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (cache.size >= MAX_CACHE_ENTRIES) {
    for (const [k, entry] of cache) if (entry.expires <= Date.now()) cache.delete(k);
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  }
  const value = load();
  cache.set(key, { expires: Date.now() + ttl, value });
  // Failures are not kept, the next request tries again
  value.catch(() => cache.delete(key));
  return value;
}

function chainsOf(value: unknown): Chain[] {
  if (!Array.isArray(value)) return [];
  return CHAINS.filter((c) => value.includes(c));
}

function plainTerm(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^\p{L}\p{N}\s.,'&-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60) : '';
}

Deno.serve(async (req) => {
  const origin = allowedOrigin(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return reply(origin, 204, null);
  if (req.method !== 'POST') return reply(origin, 405, { error: 'Nur POST' });
  if (!(await signedIn(req))) return reply(origin, 401, { error: 'Nicht angemeldet' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(origin, 400, { error: 'Ungültige Anfrage' });
  }
  const chains = chainsOf(body['chains']);
  if (chains.length === 0) return reply(origin, 400, { error: 'Keine Läden gewählt' });

  let load: (chain: Chain) => Promise<StoreProduct[]>;
  if (body['action'] === 'search') {
    const term = plainTerm(body['term']);
    if (term.length < 2) return reply(origin, 400, { error: 'Suchbegriff zu kurz' });
    load = (chain) => cached(`search:${chain}:${term}`, SEARCH_CACHE_MS, () => apis[chain].search(term, SEARCH_LIMIT));
  } else if (body['action'] === 'promotions') {
    load = (chain) => cached(`promotions:${chain}`, PROMOTION_CACHE_MS, () => apis[chain].promotions(PROMOTION_LIMIT));
  } else {
    return reply(origin, 400, { error: 'Unbekannte Aktion' });
  }

  const settled = await Promise.allSettled(chains.map(load));
  const results = chains.map((chain, i) => {
    const result = settled[i];
    if (result.status === 'fulfilled') return { chain, products: result.value };
    console.error(`store-prices ${chain}:`, result.reason);
    return { chain, products: [], error: 'Laden gerade nicht erreichbar' };
  });
  return reply(origin, 200, { results });
});
