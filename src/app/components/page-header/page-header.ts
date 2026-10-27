import { Component, ElementRef, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';
import { Supabase } from '../../services/supabase';

// Stroke icons (24×24) for the phone bar and the menu; fixed markup, so it may skip sanitizing
const ICON_PATHS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  finance: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.3"/>',
  shopping: '<path d="M3 4h2l2.2 10.5a2 2 0 0 0 2 1.5h7.6a2 2 0 0 0 2-1.5L20.5 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
  households: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h12V9.5"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
};

type IconName = keyof typeof ICON_PATHS;

const MODULES = [
  { path: '/calendar', label: 'Kalender', icon: 'calendar' as IconName },
  { path: '/finance', label: 'Finanzen', icon: 'finance' as IconName },
  { path: '/shopping', label: 'Einkauf', icon: 'shopping' as IconName },
];

// Less used pages live behind the gear button
const MENU = [
  { path: '/households', label: 'Haushalte', icon: 'households' as IconName },
  { path: '/settings', label: 'Optionen', icon: 'settings' as IconName },
];

const BUTTON = 'px-4 py-2 rounded-lg shadow-2xl hover:bg-fuchsia-500 text-white dark:text-sky-100';
const ITEM = 'flex w-full items-center gap-3 px-3 py-2.5 md:py-2 rounded-lg text-left transition-colors hover:bg-indigo-50 focus:outline-none focus-visible:bg-indigo-50 dark:hover:bg-indigo-800 dark:focus-visible:bg-indigo-800';
// For a page's own [menuItems] entries, which only phones list there
export const PHONE_MENU_ITEM = ITEM + ' md:hidden';
// Frosted glass for the floating phone controls; content stays faintly visible behind them
export const GLASS = 'bg-white/70 backdrop-blur-xl backdrop-saturate-150 shadow-[0_8px_28px_rgba(37,19,77,0.22)] ring-1 ring-white/60 dark:bg-indigo-950/70 dark:ring-white/10';

