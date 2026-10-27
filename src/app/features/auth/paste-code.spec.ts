import { extractCode } from './paste-code';

describe('extractCode', () => {
  it('takes the plain code', () => {
    expect(extractCode('55034420')).toBe('55034420');
  });

  it('ignores spaces, dashes and surrounding text', () => {
    expect(extractCode('Dein Code: 5503 4420\n')).toBe('55034420');
    expect(extractCode('123-456')).toBe('123456');
  });

  it('returns null without a code', () => {
    expect(extractCode('Hallo')).toBeNull();
    expect(extractCode('12345')).toBeNull();
  });
});
