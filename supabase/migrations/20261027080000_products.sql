-- Eigene Produktdatenbank für die Einkaufsliste: die in der Schweiz verkauften Produkte aus
-- Open Food Facts (Open Database License, https://ch-de.openfoodfacts.org). Die App sucht hier
-- statt bei Open Food Facts selbst, das war zu langsam und oft nicht erreichbar.
-- Gefüllt und monatlich aktualisiert von scripts/import-products.mjs
-- (GitHub Action .github/workflows/import-products.yml).
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

create extension if not exists pg_trgm with schema extensions;

create table public.products (
    code text primary key check (code ~ '^[0-9A-Za-z-]{1,64}$'),
    name text not null check (length(name) between 1 and 300),
    brand text check (length(brand) <= 200),
    quantity text check (length(quantity) <= 100),
    -- Nur Bilder von Open Food Facts, wie bei shopping_items.image_url
    image_url text check (image_url like 'https://images.openfoodfacts.org/%'),
    -- Wie oft das Produkt bei Open Food Facts gescannt wurde; Bekanntes kommt zuerst
    popularity integer not null default 0,
    -- Der Import löscht danach alles, was im neuen Export nicht mehr vorkommt
    imported_at timestamptz not null default now(),
    search_text text generated always as (lower(name || ' ' || coalesce(brand, ''))) stored
);

-- Teilwörter finden ("milch" findet "Vollmilch")
create index products_search_text_trgm on public.products using gin (search_text extensions.gin_trgm_ops);
create index products_imported_at on public.products (imported_at);

-- Lesen dürfen alle Angemeldeten; schreiben nur der Import mit dem Service-Key
alter table public.products enable row level security;
create policy "Angemeldete lesen Produkte" on public.products for select to authenticated using (true);
revoke all on public.products from anon, authenticated;
grant select on public.products to authenticated;

-- Suche für das Eingabefeld der Einkaufsliste: alle Wörter müssen in Name oder Marke vorkommen,
-- ein ganzer Barcode findet sein Produkt. Treffer am Namensanfang zuerst, dann die bekanntesten.
create or replace function public.search_products(term text)
returns setof public.products
language plpgsql
stable
set search_path = public
as $$
declare
    words text[];
    longest text;
begin
    -- % und _ sind Platzhalter von LIKE und werden wie Leerzeichen behandelt
    words := array_remove(regexp_split_to_array(trim(regexp_replace(lower(left(term, 100)), '[%_\\[:space:]]+', ' ', 'g')), ' '), '');
    if coalesce(cardinality(words), 0) = 0 then
        return;
    end if;
    select w into longest from unnest(words) w order by length(w) desc limit 1;

    return query
    select p.* from public.products p
    where p.code = trim(term)
       or (p.search_text like '%' || longest || '%'
           and not exists (select 1 from unnest(words) w where strpos(p.search_text, w) = 0))
    order by p.code = trim(term) desc, p.search_text like words[1] || '%' desc, p.popularity desc, p.name
    limit 8;
end;
$$;

revoke execute on function public.search_products(text) from public, anon;
grant execute on function public.search_products(text) to authenticated;
