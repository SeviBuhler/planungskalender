import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Finance } from './finance';

describe('Finance', () => {
  let component: Finance;
  let fixture: ComponentFixture<Finance>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Finance],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Finance);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should start with the November plan', () => {
    expect(component.budget().month).toBe('2026-11');
    expect(component.result().endBalance).toBe(0);
  });

  it('carries the plan over into the next month', () => {
    component.goToNextMonth();
    expect(component.budget().month).toBe('2026-12');
    expect(component.budget().debts.map((d) => d.open)).toEqual([1449, 400]);
  });

  it('reorders debts by priority', () => {
    component.moveUp('debts', 2);
    expect(component.budget().debts.map((d) => d.name)).toEqual(['Skema Abo (Restbetrag)', 'Dana', 'Kreditkarte']);
    expect(component.result().debts.map((d) => d.payment)).toEqual([360, 400, 224]);
  });
});
