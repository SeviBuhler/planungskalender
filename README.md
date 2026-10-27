# ForTwo

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.0.7.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Supabase

Die Finanzplanung speichert ihre Daten in Supabase. Die Tabellen, Zugriffsregeln (RLS) und Funktionen stehen in `supabase/migrations/`. Jede Datei dort einmal im Supabase-Dashboard unter **SQL Editor** ausführen (oder mit der Supabase CLI `supabase db push`).

- `households` / `household_members`: freiwillige Haushalte als übergeordnete Struktur. Jeder Haushalt schaltet Module ein (`modules`: `finance`, `calendar`, später `shopping`). Erstellen, beitreten (Einladungscode), Module wählen und verlassen geht auf der Seite „Haushalte“. Bis zu 50 Mitglieder, eine Person kann in mehreren Haushalten sein.
- `finance_plans`: Finanzpläne mit Besitzer:in. Ohne `household_id` ist ein Plan privat. Mit `household_id` sehen und bearbeiten ihn alle Mitglieder des Haushalts (sofern das Modul Finanzplanung eingeschaltet ist). Nur die Besitzer:in kann ihn umbenennen, teilen, wieder privat machen oder löschen.
- `month_budgets`: ein Eintrag pro Plan und Monat, der Monatsplan liegt als JSON in `data`.
- `calendar_events`: Termine, privat oder in einem Haushalt mit Modul Kalender (dort dürfen alle Mitglieder sie bearbeiten). Termine, die seit mehr als 5 Jahren vorbei sind, löscht ein täglicher pg_cron-Job (`purge-old-calendar-events`). Jeder Termin kann eine Kategorie haben. Wiederkehrende Termine sind einzelne Zeilen mit derselben `series_id` (maximal 1000 pro Serie), damit jeder Termin einzeln geändert werden kann.
- `products`: die in der Schweiz verkauften Produkte aus [Open Food Facts](https://ch-de.openfoodfacts.org) (Lizenz ODbL) für die Vorschläge in der Einkaufsliste, gesucht mit der Funktion `search_products`. Gefüllt von `scripts/import-products.mjs`, das die GitHub Action „Produkte importieren“ jeden Monat ausführt. Dafür braucht das Repository die Secrets `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` (Supabase: Project Settings > API Keys, den geheimen Service-Key). Den ersten Import unter **Actions > Produkte importieren > Run workflow** von Hand starten.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
