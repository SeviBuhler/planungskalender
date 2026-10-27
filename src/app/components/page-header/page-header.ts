import { Component, input } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Supabase } from '../../services/supabase';

const MODULES = [
  { path: '/calendar', label: 'Kalender' },
  { path: '/finance', label: 'Finanzen' },
  { path: '/shopping', label: 'Einkauf' },
  { path: '/households', label: 'Haushalte' },
  { path: '/settings', label: 'Optionen' },
];

const BUTTON = 'px-4 py-2 rounded-lg shadow-2xl hover:bg-fuchsia-500 text-white dark:text-sky-100';

// Same header on every module page: logo + page title, navigation to the other modules and options, logout
@Component({
  selector: 'app-page-header',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h1 class="flex items-center gap-2 font-bold text-3xl md:text-4xl text-[#25134D] dark:text-sky-100">
        <img class="h-7 md:h-8 w-auto" src="icons/fortwo-mark.svg" alt="ForTwo" />{{ title() }}
      </h1>
      <nav class="flex flex-wrap gap-2">
        @for (module of modules; track module.path) {
          <a [routerLink]="module.path" routerLinkActive #active="routerLinkActive"
             [class]="button + (active.isActive ? ' bg-fuchsia-600 dark:bg-fuchsia-700' : ' bg-indigo-600 dark:bg-indigo-700')"
             [attr.aria-current]="active.isActive ? 'page' : null">{{ module.label }}</a>
        }
        <button [class]="button + ' bg-indigo-600 dark:bg-indigo-700'" (click)="logout()">Logout</button>
      </nav>
    </header>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly modules = MODULES;
  readonly button = BUTTON;

  constructor(private supabase: Supabase, private router: Router) {}

  async logout() {
    const result = await this.supabase.client.auth.signOut();
    if (!result.error) this.router.navigate(['/login']);
  }
}
