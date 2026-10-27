import { Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';
import { Supabase } from '../../services/supabase';

const MODULES = [
  { path: '/calendar', label: 'Kalender' },
  { path: '/finance', label: 'Finanzen' },
  { path: '/shopping', label: 'Einkauf' },
];

// Less used pages live behind the gear button
const MENU = [
  { path: '/households', label: 'Haushalte' },
  { path: '/settings', label: 'Optionen' },
];

const BUTTON = 'px-4 py-2 rounded-lg shadow-2xl hover:bg-fuchsia-500 text-white dark:text-sky-100';
const ITEM = 'flex w-full items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors hover:bg-indigo-50 focus:outline-none focus-visible:bg-indigo-50 dark:hover:bg-indigo-800 dark:focus-visible:bg-indigo-800';

// Same header on every module page: logo + page title, navigation to the modules and a gear menu with households, options and logout
@Component({
  selector: 'app-page-header',
  imports: [RouterLink, RouterLinkActive],
  host: {
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'close(true)',
  },
  template: `
    <header class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h1 class="flex items-center gap-2 font-bold text-3xl md:text-4xl text-[#25134D] dark:text-sky-100">
        <img class="h-7 md:h-8 w-auto" src="icons/fortwo-mark.svg" alt="ForTwo" />{{ title() }}
      </h1>
      <nav class="flex flex-wrap items-center gap-2">
        @for (module of modules; track module.path) {
          <a [routerLink]="module.path" routerLinkActive #active="routerLinkActive"
             [class]="button + (active.isActive ? ' bg-fuchsia-600 dark:bg-fuchsia-700' : ' bg-indigo-600 dark:bg-indigo-700')"
             [attr.aria-current]="active.isActive ? 'page' : null">{{ module.label }}</a>
        }
        <div class="relative" #menuRoot>
          <button type="button" aria-label="Menü" aria-haspopup="menu" [attr.aria-expanded]="open()"
                  [class]="'flex items-center justify-center p-2 rounded-lg shadow-2xl hover:bg-fuchsia-500 text-white dark:text-sky-100 '
                    + (open() || inMenu() ? 'bg-fuchsia-600 dark:bg-fuchsia-700' : 'bg-indigo-600 dark:bg-indigo-700')"
                  (click)="toggle()">
            <svg class="h-6 w-6 transition-transform duration-300" [class.rotate-90]="open()" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M10.33 4.32c.43-1.76 2.93-1.76 3.35 0a1.72 1.72 0 0 0 2.57 1.07c1.54-.94 3.31.83 2.37 2.37a1.72 1.72 0 0 0 1.07 2.57c1.76.43 1.76 2.93 0 3.35a1.72 1.72 0 0 0-1.07 2.57c.94 1.54-.83 3.31-2.37 2.37a1.72 1.72 0 0 0-2.57 1.07c-.43 1.76-2.93 1.76-3.35 0a1.72 1.72 0 0 0-2.57-1.07c-1.54.94-3.31-.83-2.37-2.37a1.72 1.72 0 0 0-1.07-2.57c-1.76-.43-1.76-2.93 0-3.35a1.72 1.72 0 0 0 1.07-2.57c-.94-1.54.83-3.31 2.37-2.37 1 .61 2.3.07 2.57-1.07z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          @if (open()) {
            <div role="menu" class="absolute right-0 top-full z-50 mt-2 w-48 rounded-xl bg-white p-1 text-indigo-950 shadow-xl ring-1 ring-black/5 dark:bg-indigo-950 dark:text-sky-100 dark:ring-white/10"
                 animate.enter="anim-drop-in" animate.leave="anim-drop-out" (keydown)="onMenuKeydown($event)">
              @for (item of menu; track item.path) {
                <a role="menuitem" [routerLink]="item.path" routerLinkActive="font-semibold" [class]="itemClass" (click)="close()">{{ item.label }}</a>
              }
              <div class="my-1 h-px bg-black/5 dark:bg-white/10" role="separator"></div>
              <button role="menuitem" type="button" [class]="itemClass + ' text-red-600 dark:text-red-400'" (click)="logout()">Logout</button>
            </div>
          }
        </div>
      </nav>
    </header>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly modules = MODULES;
  readonly menu = MENU;
  readonly button = BUTTON;
  readonly itemClass = ITEM;
  readonly open = signal(false);
  private readonly supabase = inject(Supabase);
  private readonly router = inject(Router);
  private readonly menuRoot = viewChild.required<ElementRef<HTMLElement>>('menuRoot');
  // Highlights the gear while one of its pages is shown
  readonly inMenu = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.isMenuPage()),
    ),
    { initialValue: this.isMenuPage() },
  );

  toggle() {
    this.open.update((open) => !open);
  }

  // Escape returns focus to the gear so keyboard users keep their place
  close(refocus = false) {
    if (!this.open()) return;
    this.open.set(false);
    if (refocus) this.menuRoot().nativeElement.querySelector<HTMLElement>('button')?.focus();
  }

  onMenuKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...this.menuRoot().nativeElement.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[next]?.focus();
  }

  onDocumentPointerDown(event: Event) {
    if (this.open() && !this.menuRoot().nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  async logout() {
    this.open.set(false);
    const result = await this.supabase.client.auth.signOut();
    if (!result.error) this.router.navigate(['/login']);
  }

  private isMenuPage() {
    return this.menu.some((item) => this.router.url.startsWith(item.path));
  }
}
