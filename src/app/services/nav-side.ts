import { Injectable, signal } from '@angular/core';

export type NavSide = 'left' | 'right';

const NAV_SIDE_KEY = 'fortwo.navSide';

// Which screen edge the phone bar moves to when the phone is turned sideways.
// Sets the .nav-right class on <html> that the landscape rules in styles.css use.
@Injectable({ providedIn: 'root' })
export class NavSideService {
  readonly side = signal<NavSide>(readSide());

  constructor() {
    this.apply();
  }

  set(side: NavSide) {
    this.side.set(side);
    try { localStorage.setItem(NAV_SIDE_KEY, side); } catch { /* private mode */ }
    this.apply();
  }

  private apply() {
    document.documentElement.classList.toggle('nav-right', this.side() === 'right');
  }
}

function readSide(): NavSide {
  try {
    return localStorage.getItem(NAV_SIDE_KEY) === 'right' ? 'right' : 'left';
  } catch {
    return 'left';
  }
}
