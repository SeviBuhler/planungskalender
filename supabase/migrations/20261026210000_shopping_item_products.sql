-- Einkaufsliste: Artikel können mit einem Produkt aus Open Food Facts verknüpft sein (Barcode und Bild).
-- Im Supabase-Dashboard unter "SQL Editor" einmal ausführen.

alter table public.shopping_items
    add column product_code text check (product_code ~ '^[0-9A-Za-z-]{1,64}$'),
    -- Nur Bilder von Open Food Facts, damit eine geteilte Liste keine fremden Adressen lädt
    add column image_url text check (image_url like 'https://images.openfoodfacts.org/%');

grant update (product_code, image_url) on public.shopping_items to authenticated;
