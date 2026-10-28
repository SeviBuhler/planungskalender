import { quantityLabel } from './shopping-store';

describe('quantityLabel', () => {
  it('turns a plain number into a count', () => {
    expect(quantityLabel('2')).toBe('2×');
    expect(quantityLabel(' 1,5 ')).toBe('1,5×');
  });

  it('keeps quantities with a unit as typed', () => {
    expect(quantityLabel('500 g')).toBe('500 g');
    expect(quantityLabel('2x')).toBe('2x');
  });

  it('is empty without a quantity', () => {
    expect(quantityLabel(null)).toBe('');
    expect(quantityLabel('  ')).toBe('');
  });
});
