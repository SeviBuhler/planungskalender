import { Component, Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

// Look for a new version at most every few minutes, even when the app comes back to the front often
const CHECK_GAP_MS = 5 * 60 * 1000;
const CHECK_EVERY_MS = 30 * 60 * 1000;

// The service worker only loads new versions in the background and shows them on the next start.
// This looks for them itself (on start, on return to the app, every 30 min) and offers to switch now.
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly sw = inject(SwUpdate);
  readonly ready = signal(false);
  readonly updating = signal(false);
  private lastCheck = 0;

  constructor() {
    if (!this.sw.isEnabled) return;
    this.sw.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') this.ready.set(true);
    });
    // The cached version can no longer be served (e.g. files deleted on the server): only a reload helps
    this.sw.unrecoverable.subscribe(() => location.reload());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.check();
    });
    setInterval(() => this.check(true), CHECK_EVERY_MS);
    this.check(true);
  }

  async check(force = false) {
    if (!this.sw.isEnabled || this.ready()) return;
    if (!force && Date.now() - this.lastCheck < CHECK_GAP_MS) return;
    this.lastCheck = Date.now();
    // Offline or worker not registered yet: try again next time
    try { await this.sw.checkForUpdate(); } catch { /* ignore */ }
  }

  async apply() {
    this.updating.set(true);
    try { await this.sw.activateUpdate(); } catch { /* reload loads the new version anyway */ }
    location.reload();
  }

  later() {
    this.ready.set(false);
  }
}

@Component({
  selector: 'app-update-banner',
  template: `
    @if (update.ready()) {
      <div class="update-banner fixed inset-x-0 bottom-0 z-50 flex justify-center p-3 pointer-events-none">
        <section class="pointer-events-auto w-full max-w-sm rounded-2xl bg-indigo-950 text-white shadow-2xl ring-1 ring-white/10 p-4 flex flex-col gap-3"
                 role="status" animate.enter="anim-dialog-in" animate.leave="anim-dialog-out">
          <div class="flex items-center gap-3">
            <span class="flex-none size-9 rounded-xl bg-indigo-400/20 text-indigo-200 grid place-items-center" aria-hidden="true">
              <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
              </svg>
            </span>
            <div>
              <p class="font-semibold">Neue Version verfügbar</p>
              <p class="text-sm text-indigo-200">Aktualisieren dauert nur einen Moment.</p>
            </div>
          </div>
          <div class="flex gap-2">
            <button class="flex-1 px-3 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-indigo-100 transition-colors" (click)="update.later()">Später</button>
            <button class="flex-1 px-3 py-2.5 rounded-xl shadow-lg shadow-indigo-600/40 bg-indigo-600 hover:bg-indigo-500 font-semibold whitespace-nowrap transition-colors disabled:opacity-60"
                    [disabled]="update.updating()" (click)="update.apply()">
              {{ update.updating() ? 'Lädt…' : 'Jetzt aktualisieren' }}
            </button>
          </div>
        </section>
      </div>
    }
  `,
})
export class UpdateBanner {
  readonly update = inject(UpdateService);
}
