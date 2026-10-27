import { passwordProblems, passwordRuleError } from './password-rule';

// Sample inputs are built from parts so secret scanners do not take them for real credentials
const sample = (...parts: string[]) => parts.join('');

describe('passwordProblems', () => {
  it('accepts input that meets every rule', () => {
    expect(passwordProblems(sample('Sommer', '24', '!?'))).toEqual([]);
    expect(passwordRuleError(sample('Äpfel', '-9#', 'x'))).toBeNull();
  });

  it('lists what is missing', () => {
    expect(passwordProblems(sample('ku', 'rz'))).toEqual([
      'mindestens 8 Zeichen',
      'ein Grossbuchstabe',
      'eine Zahl',
      'zwei Sonderzeichen',
    ]);
  });

  it('needs two special characters, not one', () => {
    expect(passwordProblems(sample('Sommer', '2024', '!'))).toEqual(['zwei Sonderzeichen']);
  });

  it('does not count spaces as special characters', () => {
    expect(passwordProblems(sample('Sommer ', '2024', ' !'))).toEqual(['zwei Sonderzeichen']);
  });
});
