import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Households } from './households';
import { Household, HouseholdModule, HouseholdStore } from '../../features/households/household-store';
import { ConfirmService } from '../../components/confirm/confirm';

class FakeHouseholdStore {
  households: Household[] = [];
  left: string[] = [];

  async list() { return structuredClone(this.households); }
  async create(name: string, modules: HouseholdModule[]) {
    const household = { id: `h${this.households.length + 1}`, name, inviteCode: 'CODE1234', memberCount: 1, modules };
    this.households.push(household);
    return household;
  }
  async join(code: string) {
    if (code !== 'ABCD1234') throw new Error('Einladungscode ungültig');
    const household = { id: 'joined', name: 'Familie', inviteCode: code, memberCount: 7, modules: ['calendar'] as HouseholdModule[] };
    this.households.push(household);
    return household;
  }
  async update(id: string, changes: Partial<Household>) {
    this.households = this.households.map((h) => (h.id === id ? { ...h, ...changes } : h));
  }
  async leave(id: string) {
    this.left.push(id);
    this.households = this.households.filter((h) => h.id !== id);
  }
}

describe('Households', () => {
  let store: FakeHouseholdStore;
  let fixture: ComponentFixture<Households>;
  let component: Households;

  beforeEach(async () => {
    store = new FakeHouseholdStore();
    await TestBed.configureTestingModule({
      imports: [Households],
      providers: [provideRouter([]), { provide: HouseholdStore, useValue: store }],
    }).compileComponents();
    fixture = TestBed.createComponent(Households);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('creates a household with the chosen modules', async () => {
    component.newName = 'Wir zwei';
    component.toggleNewModule('calendar');
    await component.create();

    expect(store.households).toEqual([{ id: 'h1', name: 'Wir zwei', inviteCode: 'CODE1234', memberCount: 1, modules: ['finance', 'shopping'] }]);
    expect(component.households().length).toBe(1);
    expect(component.newName).toBe('');
  });

  it('requires a name', async () => {
    await component.create();
    expect(component.errorText()).toBe('Bitte einen Namen eingeben');
    expect(store.households.length).toBe(0);
  });

  it('joins with an invite code and shows errors', async () => {
    component.inviteCode = 'FALSCH';
    await component.join();
    expect(component.errorText()).toBe('Einladungscode ungültig');

    component.inviteCode = 'ABCD1234';
    await component.join();
    expect(component.errorText()).toBe('');
    expect(component.households().map((h) => h.memberCount)).toEqual([7]);
  });

  it('switches modules on and off', async () => {
    await store.create('Wir zwei', ['finance']);
    await component.reload();

    await component.toggleModule(component.households()[0], 'calendar');
    expect(store.households[0].modules).toEqual(['finance', 'calendar']);
    await component.toggleModule(component.households()[0], 'finance');
    expect(store.households[0].modules).toEqual(['calendar']);
  });

  it('leaves a household after confirming', async () => {
    await store.create('Wir zwei', ['finance']);
    await component.reload();
    vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(true);

    await component.leave(component.households()[0]);
    expect(store.left).toEqual(['h1']);
    expect(component.households().length).toBe(0);
  });
});
