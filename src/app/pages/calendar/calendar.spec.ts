import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideRouter } from '@angular/router';
import { Calendar, buildMonthGrid } from './calendar';

describe('Calendar', () => {
  let component: Calendar;
  let fixture: ComponentFixture<Calendar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Calendar],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Calendar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should move between months', () => {
    const start = component.viewDate();
    component.nextMonth();
    component.previousMonth();
    expect(component.viewDate().getTime()).toBe(start.getTime());
  });
});

describe('buildMonthGrid', () => {
  it('starts on Monday and covers full weeks', () => {
    // October 2026 starts on a Thursday and has 31 days
    const days = buildMonthGrid(2026, 9, new Date(2026, 9, 25));
    expect(days.length).toBe(35);
    expect(days[0].date.getDay()).toBe(1);
    expect(days[0].inMonth).toBe(false);
    expect(days[3].date.getDate()).toBe(1);
    expect(days.filter(d => d.inMonth).length).toBe(31);
    expect(days.filter(d => d.isToday).map(d => d.date.getDate())).toEqual([25]);
  });
});