// Same header on every module page. Larger screens: logo + page title, module buttons and a gear menu with
// households, options and logout. Phones: logo + title on top (with room for the page's own [headerActions]),
// the modules and the menu ("Mehr") in a bar floating at the bottom, plus an optional round add button.
// A page can put its own entries at the top of the menu with [menuItems] (role="menuitem").
@Component({
  selector: 'app-page-header',
  imports: [RouterLink, RouterLinkActive, NgTemplateOutlet],
  host: {
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'close(true)',
  },
  template: `
    <header class="relative z-30 flex flex-wrap max-md:flex-nowrap items-center justify-between gap-3 mb-4">
      <h1 class="flex min-w-0 items-center gap-2 font-bold text-2xl md:text-4xl text-[#25134D] dark:text-sky-100">
        <img class="h-6 md:h-8 w-auto" src="icons/fortwo-mark.svg" alt="ForTwo" />
        @if (customTitle()) {
          <span class="flex min-w-0 md:hidden"><ng-content select="[mobileTitle]" /></span>
        } @else {
          <span class="truncate md:hidden">{{ mobileTitle() ?? title() }}</span>
        }<span class="hidden md:inline">{{ title() }}</span>
      </h1>
      <div class="flex items-center gap-2 md:hidden"><ng-content select="[headerActions]" /></div>
      <nav class="hidden md:flex flex-wrap items-center gap-2">
        @for (module of modules; track module.path) {
          <a [routerLink]="module.path" routerLinkActive #active="routerLinkActive"
             [class]="button + (active.isActive ? ' bg-fuchsia-600 dark:bg-fuchsia-700' : ' bg-indigo-600 dark:bg-indigo-700')"
             [attr.aria-current]="active.isActive ? 'page' : null">{{ module.label }}</a>
        }
        <button type="button" aria-label="Menü" aria-haspopup="menu" [attr.aria-expanded]="open()" data-menu
                [class]="'flex items-center justify-center p-2 rounded-lg shadow-2xl hover:bg-fuchsia-500 text-white dark:text-sky-100 '
                  + (open() || inMenu() ? 'bg-fuchsia-600 dark:bg-fuchsia-700' : 'bg-indigo-600 dark:bg-indigo-700')"
                (click)="toggle()">
          <ng-container *ngTemplateOutlet="gear" />
        </button>
      </nav>
      @if (open()) {
        <!-- Phones: rises from the bar over a dimmed page. Larger screens: drops from the gear. -->
        <div class="fixed inset-0 z-40 bg-indigo-950/20 md:hidden" animate.enter="anim-fade-in" animate.leave="anim-fade-out"></div>
        <div role="menu" data-menu
             class="fixed right-3 bottom-[calc(max(1rem,env(safe-area-inset-bottom))+5.25rem)] z-50 w-64 rounded-2xl bg-white/95 p-1.5 text-indigo-950 shadow-xl ring-1 ring-black/5 backdrop-blur-xl
                    md:absolute md:bottom-auto md:right-0 md:top-full md:mt-2 md:w-48 md:rounded-xl md:bg-white md:p-1 md:backdrop-blur-none
                    dark:bg-indigo-950/95 dark:text-sky-100 dark:ring-white/10 md:dark:bg-indigo-950"
             animate.enter="anim-menu-in" animate.leave="anim-menu-out" (keydown)="onMenuKeydown($event)" (click)="onMenuClick($event)">
          <ng-content select="[menuItems]" />
          @for (item of menu; track item.path) {
            <a role="menuitem" [routerLink]="item.path" routerLinkActive="font-semibold" [class]="itemClass" (click)="close()">
              <svg class="size-5 shrink-0 md:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" [innerHTML]="icons[item.icon]"></svg>{{ item.label }}
            </a>
          }
          <div class="my-1 h-px bg-black/5 dark:bg-white/10" role="separator"></div>
          <button role="menuitem" type="button" [class]="itemClass + ' text-red-600 dark:text-red-400'" (click)="logout()">
            <svg class="size-5 shrink-0 md:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" [innerHTML]="icons.logout"></svg>Logout
          </button>
        </div>
      }
    </header>

    <!-- Phones: modules and menu in a floating bar, the add button right of it -->
    <div class="fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex items-center gap-2 md:hidden">
      <nav [class]="'flex flex-1 gap-0.5 rounded-full p-1 ' + glass" aria-label="Module">
        @for (module of modules; track module.path) {
          <a [routerLink]="module.path" routerLinkActive #active="routerLinkActive" [attr.aria-current]="active.isActive ? 'page' : null"
             [class]="barItem + (active.isActive ? ' bg-[#7040E8]/15 font-semibold text-[#7040E8] dark:bg-[#B590FF]/20 dark:text-[#B590FF]' : '')">
            <svg class="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" [innerHTML]="icons[module.icon]"></svg>
            {{ module.label }}
          </a>
        }
        <button type="button" aria-haspopup="menu" [attr.aria-expanded]="open()" data-menu (click)="toggle()"
                [class]="barItem + (open() || inMenu() ? ' bg-[#7040E8]/15 font-semibold text-[#7040E8] dark:bg-[#B590FF]/20 dark:text-[#B590FF]' : '')">
          <ng-container *ngTemplateOutlet="gear" />
          Mehr
        </button>
      </nav>
      @if (addLabel()) {
        <button type="button" [attr.aria-label]="addLabel()" (click)="add.emit()"
                class="flex size-14 shrink-0 items-center justify-center rounded-full bg-[#7040E8] text-white shadow-[0_8px_24px_rgba(112,64,232,0.45)] active:scale-95 transition-transform">
          <svg class="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      }
    </div>

    <ng-template #gear>
      <svg class="h-6 w-6 transition-transform duration-300" [class.rotate-90]="open()" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10.33 4.32c.43-1.76 2.93-1.76 3.35 0a1.72 1.72 0 0 0 2.57 1.07c1.54-.94 3.31.83 2.37 2.37a1.72 1.72 0 0 0 1.07 2.57c1.76.43 1.76 2.93 0 3.35a1.72 1.72 0 0 0-1.07 2.57c.94 1.54-.83 3.31-2.37 2.37a1.72 1.72 0 0 0-2.57 1.07c-.43 1.76-2.93 1.76-3.35 0a1.72 1.72 0 0 0-2.57-1.07c-1.54.94-3.31-.83-2.37-2.37a1.72 1.72 0 0 0-1.07-2.57c-1.76-.43-1.76-2.93 0-3.35a1.72 1.72 0 0 0 1.07-2.57c-.94-1.54.83-3.31 2.37-2.37 1 .61 2.3.07 2.57-1.07z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </ng-template>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  // Shorter or more specific title for phones (the calendar shows the month there)
  readonly mobileTitle = input<string | null>(null);
  // The page puts its own phone title into [mobileTitle], e.g. a picker
  readonly customTitle = input(false);
  // Shows the round add button next to the phone bar
  readonly addLabel = input<string | null>(null);
  readonly add = output<void>();
  readonly modules = MODULES;
  readonly menu = MENU;
  private readonly sanitizer = inject(DomSanitizer);
  readonly icons = Object.fromEntries(
    Object.entries(ICON_PATHS).map(([name, paths]) => [name, this.sanitizer.bypassSecurityTrustHtml(paths)]),
  ) as Record<IconName, SafeHtml>;
  readonly button = BUTTON;
  readonly itemClass = ITEM;
  readonly glass = GLASS;
  readonly barItem = 'flex flex-1 min-w-0 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] text-[#25134D] dark:text-sky-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7040E8]';
  readonly open = signal(false);
  private readonly supabase = inject(Supabase);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
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

  // Escape returns focus to the visible menu button so keyboard users keep their place
  close(refocus = false) {
    if (!this.open()) return;
    this.open.set(false);
    if (!refocus) return;
    const triggers = this.host.nativeElement.querySelectorAll<HTMLElement>('button[data-menu]');
    [...triggers].find((b) => b.offsetParent !== null)?.focus();
  }

  // Entries a page puts into the menu close it too
  onMenuClick(event: Event) {
    if ((event.target as HTMLElement).closest('[role="menuitem"]')) this.open.set(false);
  }

  onMenuKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...this.host.nativeElement.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].filter((i) => i.offsetParent !== null);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items[next]?.focus();
  }

  onDocumentPointerDown(event: Event) {
    if (this.open() && !(event.target as HTMLElement).closest?.('[data-menu]')) this.open.set(false);
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
