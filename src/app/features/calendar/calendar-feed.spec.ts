import { feedUrl, webcalUrl } from './calendar-feed';

describe('calendar feed links', () => {
  it('points to the Edge Function', () => {
    expect(feedUrl('abc')).toMatch(/^https:\/\/.+\/functions\/v1\/calendar-feed\?token=abc$/);
  });

  it('uses webcal for the phone', () => {
    expect(webcalUrl('abc')).toMatch(/^webcal:\/\/.+\/functions\/v1\/calendar-feed\?token=abc$/);
  });
});
