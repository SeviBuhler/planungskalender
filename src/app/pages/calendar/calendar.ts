import { Component, computed, signal } from '@angular/core';
import { Supabase } from '../../services/supabase';
import { Router } from '@angular/router';

export interface CalendarDay {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
}

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Builds the visible grid for a month: full weeks from Monday to Sunday
export function buildMonthGrid(year: number, month: number, today: Date = new Date()): CalendarDay[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;

  const days: CalendarDay[] = [];
  for (let i = 0; i < cellCount; i++) {
    const date = new Date(year, month, 1 - offset + i);
    days.push({ date, inMonth: date.getMonth() === month, isToday: isSameDay(date, today) });
  }
  return days;
}

@Component({
  selector: 'app-calendar',
  imports: [],
  templateUrl: './calendar.html',
  styleUrl: './calendar.css',
})
export class Calendar {
  readonly weekdays = WEEKDAYS;
  readonly viewDate = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  readonly monthLabel = computed(() =>
    this.viewDate().toLocaleDateString('de-CH', { month: 'long', year: 'numeric' })
  );
  readonly days = computed(() => buildMonthGrid(this.viewDate().getFullYear(), this.viewDate().getMonth()));

  constructor(public supabase: Supabase, private router: Router) {}

  previousMonth() {
    const d = this.viewDate();
    this.viewDate.set(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }

  nextMonth() {
    const d = this.viewDate();
    this.viewDate.set(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  goToToday() {
    const now = new Date();
    this.viewDate.set(new Date(now.getFullYear(), now.getMonth(), 1));
  }

  async handleLogout() {
    const result = await this.supabase.client.auth.signOut()

    if (!result.error) {
      this.router.navigate(['/login'])
    }
  }
}
