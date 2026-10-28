import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { StoreDeals } from './store-deals';
import { Chain, ChainResult, StorePrices, StoreProduct } from '../../../features/shopping/store-prices';

function deal(chain: Chain, name: string, promotion = '-20%'): StoreProduct {
  return { chain, id: name, name, brand: null, size: null, price: 2.5, regularPrice: 3.1, promotion, validUntil: '2026-11-02', imageUrl: null, url: null };
}

class FakeStorePrices {
  chains = signal<Chain[]>([]);
  saved: Chain[][] = [];
  results: ChainResult[] = [
    { chain: 'aldi', products: [deal('aldi', 'Vollmilch'), deal('aldi', 'Butter')] },
    { chain: 'lidl', products: [], error: 'Laden gerade nicht erreichbar' },
  ];
  async saveChains(chains: Chain[]) {
    this.saved.push(chains);
    this.chains.set(chains);
  }
  async promotions() {
    return this.chains().length ? this.results : [];
  }
}

describe('StoreDeals', () => {
  it('saves the chosen stores, lists their promotions and filters them', async () => {
    const stores = new FakeStorePrices();
    await TestBed.configureTestingModule({ imports: [StoreDeals], providers: [{ provide: StorePrices, useValue: stores }] }).compileComponents();
    const fixture = TestBed.createComponent(StoreDeals);
    const component = fixture.componentInstance;
    await fixture.whenStable();
    expect(component.deals()).toEqual([]);

    await component.toggleChain('aldi');
    await component.toggleChain('lidl');
    expect(stores.saved).toEqual([['aldi'], ['aldi', 'lidl']]);
    expect(component.deals().map((d) => d.name)).toEqual(['Vollmilch', 'Butter']);
    expect(component.failedChains()).toEqual(['Lidl']);

    component.filter.set('milch');
    expect(component.deals().map((d) => d.name)).toEqual(['Vollmilch']);
    expect(component.until('2026-11-02')).toBe('bis 2.11.');

    const added: string[] = [];
    component.add.subscribe((pick) => added.push(pick.name));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[aria-label="Vollmilch auf die Liste"]') as HTMLButtonElement).click();
    expect(added).toEqual(['Vollmilch']);
    // The + turns into a ✓ for a moment, and a second tap adds nothing
    fixture.detectChanges();
    const done = fixture.nativeElement.querySelector('[aria-label="Vollmilch ist auf der Liste"]') as HTMLButtonElement;
    expect(done.textContent?.trim()).toBe('✓');
    done.click();
    expect(added).toEqual(['Vollmilch']);
  });
});
