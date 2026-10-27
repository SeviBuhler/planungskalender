// Fills the Supabase table "products" with the products sold in Switzerland from the
// Open Food Facts export (Open Database License). Table and search:
// supabase/migrations/20261027080000_products.sql. Runs monthly as GitHub Action
// (.github/workflows/import-products.yml), can also run locally:
//
//   SUPABASE_URL=https://<projekt>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> node scripts/import-products.mjs
//
// Options: --file <path>  read a downloaded export (.csv.gz or .csv) instead of downloading it
//          --dry-run      only count and show examples, write nothing
//
// Needs Node 20 or newer, no packages.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';

const EXPORT_URL = process.env.SOURCE_URL || 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz';
const COUNTRY = 'en:switzerland';
const IMAGE_HOST = 'https://images.openfoodfacts.org/';
const BATCH_SIZE = 1000;
// A much smaller export is probably broken; then nothing is deleted
const MIN_PRODUCTS = 1000;
const USER_AGENT = 'ForTwo-Einkaufsliste/1.0 (https://github.com/SeviBuhler/planungskalender)';

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function clip(value, max) {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

// Older exports name the image host static.openfoodfacts.org; the app only allows images.openfoodfacts.org
export function imageUrl(url) {
  const value = (url ?? '').trim().replace(/^https?:\/\/static\.openfoodfacts\.org\/images\//, `${IMAGE_HOST}images/`);
  return value.startsWith(IMAGE_HOST) ? value : null;
}

// One export line (tab separated) to a table row, or null when it is not a usable Swiss product
export function toRow(fields, columns) {
  const get = (name) => (columns[name] === undefined ? '' : fields[columns[name]] ?? '');
  const countries = get('countries_tags').split(',').map((c) => c.trim());
  if (!countries.includes(COUNTRY)) return null;
  const code = get('code').trim();
  if (!/^[0-9A-Za-z-]{1,64}$/.test(code)) return null;
  const name = clip(get('product_name'), 300) ?? clip(get('generic_name'), 300);
  if (!name) return null;
  const scans = Number.parseInt(get('unique_scans_n'), 10);
  return {
    code,
    name,
    brand: clip(get('brands').split(',')[0], 200),
    quantity: clip(get('quantity'), 100),
    image_url: imageUrl(get('image_front_small_url') || get('image_small_url')),
    popularity: Number.isFinite(scans) && scans > 0 ? Math.min(scans, 2_000_000_000) : 0,
  };
}

async function openExport() {
  const file = argValue('--file');
  let stream;
  if (file) {
    stream = createReadStream(file);
    if (file.endsWith('.gz')) stream = stream.pipe(createGunzip());
  } else {
    console.log(`Lade ${EXPORT_URL}`);
    const response = await fetch(EXPORT_URL, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok || !response.body) throw new Error(`Download fehlgeschlagen (${response.status})`);
    stream = Readable.fromWeb(response.body);
    if (EXPORT_URL.endsWith('.gz')) stream = stream.pipe(createGunzip());
  }
  return createInterface({ input: stream, crlfDelay: Infinity });
}

async function readProducts() {
  const products = new Map();
  let columns = null;
  let lines = 0;
  for await (const line of await openExport()) {
    if (!columns) {
      columns = Object.fromEntries(line.split('\t').map((name, index) => [name.trim(), index]));
      for (const required of ['code', 'product_name', 'countries_tags']) {
        if (columns[required] === undefined) throw new Error(`Spalte "${required}" fehlt im Export`);
      }
      continue;
    }
    lines++;
    if (lines % 500_000 === 0) console.log(`${lines} Zeilen gelesen, ${products.size} Schweizer Produkte`);
    // Cheap check before splitting the whole line
    if (!line.includes(COUNTRY)) continue;
    const row = toRow(line.split('\t'), columns);
    if (row) products.set(row.code, row);
  }
  console.log(`${lines} Zeilen gelesen, ${products.size} Schweizer Produkte`);
  return [...products.values()];
}

function supabaseHeaders(key) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  // Legacy service_role keys are JWTs and also go into Authorization; new sb_secret_ keys do not
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function request(url, init, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, init);
    if (response.ok) return response;
    const text = await response.text();
    if (attempt >= attempts || response.status < 500) throw new Error(`Supabase antwortet ${response.status}: ${text}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
}

async function upload(rows) {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY fehlen');
  const headers = supabaseHeaders(key);
  const importedAt = new Date().toISOString();

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE).map((row) => ({ ...row, imported_at: importedAt }));
    await request(`${base}/rest/v1/products?on_conflict=code`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    });
    console.log(`${Math.min(start + BATCH_SIZE, rows.length)} / ${rows.length} gespeichert`);
  }

  // Products no longer in the export (deleted or no longer sold in Switzerland)
  const response = await request(`${base}/rest/v1/products?imported_at=lt.${encodeURIComponent(importedAt)}`, {
    method: 'DELETE',
    headers: { ...headers, Prefer: 'return=minimal,count=exact' },
  });
  const removed = response.headers.get('content-range')?.split('/')[1] ?? '?';
  console.log(`${removed} alte Produkte entfernt`);
}

async function main() {
  const rows = await readProducts();
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(rows.slice(0, 3), null, 2));
    return;
  }
  if (rows.length < MIN_PRODUCTS) throw new Error(`Nur ${rows.length} Produkte im Export, Import abgebrochen`);
  await upload(rows);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
